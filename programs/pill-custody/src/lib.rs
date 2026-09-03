//! # pill_custody — el saldo in-game de los jugadores
//!
//! Este programa hace UNA cosa: guardar el $PILL que los jugadores meten en el
//! juego, en una cuenta que **no tiene llave privada**. Nada de premios, nada de
//! staking, nada de bloqueos de años. Es el trozo pequeño y barato de desplegar, y
//! es también el que más urge que sea inmutable — porque aquí el dinero es de los
//! jugadores, no mío.
//!
//! ## Lo que cambia respecto a tener el dinero en mi wallet
//!
//! Hoy los depósitos van a una wallet normal, con su llave privada, que puedo
//! vaciar en una transacción. Con esto van a `["custody"]`, una PDA que es su
//! propia autoridad: no existe ningún número que sirva como llave de esa dirección.
//! Solo puede sacar tokens este programa, ejecutando este código.
//!
//! ## Las dos firmas del retiro
//!
//! `withdraw` exige que firmen DOS: la autoridad y el jugador.
//!
//! La autoridad tiene que firmar porque los saldos viven fuera de la cadena — el
//! contrato no sabe cuánto le debe a quién, solo el servidor lo sabe. Y el jugador
//! firma porque es su dinero. Además el destino no lo elige quien firma: es la
//! cuenta asociada del jugador, derivada de su dirección y del mint.
//!
//! Lo que esto NO impide, dicho claro: quien tenga la clave de la autoridad puede
//! generar una wallet suya y firmar las dos partes. La firma del jugador no protege
//! contra un servidor comprometido — protege contra que un retiro se desvíe a otra
//! dirección, y deja constancia de quién cobró. Contra lo primero solo hay
//! multisig, y eso necesita un tercero.
//!
//! ## Lo que este programa NO tiene, a propósito
//!
//! Ni timelock, ni caps, ni premios, ni staking. Cada cosa que se añade son bytes,
//! y los bytes son renta que se paga al desplegar y que queda inmovilizada para
//! siempre en cuanto se revoca la upgrade authority. Lo que no está aquí vive en
//! `pill_treasury`, que se despliega aparte y más tarde.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// Provisional, solo para poder compilar y medir el tamano. La definitiva se
// grindea con scripts/grind-program-id.js antes de desplegar, igual que se hizo con
// la del contrato de tesoreria.
declare_id!("8WnuBzocee451WyjNyaCRzeuXdsWU8bUgZqrQ3XfKSd2");

/*
 * QUIEN PUEDE INICIALIZAR. Va aqui, en el binario, y no como una comprobacion
 * contra la upgrade authority — que seria mas elegante pero cuesta 63 KB de codigo
 * (0,44 SOL de renta) porque arrastra medio bpf_loader_upgradeable. Esto son 640
 * bytes: 0,0045 SOL por la misma proteccion.
 *
 * Sin ella, `initialize` es una carrera. Cualquiera que vigile despliegues puede
 * llamarla antes que yo, ponerse de autoridad y con su propio mint. No roba nada
 * —la boveda esta vacia— pero como la config es `init` no admite una segunda
 * llamada: el programa queda inservible y hay que desplegar otra vez en otra
 * direccion, con los 1,56 SOL del primero dentro.
 *
 * AL CAMBIAR DE RED HAY QUE CAMBIAR ESTO. Un despliegue con la direccion
 * equivocada aqui cuesta exactamente lo mismo que el ataque del que protege, asi
 * que scripts/deploy-custody.sh lo comprueba contra la wallet activa ANTES de
 * gastar un lamport.
 */
pub const DEPLOYER: Pubkey = anchor_lang::solana_program::pubkey!("4ToGD9MyS5vxDtGGMgU2SRvmqnZ66XHmaUgKKdH65YMN");

pub const CONFIG_SEED: &[u8] = b"config";
pub const CUSTODY_SEED: &[u8] = b"custody";

#[program]
pub mod pill_custody {
    use super::*;

    /// Crea la config y la bóveda de custodia. Una sola vez.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.pending_authority = None;
        cfg.mint = ctx.accounts.mint.key();
        cfg.config_bump = ctx.bumps.config;
        cfg.custody_bump = ctx.bumps.custody;
        cfg.total_deposited = 0;
        cfg.total_withdrawn = 0;
        emit!(Initialized {
            authority: cfg.authority,
            mint: cfg.mint,
            custody: ctx.accounts.custody.key(),
        });
        Ok(())
    }

    /// Wallet del jugador -> CUSTODIA. La firma el jugador y nadie más.
    ///
    /// El contrato no apunta a quién es cada depósito: eso lo hace el servidor
    /// leyendo la transacción. Aquí solo se guarda el total, que es lo que permite
    /// comparar la deuda apuntada con lo que hay de verdad en la bóveda.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, CustodyError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.custody.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;
        let cfg = &mut ctx.accounts.config;
        cfg.total_deposited = cfg.total_deposited.saturating_add(amount);
        emit!(Deposited { owner: ctx.accounts.owner.key(), amount });
        Ok(())
    }

    /// CUSTODIA -> cuenta asociada del jugador. Firman la autoridad Y el jugador.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, CustodyError::ZeroAmount);
        let bump = ctx.accounts.config.custody_bump;
        let seeds: &[&[u8]] = &[CUSTODY_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.custody.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.custody.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        let cfg = &mut ctx.accounts.config;
        cfg.total_withdrawn = cfg.total_withdrawn.saturating_add(amount);
        emit!(Withdrawn { player: ctx.accounts.player.key(), amount });
        Ok(())
    }

    /// Traspaso de autoridad en DOS pasos: nombrar y aceptar.
    ///
    /// En un paso, un error de un carácter en la dirección deja el programa sin
    /// autoridad para siempre y con el dinero de los jugadores dentro, porque nadie
    /// podría volver a firmar un retiro.
    pub fn transfer_authority(ctx: Context<AuthorityOnly>, nueva: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = Some(nueva);
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            cfg.pending_authority == Some(ctx.accounts.new_authority.key()),
            CustodyError::NotPendingAuthority
        );
        cfg.authority = ctx.accounts.new_authority.key();
        cfg.pending_authority = None;
        Ok(())
    }
}

/* ===================== CUENTAS ===================== */

#[derive(Accounts)]
pub struct Initialize<'info> {

    #[account(
        init, payer = payer, space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED], bump
    )]
    pub config: Account<'info, Config>,

    /// La bóveda: token account en una PDA que es su propia autoridad. No existe
    /// ninguna llave privada capaz de firmar por ella.
    #[account(
        init, payer = payer,
        seeds = [CUSTODY_SEED], bump,
        token::mint = mint,
        token::authority = custody,
    )]
    pub custody: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    /// CHECK: solo se guarda como la autoridad que podrá ordenar retiros.
    pub authority: UncheckedAccount<'info>,
    #[account(mut, constraint = payer.key() == DEPLOYER @ CustodyError::NotDeployer)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CUSTODY_SEED], bump = config.custody_bump)]
    pub custody: Account<'info, TokenAccount>,
    #[account(mut, constraint = from.mint == config.mint @ CustodyError::WrongMint)]
    pub from: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut, seeds = [CONFIG_SEED], bump = config.config_bump,
        has_one = authority @ CustodyError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CUSTODY_SEED], bump = config.custody_bump)]
    pub custody: Account<'info, TokenAccount>,

    /// La cuenta asociada del jugador: el destino no lo elige quien firma, sale de
    /// la dirección del jugador y del mint.
    #[account(mut, associated_token::mint = mint, associated_token::authority = player)]
    pub to: Account<'info, TokenAccount>,
    #[account(address = config.mint @ CustodyError::WrongMint)]
    pub mint: Account<'info, Mint>,

    pub player: Signer<'info>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(
        mut, seeds = [CONFIG_SEED], bump = config.config_bump,
        has_one = authority @ CustodyError::NotAuthority
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
    pub custody_bump: u8,
    /// Contadores acumulados: con ellos cualquiera compara la deuda que el servidor
    /// publica contra lo que de verdad hay en la bóveda.
    pub total_deposited: u64,
    pub total_withdrawn: u64,
}

/* ===================== EVENTOS ===================== */

#[event]
pub struct Initialized { pub authority: Pubkey, pub mint: Pubkey, pub custody: Pubkey }
#[event]
pub struct Deposited { pub owner: Pubkey, pub amount: u64 }
#[event]
pub struct Withdrawn { pub player: Pubkey, pub amount: u64 }

/* ===================== ERRORES ===================== */

#[error_code]
pub enum CustodyError {
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
}
