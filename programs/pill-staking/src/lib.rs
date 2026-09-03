//! # pill_staking — inmovilizar $PILL y cobrar lo que factura el juego
//!
//! Este programa hace UNA cosa: repartir los ingresos corrientes de PillWars —el rake
//! de las partidas, la comisión de arcade, los botes sin reclamar— entre quien deja
//! sus tokens quietos. Ni premios, ni custodia, ni bloqueos de años.
//!
//! ## Dos bolsas, y separadas a propósito
//!
//! ```text
//!   ["stake"]    principal de los usuarios. Es SUYO. Sale con 7 días de aviso.
//!   ["rewards"]  lo que hay por repartir. Se llena con fund_rewards() y gotea
//!                por segundo entre los que están dentro.
//! ```
//!
//! Si estuvieran juntas, un error de cálculo pagaría recompensas con el principal de
//! otro y nadie lo notaría hasta que alguien no pudiera sacar lo suyo. Separadas, ese
//! error se ve enseguida: la bóveda de recompensas se queda sin fondos y la
//! transacción revierte, en vez de robarle a un tercero en silencio.
//!
//! ## Por qué gotea en vez de repartirse de golpe
//!
//! Si `fund_rewards` soltara el dinero entero al llamarse, cualquiera podría stakear
//! un segundo antes, llevarse su parte del día completo y salir. Con el goteo por
//! segundo, lo que cobras es proporcional al tiempo que estuviste dentro. Es la misma
//! razón por la que existe el enfriamiento de 7 días al salir: sin él, se entra el
//! día que toca reparto y se sale al siguiente.
//!
//! ## Lo que este programa NO tiene, a propósito
//!
//! **No guarda los premios del leaderboard.** Son otro dinero, otros destinatarios y
//! otras reglas, y meterlos aquí solo tendría dos finales posibles: o la autoridad
//! puede sacarlos —y entonces no están bloqueados, es una wallet con pasos de más— o
//! hacen falta pruebas de Merkle y ventana de impugnación, que es `pill_treasury`
//! entero. Además, separados, un fallo en la contabilidad del staking no puede tocar
//! el dinero de los premios.
//!
//! El bloqueo de la asignación de premios se hace con vesting externo (Jupiter Lock,
//! Streamflow): cuesta céntimos, ya está auditado, y no depende de que yo no haya
//! metido un bug aquí.
//!
//! ## Lo que sí garantiza
//!
//! 1. El principal solo puede volver a su dueño: `withdraw_unstaked` paga a la cuenta
//!    asociada del owner, derivada de su dirección, no a la que diga quien firma.
//! 2. No hay ninguna instrucción que saque de la bóveda del principal hacia la
//!    autoridad. Ninguna. El dinero de los stakers no lo puede mover nadie más.
//! 3. Lo que se pide retirar deja de rendir en el acto, así que no cobra recompensas
//!    de un periodo en el que ya estaba de salida.
//! 4. Pedir otra salida con una pendiente REINICIA el reloj: si no, bastaría pedir un
//!    token el primer día para tener la cuenta atrás corriendo.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

/*
 * DIRECCIÓN DEL PROGRAMA. Esta es la de DEVNET, y va con el keypair de
 * target/deploy/pill_staking-keypair.json. Es un valor por red: mainnet lleva el suyo
 * y hay que cambiar esta línea y recompilar. Si no coincide con el keypair del
 * despliegue, Anchor rechaza TODAS las instrucciones con DeclaredProgramIdMismatch.
 */
declare_id!("6PHKEA9qmFGjUSJBLJ3wSkkpKn1aEch9kzfTXfo5e65b");

/*
 * QUIÉN PUEDE INICIALIZAR. Misma razón que en pill_custody: sin esto `initialize` es
 * una carrera que cualquiera puede ganar, y como la config es `init` no admite una
 * segunda llamada — el programa quedaría inservible con su renta dentro.
 *
 * AL CAMBIAR DE RED HAY QUE CAMBIAR ESTO, y scripts/deploy-staking.sh lo comprueba
 * contra la wallet activa antes de gastar un lamport.
 */
pub const DEPLOYER: Pubkey = anchor_lang::solana_program::pubkey!("4ToGD9MyS5vxDtGGMgU2SRvmqnZ66XHmaUgKKdH65YMN");

pub const CONFIG_SEED: &[u8] = b"config";
pub const STAKE_SEED: &[u8] = b"stake";
pub const REWARDS_SEED: &[u8] = b"rewards";

/// Escala del acumulador. Con 1e12 y 6 decimales, un pool de mil millones de $PILL
/// sigue repartiendo bien cantidades de céntimos sin que el redondeo se coma nada.
pub const PRECISION: u128 = 1_000_000_000_000;

/// Lo que se espera desde que pides salir hasta que puedes retirar.
pub const UNSTAKE_COOLDOWN_SECS: i64 = 7 * 86_400;

/// Periodo mínimo de goteo. Menos de una hora es casi repartir de golpe, que es lo
/// que el goteo viene a evitar.
pub const MIN_DURATION_SECS: i64 = 3_600;

#[program]
pub mod pill_staking {
    use super::*;

    /// Crea la config y las dos bóvedas. Una sola vez.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.pending_authority = None;
        cfg.mint = ctx.accounts.mint.key();
        cfg.config_bump = ctx.bumps.config;
        cfg.stake_bump = ctx.bumps.stake_vault;
        cfg.rewards_bump = ctx.bumps.reward_vault;
        cfg.total_staked = 0;
        cfg.acc_reward_per_share = 0;
        cfg.reward_rate = 0;
        cfg.period_finish = 0;
        cfg.last_update = now;
        cfg.total_funded = 0;
        cfg.total_paid = 0;
        emit!(Initialized {
            authority: cfg.authority,
            mint: cfg.mint,
            stake_vault: ctx.accounts.stake_vault.key(),
            reward_vault: ctx.accounts.reward_vault.key(),
        });
        Ok(())
    }

    /// Mete $PILL en el pool. El principal sigue siendo del usuario.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        actualiza_pool(&mut ctx.accounts.config, now)?;
        liquida(&ctx.accounts.config, &mut ctx.accounts.stake_account)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let acc = &mut ctx.accounts.stake_account;
        acc.owner = ctx.accounts.owner.key();
        acc.amount = acc.amount.checked_add(amount).ok_or(StakingError::MathOverflow)?;
        acc.bump = ctx.bumps.stake_account;
        let cfg = &mut ctx.accounts.config;
        cfg.total_staked = cfg.total_staked.checked_add(amount).ok_or(StakingError::MathOverflow)?;
        // El índice se reapunta DESPUÉS de subir el saldo: si no, lo que acaba de
        // entrar cobraría recompensas de antes de estar dentro.
        acc.reward_per_share_paid = cfg.acc_reward_per_share;

        emit!(Staked { owner: acc.owner, amount, total: acc.amount });
        Ok(())
    }

    /// Pide la salida de parte del principal. NO mueve tokens.
    ///
    /// Lo pedido deja de rendir en el acto y sale de `total_staked` — si siguiera
    /// contando, el resto de stakers cobraría menos por unos tokens que ya están de
    /// salida.
    ///
    /// Pedir de nuevo con una salida ya pendiente suma la cantidad y REINICIA el
    /// reloj. Sin eso, bastaría pedir un token el primer día para tener la cuenta
    /// atrás corriendo y ampliarla al máximo justo antes de que venza.
    pub fn request_unstake(ctx: Context<RequestUnstake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        require!(ctx.accounts.stake_account.amount >= amount, StakingError::NotEnoughStaked);
        let now = Clock::get()?.unix_timestamp;
        actualiza_pool(&mut ctx.accounts.config, now)?;
        liquida(&ctx.accounts.config, &mut ctx.accounts.stake_account)?;

        let acc = &mut ctx.accounts.stake_account;
        acc.amount -= amount;
        acc.unstaking = acc.unstaking.checked_add(amount).ok_or(StakingError::MathOverflow)?;
        acc.unstake_ready_at = now
            .checked_add(UNSTAKE_COOLDOWN_SECS)
            .ok_or(StakingError::MathOverflow)?;

        let cfg = &mut ctx.accounts.config;
        cfg.total_staked = cfg.total_staked.saturating_sub(amount);
        acc.reward_per_share_paid = cfg.acc_reward_per_share;

        emit!(UnstakeRequested {
            owner: acc.owner,
            amount,
            total_unstaking: acc.unstaking,
            ready_at: acc.unstake_ready_at,
        });
        Ok(())
    }

    /// Retira lo que ya cumplió el enfriamiento. Todo lo pedido, no una parte:
    /// partirlo solo daría más transacciones y más formas de equivocarse.
    pub fn withdraw_unstaked(ctx: Context<WithdrawUnstaked>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let amount = ctx.accounts.stake_account.unstaking;
        require!(amount > 0, StakingError::NothingToWithdraw);
        require!(
            now >= ctx.accounts.stake_account.unstake_ready_at,
            StakingError::CooldownOpen
        );

        let bump = ctx.accounts.config.stake_bump;
        let seeds: &[&[u8]] = &[STAKE_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.stake_vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        let acc = &mut ctx.accounts.stake_account;
        acc.unstaking = 0;
        acc.unstake_ready_at = 0;

        emit!(Unstaked { owner: acc.owner, amount, total: acc.amount });
        Ok(())
    }

    /// Cobra las recompensas acumuladas. El principal no se toca.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        actualiza_pool(&mut ctx.accounts.config, now)?;
        liquida(&ctx.accounts.config, &mut ctx.accounts.stake_account)?;

        let pendiente = ctx.accounts.stake_account.pending;
        require!(pendiente > 0, StakingError::NothingToClaim);

        let bump = ctx.accounts.config.rewards_bump;
        let seeds: &[&[u8]] = &[REWARDS_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.reward_vault.to_account_info(),
                },
                &[seeds],
            ),
            pendiente,
        )?;

        ctx.accounts.stake_account.pending = 0;
        let cfg = &mut ctx.accounts.config;
        cfg.total_paid = cfg.total_paid.saturating_add(pendiente);
        emit!(RewardsClaimed { owner: ctx.accounts.stake_account.owner, amount: pendiente });
        Ok(())
    }

    /// Mete lo ganado DENTRO del principal, sin pasar por la wallet.
    ///
    /// Los tokens van del pozo de recompensas a la bóveda del principal: no se imprime
    /// nada, solo cambian de bolsillo dentro del programa. Por eso aquí no hace falta
    /// ninguna cuenta del usuario.
    pub fn compound(ctx: Context<Compound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        actualiza_pool(&mut ctx.accounts.config, now)?;
        liquida(&ctx.accounts.config, &mut ctx.accounts.stake_account)?;

        let amount = ctx.accounts.stake_account.pending;
        require!(amount > 0, StakingError::NothingToClaim);

        let bump = ctx.accounts.config.rewards_bump;
        let seeds: &[&[u8]] = &[REWARDS_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.reward_vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        let acc = &mut ctx.accounts.stake_account;
        acc.pending = 0;
        acc.amount = acc.amount.checked_add(amount).ok_or(StakingError::MathOverflow)?;

        let cfg = &mut ctx.accounts.config;
        cfg.total_staked = cfg.total_staked.checked_add(amount).ok_or(StakingError::MathOverflow)?;
        cfg.total_paid = cfg.total_paid.saturating_add(amount);
        acc.reward_per_share_paid = cfg.acc_reward_per_share;

        emit!(Staked { owner: acc.owner, amount, total: acc.amount });
        Ok(())
    }

    /// Llena el pozo de recompensas y lo reparte a lo largo de `duration`.
    ///
    /// Es el camino del rake: lo que factura el juego va a quien inmoviliza $PILL. El
    /// dinero sale de una cuenta normal del que llama, no de ninguna bóveda — este
    /// programa no custodia nada más que el staking.
    ///
    /// SOLO LA AUTORIDAD, y no por avaricia: quien llame a esto recalcula el ritmo de
    /// reparto. Un `fund_rewards(1, 30 días)` de un tercero estiraría lo que queda por
    /// repartir a lo largo de un mes, que es una forma barata de fastidiar a todos los
    /// stakers sin robar un token.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64, duration: i64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        require!(duration >= MIN_DURATION_SECS, StakingError::DurationTooShort);
        let now = Clock::get()?.unix_timestamp;
        actualiza_pool(&mut ctx.accounts.config, now)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        let cfg = &mut ctx.accounts.config;
        // Lo que quede sin repartir del periodo anterior se suma al nuevo: si no, cada
        // aportación antes de tiempo tiraría a la basura la cola de la anterior.
        let restante = if now < cfg.period_finish {
            (cfg.period_finish - now) as u128 * cfg.reward_rate as u128
        } else { 0 };
        let total = (amount as u128).checked_add(restante).ok_or(StakingError::MathOverflow)?;
        cfg.reward_rate = (total / duration as u128) as u64;
        cfg.period_finish = now.checked_add(duration).ok_or(StakingError::MathOverflow)?;
        cfg.last_update = now;
        cfg.total_funded = cfg.total_funded.saturating_add(amount);

        emit!(RewardsFunded { amount, duration, rate: cfg.reward_rate, until: cfg.period_finish });
        Ok(())
    }

    /// Traspaso de autoridad en DOS pasos: nombrar y aceptar.
    ///
    /// En un paso, un error de un carácter en la dirección deja el programa sin nadie
    /// que pueda volver a llenar el pozo de recompensas. El principal de los stakers
    /// no corre peligro —eso lo sacan ellos sin permiso de nadie— pero el staking se
    /// quedaría muerto para siempre.
    pub fn transfer_authority(ctx: Context<AuthorityOnly>, nueva: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = Some(nueva);
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            cfg.pending_authority == Some(ctx.accounts.new_authority.key()),
            StakingError::NotPendingAuthority
        );
        cfg.authority = ctx.accounts.new_authority.key();
        cfg.pending_authority = None;
        Ok(())
    }
}

/* ===================== CONTABILIDAD ===================== */

/*
 * Adelanta el índice global hasta `now`.
 *
 * `acc_reward_per_share` es cuánto lleva ganado un token que hubiera estado dentro
 * desde el principio. La diferencia con el índice que cada cuenta tenía apuntado la
 * última vez es lo que ha ganado desde entonces — así se paga a miles de stakers sin
 * recorrer a nadie.
 */
fn actualiza_pool(cfg: &mut Config, now: i64) -> Result<()> {
    let hasta = core::cmp::min(now, cfg.period_finish);
    if hasta > cfg.last_update && cfg.total_staked > 0 && cfg.reward_rate > 0 {
        let dt = (hasta - cfg.last_update) as u128;
        let repartido = dt
            .checked_mul(cfg.reward_rate as u128)
            .ok_or(StakingError::MathOverflow)?
            .checked_mul(PRECISION)
            .ok_or(StakingError::MathOverflow)?
            / cfg.total_staked as u128;
        cfg.acc_reward_per_share = cfg
            .acc_reward_per_share
            .checked_add(repartido)
            .ok_or(StakingError::MathOverflow)?;
    }
    // El reloj avanza aunque no haya nadie dentro: si no, al entrar el primero se le
    // pagaría todo lo acumulado mientras el pool estaba vacío.
    cfg.last_update = core::cmp::max(cfg.last_update, hasta);
    Ok(())
}

/// Pasa a `pending` lo que le toca a esta cuenta desde su última liquidación.
fn liquida(cfg: &Config, acc: &mut StakeAccount) -> Result<()> {
    if acc.amount > 0 {
        let ganado = (acc.amount as u128)
            .checked_mul(cfg.acc_reward_per_share.saturating_sub(acc.reward_per_share_paid))
            .ok_or(StakingError::MathOverflow)?
            / PRECISION;
        acc.pending = acc
            .pending
            .checked_add(ganado as u64)
            .ok_or(StakingError::MathOverflow)?;
    }
    acc.reward_per_share_paid = cfg.acc_reward_per_share;
    Ok(())
}

/* ===================== CUENTAS ===================== */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, payer = payer, space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED], bump
    )]
    pub config: Account<'info, Config>,

    /// Principal de los usuarios. PDA que es su propia autoridad: no existe ninguna
    /// llave privada capaz de firmar por ella.
    #[account(
        init, payer = payer, seeds = [STAKE_SEED], bump,
        token::mint = mint, token::authority = stake_vault,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    /// Recompensas por repartir. Separada del principal a propósito.
    #[account(
        init, payer = payer, seeds = [REWARDS_SEED], bump,
        token::mint = mint, token::authority = reward_vault,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    /// CHECK: solo se guarda como la autoridad que podrá llenar el pozo.
    pub authority: UncheckedAccount<'info>,
    #[account(mut, constraint = payer.key() == DEPLOYER @ StakingError::NotDeployer)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [STAKE_SEED], bump = config.stake_bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    /// La posición del usuario. Se crea sola la primera vez que stakea.
    #[account(
        init_if_needed, payer = owner,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [STAKE_SEED, owner.key().as_ref()], bump
    )]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut, constraint = from.mint == config.mint @ StakingError::WrongMint)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestUnstake<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()], bump = stake_account.bump,
        has_one = owner @ StakingError::NotYourStake
    )]
    pub stake_account: Account<'info, StakeAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawUnstaked<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [STAKE_SEED], bump = config.stake_bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()], bump = stake_account.bump,
        has_one = owner @ StakingError::NotYourStake
    )]
    pub stake_account: Account<'info, StakeAccount>,
    /// Su cuenta asociada: el principal solo puede volver a su dueño.
    #[account(mut, associated_token::mint = mint, associated_token::authority = owner)]
    pub to: Account<'info, TokenAccount>,
    #[account(address = config.mint @ StakingError::WrongMint)]
    pub mint: Account<'info, Mint>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [REWARDS_SEED], bump = config.rewards_bump)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()], bump = stake_account.bump,
        has_one = owner @ StakingError::NotYourStake
    )]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = owner)]
    pub to: Account<'info, TokenAccount>,
    #[account(address = config.mint @ StakingError::WrongMint)]
    pub mint: Account<'info, Mint>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// El pozo de recompensas paga a la bóveda del principal: los tokens no salen del
/// programa, solo cambian de bóveda. Por eso no hay ninguna cuenta del usuario aquí.
#[derive(Accounts)]
pub struct Compound<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [REWARDS_SEED], bump = config.rewards_bump)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [STAKE_SEED], bump = config.stake_bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()], bump = stake_account.bump,
        has_one = owner @ StakingError::NotYourStake
    )]
    pub stake_account: Account<'info, StakeAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(
        mut, seeds = [CONFIG_SEED], bump = config.config_bump,
        has_one = authority @ StakingError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [REWARDS_SEED], bump = config.rewards_bump)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = from.mint == config.mint @ StakingError::WrongMint)]
    pub from: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(
        mut, seeds = [CONFIG_SEED], bump = config.config_bump,
        has_one = authority @ StakingError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    pub new_authority: Signer<'info>,
}

/* ===================== ESTADO ===================== */

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub mint: Pubkey,
    pub config_bump: u8,
    pub stake_bump: u8,
    pub rewards_bump: u8,
    /// Principal que está DENTRO y rindiendo. No incluye lo que pidió salir.
    pub total_staked: u64,
    /// Cuánto lleva ganado un token que hubiera estado dentro desde el principio,
    /// escalado por PRECISION.
    pub acc_reward_per_share: u128,
    /// Tokens por segundo que se están repartiendo ahora mismo.
    pub reward_rate: u64,
    /// Hasta cuándo dura el goteo actual.
    pub period_finish: i64,
    /// Última vez que se adelantó el índice.
    pub last_update: i64,
    /// Contadores acumulados, para poder contrastar lo que dice el servidor.
    pub total_funded: u64,
    pub total_paid: u64,
}

/// La posición de un usuario en el pool. Una por wallet, PDA ["stake", owner].
#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub owner: Pubkey,
    /// Principal que está DENTRO y rindiendo.
    pub amount: u64,
    /// El índice global en su última liquidación.
    pub reward_per_share_paid: u128,
    /// Ganado y todavía sin cobrar.
    pub pending: u64,
    /// Principal que ya pidió salir: sigue físicamente en la bóveda pero YA NO RINDE
    /// y no cuenta para total_staked.
    pub unstaking: u64,
    /// Cuándo se puede retirar lo de `unstaking`.
    pub unstake_ready_at: i64,
    pub bump: u8,
}

/* ===================== EVENTOS ===================== */

#[event]
pub struct Initialized {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
}
#[event]
pub struct Staked { pub owner: Pubkey, pub amount: u64, pub total: u64 }
#[event]
pub struct UnstakeRequested {
    pub owner: Pubkey,
    pub amount: u64,
    pub total_unstaking: u64,
    pub ready_at: i64,
}
#[event]
pub struct Unstaked { pub owner: Pubkey, pub amount: u64, pub total: u64 }
#[event]
pub struct RewardsClaimed { pub owner: Pubkey, pub amount: u64 }
#[event]
pub struct RewardsFunded { pub amount: u64, pub duration: i64, pub rate: u64, pub until: i64 }

/* ===================== ERRORES ===================== */

#[error_code]
pub enum StakingError {
    #[msg("La cantidad tiene que ser mayor que cero")]
    ZeroAmount,
    #[msg("Ese no es el mint de este programa")]
    WrongMint,
    #[msg("No eres la autoridad")]
    NotAuthority,
    #[msg("No eres la autoridad nombrada")]
    NotPendingAuthority,
    #[msg("Solo quien desplego el programa puede inicializarlo")]
    NotDeployer,
    #[msg("Esa posicion de staking no es tuya")]
    NotYourStake,
    #[msg("No tienes tanto principal dentro")]
    NotEnoughStaked,
    #[msg("No hay nada que cobrar")]
    NothingToClaim,
    #[msg("No has pedido ninguna salida")]
    NothingToWithdraw,
    #[msg("La salida todavia esta en enfriamiento")]
    CooldownOpen,
    #[msg("El periodo de reparto es demasiado corto")]
    DurationTooShort,
    #[msg("Desbordamiento aritmetico")]
    MathOverflow,
}
