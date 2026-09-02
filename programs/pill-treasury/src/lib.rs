/*!
 * pill_treasury — la caja fuerte de PillWars.
 *
 * DOS BOLSAS SEPARADAS, con reglas distintas y direcciones distintas:
 *
 *   CUSTODY  ["custody"]   Dinero de los JUGADORES. Entra con deposit(); sale con
 *                          withdraw() a la wallet del jugador, con sweep() hacia la
 *                          tesoreria y con burn() al vacio (la tienda de skins).
 *                          Las tres salidas que no son withdraw van capadas por
 *                          epoca. Es deuda, no es mia.
 *
 *   TREASURY ["treasury"]  Dinero del PROYECTO. Entra con fund() y con sweep().
 *                          BLOQUEADO hasta unlock_ts (años). Antes de esa fecha la
 *                          UNICA salida es claim(), y claim() no pregunta a nadie a
 *                          quien pagar: el destinatario y la cantidad salen de una
 *                          hoja de un arbol de Merkle cuya raiz se publico al menos
 *                          challenge_secs antes (48 h por defecto).
 *
 * POR QUE ASI. Un vault del que la autoridad puede ordenar pagos arbitrarios no esta
 * bloqueado: bastaria con declarar que mis wallets son el top 10 del dia. El problema
 * no es el acceso a los fondos, es el acceso al CRITERIO. Este programa no puede
 * juzgar quien jugo bien —solo ve firmas—, asi que hace lo unico que si puede hacer:
 * obliga a que el criterio sea publico y ANTERIOR al pago, y a que el pago no lo
 * ejecute la autoridad.
 *
 *   dia D    se juega. El servidor publica el leaderboard del dia (hash encadenado).
 *   dia D+1  publish_round(): se anota una raiz de 32 bytes. NO se mueve un token.
 *            Empieza la ventana de impugnacion. La lista completa se publica off-chain
 *            y cualquiera puede recalcular la raiz y contrastarla con el leaderboard.
 *   dia D+3  claim(): lo ejecuta el ganador (o cualquiera por el). Los tokens van a
 *            la ATA que dice la hoja, no a la que diga quien firma.
 *
 * LO QUE ESTE PROGRAMA GARANTIZA (no se puede saltar):
 *   1. unlock_ts solo puede AUMENTAR. extend_lock() rechaza cualquier valor menor.
 *   2. Antes de unlock_ts no existe ninguna instruccion que saque del treasury hacia
 *      una cuenta elegida en el momento. Solo claim().
 *   3. publish_round() no mueve tokens y una ronda publicada es inmutable (solo se
 *      puede cancelar DENTRO de la ventana, nunca despues).
 *   4. El flujo custody -> treasury es unidireccional. No hay treasury -> custody.
 *   5. Cada ganador cobra una vez por ronda (el recibo es un PDA: si existe, falla).
 *   6. Ninguna ronda puede reservar mas de lo que el grifo permite por epoca.
 *
 * LO QUE NO GARANTIZA — y hay que decirlo:
 *   - Si el programa queda UPGRADEABLE, todo lo anterior vale cero: con la upgrade
 *     authority se despliega otra version que vacie los vaults. Revocar la upgrade
 *     authority (`solana program set-upgrade-authority --final`) es OBLIGATORIO antes
 *     de anunciar esto como bloqueado.
 *   - Sybil: se pueden crear wallets, depositar dinero de verdad, jugar y salir en el
 *     leaderboard. Eso es multi-cuenta, cuesta dinero, va capado y es publico.
 *   - Los saldos internos de los jugadores viven off-chain. El contrato solo sabe
 *     cuanto hay en custody. La prueba de reservas (custody >= obligaciones) es la
 *     mitigacion, y es publicable.
 */
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("PiLLTreas1111111111111111111111111111111111");

pub const CONFIG_SEED: &[u8] = b"config";
pub const CUSTODY_SEED: &[u8] = b"custody";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const ROUND_SEED: &[u8] = b"round";
pub const CLAIM_SEED: &[u8] = b"claim";

/// Prefijos de dominio del arbol de Merkle. Sin ellos, un nodo interno de 64 bytes
/// podria hacerse pasar por una hoja (ataque de segunda preimagen) y alguien podria
/// fabricar una prueba para una cantidad que nunca estuvo en la lista.
const LEAF_PREFIX: u8 = 0x00;
const NODE_PREFIX: u8 = 0x01;

/// Tope de la prueba de Merkle. 20 niveles = hasta 1.048.576 ganadores por ronda;
/// mas que de sobra, y evita que alguien mande una prueba gigante para quemar CU.
const MAX_PROOF_LEN: usize = 20;

/// Cuanto se espera despues de que una ronda sea reclamable antes de poder liberar
/// lo no reclamado. Sin esto, un ganador que nunca reclama deja su parte reservada
/// para siempre y la tesoreria se va bloqueando sola ronda tras ronda.
pub const CLAIM_WINDOW_SECS: i64 = 30 * 86_400;

#[program]
pub mod pill_treasury {
    use super::*;

    /// Crea la config y los dos vaults. Una sola vez en la vida del programa.
    ///
    /// `unlock_ts` se pone CORTO al principio (30 dias) a proposito: la fase de
    /// calibracion sirve para medir con datos reales si el grifo de premios es
    /// sostenible. Solo cuando los numeros cuadran se llama a extend_lock() para
    /// llevarlo a anios y a finalize() para congelar los parametros. Al reves no se
    /// puede: un cap mal puesto no se puede subir despues.
    pub fn initialize(ctx: Context<Initialize>, args: InitArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.unlock_ts > now, TreasuryError::UnlockInThePast);
        require!(args.epoch_secs >= 3_600, TreasuryError::EpochTooShort);
        require!(args.challenge_secs >= 3_600, TreasuryError::ChallengeTooShort);
        require!(args.reward_bps_per_epoch <= 10_000, TreasuryError::BpsOutOfRange);

        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.pending_authority = Pubkey::default();
        cfg.mint = ctx.accounts.mint.key();
        cfg.unlock_ts = args.unlock_ts;
        cfg.finalized = false;
        cfg.epoch_secs = args.epoch_secs;
        cfg.reward_cap_per_epoch = args.reward_cap_per_epoch;
        cfg.reward_bps_per_epoch = args.reward_bps_per_epoch;
        cfg.challenge_secs = args.challenge_secs;
        cfg.sweep_cap_per_epoch = args.sweep_cap_per_epoch;
        cfg.sweep_epoch = 0;
        cfg.swept_this_epoch = 0;
        cfg.burn_cap_per_epoch = args.burn_cap_per_epoch;
        cfg.burn_epoch = 0;
        cfg.burned_this_epoch = 0;
        cfg.total_burned = 0;
        cfg.reserved = 0;
        cfg.total_deposited = 0;
        cfg.total_withdrawn = 0;
        cfg.total_funded = 0;
        cfg.total_swept = 0;
        cfg.total_rewarded = 0;
        cfg.total_expired = 0;
        cfg.rounds_published = 0;
        cfg.config_bump = ctx.bumps.config;
        cfg.custody_bump = ctx.bumps.custody;
        cfg.treasury_bump = ctx.bumps.treasury;

        emit!(Initialized {
            authority: cfg.authority,
            mint: cfg.mint,
            custody: ctx.accounts.custody.key(),
            treasury: ctx.accounts.treasury.key(),
            unlock_ts: cfg.unlock_ts,
        });
        Ok(())
    }

    /* ===================== ENTRADAS ===================== */

    /// Deposito de un jugador -> CUSTODY. Lo firma el jugador, no la autoridad.
    ///
    /// El evento lleva el owner y la cantidad: es lo que el servidor lee para acreditar
    /// el saldo interno. Se emite ademas del delta de la token account porque un evento
    /// es inequivoco — dice QUIEN deposito, aunque la transaccion agrupe varias cosas.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
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

    /// Aportacion directa a la TESORERIA. Cualquiera puede llamarla.
    ///
    /// Es la puerta por la que entran los tokens comprados en el lanzamiento. No tiene
    /// vuelta atras y ese es justo el punto: lo que entra aqui queda sujeto al
    /// timelock igual que todo lo demas, tambien para quien lo metio.
    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;
        let cfg = &mut ctx.accounts.config;
        cfg.total_funded = cfg.total_funded.saturating_add(amount);
        emit!(Funded { from: ctx.accounts.owner.key(), amount });
        Ok(())
    }

    /* ===================== SALIDAS DE CUSTODIA ===================== */

    /// CUSTODY -> wallet del jugador. La ordena la autoridad porque los saldos viven
    /// off-chain y el contrato no sabe cuanto le debe a quien.
    ///
    /// Lo que SI garantiza el contrato es de donde sale: nunca del treasury. Un bug del
    /// servidor, o la clave de la autoridad filtrada, ponen en riesgo la custodia —
    /// nunca el dinero bloqueado.
    ///
    /// El destino no puede ser el treasury: seria un sweep sin cap por la puerta de
    /// atras, y dejaria en nada el limite por epoca del sweep de verdad.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        require_keys_neq!(
            ctx.accounts.to.key(),
            ctx.accounts.treasury.key(),
            TreasuryError::DestinationIsTreasury
        );
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
        emit!(Withdrawn { to: ctx.accounts.to.key(), amount });
        Ok(())
    }

    /// CUSTODY -> TREASURY. Es el camino por el que el rake de las partidas, la tienda
    /// de skins y el conversor de SP alimentan la tesoreria.
    ///
    /// NOTA IMPORTANTE sobre las skins: el contrato no sabe que es una skin. No conoce
    /// precios, ni codigos, ni catalogos — solo ve una cantidad. Se pueden anadir skins,
    /// cambiar precios o inventarse un pase de temporada sin tocar una linea de aqui,
    /// que es lo que permite finalizar el programa y revocar la upgrade authority.
    ///
    /// Va capado por epoca porque, sin cap, la autoridad podria empujar toda la custodia
    /// (dinero de los jugadores) a la tesoreria, donde queda bloqueada. No la robaria
    /// —tambien se le bloquea a ella— pero dejaria a los jugadores sin poder retirar.
    pub fn sweep(ctx: Context<Sweep>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;
        let epoch = now.checked_div(cfg.epoch_secs).ok_or(TreasuryError::MathOverflow)?;
        if epoch != cfg.sweep_epoch {
            cfg.sweep_epoch = epoch;
            cfg.swept_this_epoch = 0;
        }
        let acumulado = cfg
            .swept_this_epoch
            .checked_add(amount)
            .ok_or(TreasuryError::MathOverflow)?;
        require!(acumulado <= cfg.sweep_cap_per_epoch, TreasuryError::SweepCapExceeded);

        let bump = cfg.custody_bump;
        let seeds: &[&[u8]] = &[CUSTODY_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.custody.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.custody.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        cfg.swept_this_epoch = acumulado;
        cfg.total_swept = cfg.total_swept.saturating_add(amount);
        emit!(Swept { amount, epoch });
        Ok(())
    }

    /// Quema $PILL de la CUSTODIA. Baja el supply del mint: no va a ninguna cartera.
    ///
    /// Es la otra mitad de lo que la tienda de skins ya hacia antes del contrato. El
    /// jugador gasta 25.000 $PILL en una skin: su saldo interno baja, y esos tokens
    /// —que fisicamente siguen en custodia— tienen que salir de ahi o la custodia
    /// acabaria respaldando saldos que ya nadie tiene. Una parte se quema (aqui) y
    /// otra se barre a la tesoreria (sweep).
    ///
    /// Va capada por epoca como el sweep, y por lo mismo: sin cap, quemar seria una
    /// forma de destruir la custodia de los jugadores. Aqui el cap es todavia mas
    /// importante que en el sweep, porque lo quemado no se recupera ni bloqueado.
    pub fn burn(ctx: Context<BurnFromCustody>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;
        let epoch = now.checked_div(cfg.epoch_secs).ok_or(TreasuryError::MathOverflow)?;
        if epoch != cfg.burn_epoch {
            cfg.burn_epoch = epoch;
            cfg.burned_this_epoch = 0;
        }
        let acumulado = cfg
            .burned_this_epoch
            .checked_add(amount)
            .ok_or(TreasuryError::MathOverflow)?;
        require!(acumulado <= cfg.burn_cap_per_epoch, TreasuryError::BurnCapExceeded);

        let bump = cfg.custody_bump;
        let seeds: &[&[u8]] = &[CUSTODY_SEED, &[bump]];
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.custody.to_account_info(),
                    authority: ctx.accounts.custody.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        cfg.burned_this_epoch = acumulado;
        cfg.total_burned = cfg.total_burned.saturating_add(amount);
        emit!(Burned { amount, epoch });
        Ok(())
    }

    /* ===================== PREMIOS ===================== */

    /// Publica la raiz de Merkle de una ronda de premios. NO MUEVE UN SOLO TOKEN.
    ///
    /// Lo unico que hace es escribir 32 bytes y arrancar el reloj de la ventana de
    /// impugnacion. Durante challenge_secs cualquiera puede bajarse la lista completa
    /// (publicada off-chain), recalcular la raiz y comprobar que coincide con esta, y
    /// contrastar los ganadores con el leaderboard que ya estaba publicado antes.
    ///
    /// El cap por epoca no necesita contador: la epoca va en las seeds del PDA de la
    /// ronda, asi que dos rondas de la misma epoca son imposibles. Una ronda, un cap.
    ///
    /// `total` se reserva del treasury para que no se pueda publicar mas de lo que hay
    /// (con la ventana de 48 h llega a haber tres rondas vivas a la vez).
    pub fn publish_round(
        ctx: Context<PublishRound>,
        epoch: u64,
        merkle_root: [u8; 32],
        total: u64,
        winners: u16,
    ) -> Result<()> {
        require!(total > 0, TreasuryError::ZeroAmount);
        require!(winners > 0, TreasuryError::NoWinners);
        require!(merkle_root != [0u8; 32], TreasuryError::EmptyRoot);

        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;

        // La epoca tiene que ser una que ya haya terminado: no se premian dias que aun
        // se estan jugando. Ademas ata el indice de epoca al reloj on-chain, asi que la
        // autoridad no puede inventarse mil epocas futuras y publicar mil rondas hoy.
        let epoca_actual = now.checked_div(cfg.epoch_secs).ok_or(TreasuryError::MathOverflow)? as u64;
        require!(epoch < epoca_actual, TreasuryError::EpochNotFinished);

        // Grifo: el minimo entre el tope absoluto y el relativo al saldo.
        let saldo = ctx.accounts.treasury.amount;
        let tope_rel = (saldo as u128)
            .checked_mul(cfg.reward_bps_per_epoch as u128)
            .ok_or(TreasuryError::MathOverflow)?
            / 10_000u128;
        let tope = core::cmp::min(cfg.reward_cap_per_epoch as u128, tope_rel) as u64;
        require!(total <= tope, TreasuryError::RewardCapExceeded);

        // Y que de verdad haya fondos: lo ya reservado por otras rondas vivas no cuenta.
        let nueva_reserva = cfg.reserved.checked_add(total).ok_or(TreasuryError::MathOverflow)?;
        require!(nueva_reserva <= saldo, TreasuryError::InsufficientTreasury);

        let round = &mut ctx.accounts.round;
        round.epoch = epoch;
        round.merkle_root = merkle_root;
        round.total = total;
        round.claimed = 0;
        round.winners = winners;
        round.published_at = now;
        round.claimable_at = now.checked_add(cfg.challenge_secs).ok_or(TreasuryError::MathOverflow)?;
        round.cancelled = false;
        round.expired = false;
        round.bump = ctx.bumps.round;

        cfg.reserved = nueva_reserva;
        cfg.rounds_published = cfg.rounds_published.saturating_add(1);

        emit!(RoundPublished {
            epoch,
            merkle_root,
            total,
            winners,
            claimable_at: round.claimable_at,
        });
        Ok(())
    }

    /// Anula una ronda. SOLO dentro de la ventana de impugnacion.
    ///
    /// Existe para poder corregir un error de calculo despues de publicar. Pasada la
    /// ventana es imposible: si se pudiera cancelar despues, la ventana no serviria de
    /// nada — bastaria con esperar a ver quien reclama y cancelar la ronda entera.
    pub fn cancel_round(ctx: Context<CancelRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;
        require!(!round.cancelled, TreasuryError::RoundCancelled);
        require!(now < round.claimable_at, TreasuryError::ChallengeWindowClosed);

        let pendiente = round.total.saturating_sub(round.claimed);
        round.cancelled = true;
        let cfg = &mut ctx.accounts.config;
        cfg.reserved = cfg.reserved.saturating_sub(pendiente);
        emit!(RoundCancelled { epoch: round.epoch, liberado: pendiente });
        Ok(())
    }

    /// Cobra un premio. LA UNICA SALIDA DEL TREASURY ANTES DE unlock_ts.
    ///
    /// La firma esta, pero no decide nada: el destinatario es `winner`, y `winner` solo
    /// vale si la hoja sha256(0x00 || epoch || winner || amount) esta en el arbol cuya
    /// raiz se publico hace al menos challenge_secs. Quien firma solo paga el gas — de
    /// hecho puede reclamar cualquiera en nombre del ganador; los tokens van a la ATA
    /// del ganador igualmente.
    ///
    /// Por eso la autoridad no puede desviar un premio: cambiar el destinatario cambia
    /// la hoja, cambiar la hoja rompe la prueba, y la raiz lleva 48 h escrita en piedra.
    pub fn claim(ctx: Context<Claim>, epoch: u64, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        require!(proof.len() <= MAX_PROOF_LEN, TreasuryError::ProofTooLong);

        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;
        require!(!round.cancelled, TreasuryError::RoundCancelled);
        require!(!round.expired, TreasuryError::RoundExpired);
        require!(now >= round.claimable_at, TreasuryError::ChallengeWindowOpen);

        // sha256 y no keccak: es el mismo syscall de barato on-chain, y fuera de la
        // cadena lo tiene cualquier runtime sin instalar nada (en Node es crypto a
        // secas). El servidor construye este mismo arbol, asi que cuanto menos
        // dependa de una libreria de hash exotica, menos formas hay de que las dos
        // implementaciones se separen sin que nadie se entere.
        let hoja = hash::hashv(&[
            &[LEAF_PREFIX],
            &epoch.to_le_bytes(),
            ctx.accounts.winner.key().as_ref(),
            &amount.to_le_bytes(),
        ])
        .to_bytes();
        require!(verify_proof(&proof, round.merkle_root, hoja), TreasuryError::InvalidProof);

        // Aunque la prueba sea valida, nunca por encima del total anunciado: si la
        // autoridad publicase un total menor que la suma real de la lista, el exceso
        // saldria de lo reservado por OTRAS rondas.
        let ya = round.claimed.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
        require!(ya <= round.total, TreasuryError::RoundOverclaimed);

        let bump = ctx.accounts.config.treasury_bump;
        let seeds: &[&[u8]] = &[TREASURY_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury.to_account_info(),
                    to: ctx.accounts.winner_ata.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        round.claimed = ya;
        let receipt = &mut ctx.accounts.receipt;
        receipt.amount = amount;
        receipt.ts = now;
        receipt.bump = ctx.bumps.receipt;

        let cfg = &mut ctx.accounts.config;
        cfg.reserved = cfg.reserved.saturating_sub(amount);
        cfg.total_rewarded = cfg.total_rewarded.saturating_add(amount);

        emit!(Claimed { epoch, winner: ctx.accounts.winner.key(), amount });
        Ok(())
    }

    /// Libera lo que nadie reclamo de una ronda vieja. La puede llamar CUALQUIERA.
    ///
    /// No mueve tokens: solo baja el contador de reservado para que ese dinero pueda
    /// volver a repartirse en rondas futuras. Sin esto, un ganador que pierde su wallet
    /// deja su parte inmovilizada para siempre y la tesoreria se estrangula sola.
    ///
    /// Es permissionless a proposito: solo puede aflojar una reserva pasada la ventana
    /// de 30 dias, asi que no hay nada que ganar llamandola, y asi la tesoreria no
    /// depende de que la autoridad se acuerde de hacer limpieza.
    pub fn expire_round(ctx: Context<ExpireRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;
        require!(!round.expired && !round.cancelled, TreasuryError::RoundExpired);
        let limite = round
            .claimable_at
            .checked_add(CLAIM_WINDOW_SECS)
            .ok_or(TreasuryError::MathOverflow)?;
        require!(now >= limite, TreasuryError::ClaimWindowOpen);

        let pendiente = round.total.saturating_sub(round.claimed);
        round.expired = true;
        let cfg = &mut ctx.accounts.config;
        cfg.reserved = cfg.reserved.saturating_sub(pendiente);
        cfg.total_expired = cfg.total_expired.saturating_add(pendiente);
        emit!(RoundExpired { epoch: round.epoch, liberado: pendiente });
        Ok(())
    }

    /* ===================== EL CERROJO ===================== */

    /// Alarga el bloqueo. Nunca lo acorta — es la invariante que sostiene todo lo demas.
    ///
    /// Sigue permitida despues de finalize(): alargar el bloqueo siempre va en la
    /// direccion de mas restriccion, y poder alargarlo mas adelante no le quita
    /// garantias a nadie.
    pub fn extend_lock(ctx: Context<AuthorityOnly>, new_unlock_ts: i64) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(new_unlock_ts > cfg.unlock_ts, TreasuryError::LockWouldShorten);
        let anterior = cfg.unlock_ts;
        cfg.unlock_ts = new_unlock_ts;
        emit!(LockExtended { anterior, nuevo: new_unlock_ts });
        Ok(())
    }

    /// Endurece los limites. SOLO en la direccion de mas restriccion:
    /// caps a la baja, ventana de impugnacion al alza. Nada mas.
    ///
    /// Un `None` deja el valor como esta. Esta es la herramienta de la fase de
    /// calibracion: se puede apretar cuantas veces haga falta, aflojar ninguna.
    pub fn tighten(ctx: Context<AuthorityOnly>, args: TightenArgs) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.finalized, TreasuryError::AlreadyFinalized);
        if let Some(v) = args.reward_cap_per_epoch {
            require!(v <= cfg.reward_cap_per_epoch, TreasuryError::WouldLoosen);
            cfg.reward_cap_per_epoch = v;
        }
        if let Some(v) = args.reward_bps_per_epoch {
            require!(v <= cfg.reward_bps_per_epoch, TreasuryError::WouldLoosen);
            cfg.reward_bps_per_epoch = v;
        }
        if let Some(v) = args.sweep_cap_per_epoch {
            require!(v <= cfg.sweep_cap_per_epoch, TreasuryError::WouldLoosen);
            cfg.sweep_cap_per_epoch = v;
        }
        if let Some(v) = args.burn_cap_per_epoch {
            require!(v <= cfg.burn_cap_per_epoch, TreasuryError::WouldLoosen);
            cfg.burn_cap_per_epoch = v;
        }
        if let Some(v) = args.challenge_secs {
            require!(v >= cfg.challenge_secs, TreasuryError::WouldLoosen);
            cfg.challenge_secs = v;
        }
        emit!(Tightened {
            reward_cap_per_epoch: cfg.reward_cap_per_epoch,
            reward_bps_per_epoch: cfg.reward_bps_per_epoch,
            sweep_cap_per_epoch: cfg.sweep_cap_per_epoch,
            burn_cap_per_epoch: cfg.burn_cap_per_epoch,
            challenge_secs: cfg.challenge_secs,
        });
        Ok(())
    }

    /// Congela los parametros para siempre. No hay vuelta atras, y ese es el punto.
    ///
    /// Se llama cuando la calibracion ha terminado y los numeros cuadran. A partir de
    /// aqui ni siquiera se pueden endurecer: lo que hay escrito es lo que habra.
    pub fn finalize(ctx: Context<AuthorityOnly>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.finalized, TreasuryError::AlreadyFinalized);
        cfg.finalized = true;
        emit!(Finalized { unlock_ts: cfg.unlock_ts });
        Ok(())
    }

    /// Traspaso de autoridad en dos pasos: nombrar y aceptar.
    ///
    /// En un paso, un error de un caracter en la direccion deja el programa sin
    /// autoridad para siempre — no se podrian pagar retiros ni publicar rondas. La
    /// autoridad NO da acceso a la tesoreria, asi que rotarla es una operacion de
    /// seguridad normal (clave filtrada, cambio de servidor), no un riesgo de fondos.
    pub fn transfer_authority(ctx: Context<AuthorityOnly>, nueva: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.pending_authority = nueva;
        emit!(AuthorityTransferStarted { nueva });
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        let nueva = ctx.accounts.new_authority.key();
        require_keys_eq!(cfg.pending_authority, nueva, TreasuryError::NotPendingAuthority);
        let anterior = cfg.authority;
        cfg.authority = nueva;
        cfg.pending_authority = Pubkey::default();
        emit!(AuthorityTransferred { anterior, nueva });
        Ok(())
    }

    /* ===================== DESPUES DEL DESBLOQUEO ===================== */

    /// TREASURY -> donde sea. Solo a partir de unlock_ts.
    ///
    /// Es la unica instruccion que saca de la tesoreria a una cuenta elegida por la
    /// autoridad, y esta cerrada durante todos los anios del bloqueo. Cuando venza, el
    /// programa deja de ser una caja fuerte y pasa a ser una cuenta normal.
    pub fn unlock_withdraw(ctx: Context<UnlockWithdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        require!(now >= cfg.unlock_ts, TreasuryError::StillLocked);

        // Lo reservado por rondas vivas sigue siendo de los ganadores aunque el
        // bloqueo haya vencido: un premio publicado se paga.
        let disponible = ctx.accounts.treasury.amount.saturating_sub(cfg.reserved);
        require!(amount <= disponible, TreasuryError::InsufficientTreasury);

        let bump = cfg.treasury_bump;
        let seeds: &[&[u8]] = &[TREASURY_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        emit!(UnlockWithdrawn { to: ctx.accounts.to.key(), amount });
        Ok(())
    }
}

/* ===================== MERKLE ===================== */

/// Verificacion clasica de pares ordenados: en cada nivel se ordenan los dos hijos
/// antes de hashear, asi la prueba no necesita llevar la posicion de cada nodo.
fn verify_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: [u8; 32]) -> bool {
    let mut acc = leaf;
    for nodo in proof.iter() {
        acc = if acc <= *nodo {
            hash::hashv(&[&[NODE_PREFIX], &acc, nodo]).to_bytes()
        } else {
            hash::hashv(&[&[NODE_PREFIX], nodo, &acc]).to_bytes()
        };
    }
    acc == root
}

/// La misma hoja que calcula claim(). Aparte para poder testearla sin montar un
/// contexto de instruccion entero.
fn leaf_hash(epoch: u64, winner: &[u8; 32], amount: u64) -> [u8; 32] {
    hash::hashv(&[
        &[LEAF_PREFIX],
        &epoch.to_le_bytes(),
        winner,
        &amount.to_le_bytes(),
    ])
    .to_bytes()
}

#[cfg(test)]
mod test_vectors;

#[cfg(test)]
mod tests {
    use super::*;

    /*
     * El test que importa de verdad: que este programa acepte EXACTAMENTE lo que
     * genera server/merkle.js y rechace lo demas.
     *
     * Las dos implementaciones del arbol viven en lenguajes distintos y no hay
     * ningun sitio donde se ejecuten juntas. Si se separan —un prefijo de dominio
     * cambiado, otro orden de bytes, sha256 en un lado y keccak en el otro— ningun
     * claim funciona, y nadie se entera hasta que un jugador intenta cobrar y le
     * rebota InvalidProof.
     *
     * Los vectores los genera `node scripts/gen-merkle-vectors.js`. Si esto falla,
     * NO se regeneran para que pase: es que una de las dos se movio.
     */
    #[test]
    fn casa_con_el_arbol_del_servidor() {
        for v in test_vectors::VECTORS {
            let hoja = leaf_hash(v.epoch, &v.winner, v.amount);
            let ok = verify_proof(v.proof, v.root, hoja);
            assert_eq!(
                ok, v.valid,
                "vector con epoch={} amount={} deberia dar {}",
                v.epoch, v.amount, v.valid
            );
        }
    }

    #[test]
    fn hoja_y_nodo_viven_en_dominios_distintos() {
        // Sin los prefijos, un nodo interno de 64 bytes podria presentarse como una
        // hoja y alguien fabricaria una prueba de un premio que nunca existio.
        let a = [1u8; 32];
        let b = [2u8; 32];
        let como_nodo = hash::hashv(&[&[NODE_PREFIX], &a, &b]).to_bytes();
        let sin_prefijo = hash::hashv(&[&a, &b]).to_bytes();
        assert_ne!(como_nodo, sin_prefijo);
    }

    #[test]
    fn cada_campo_de_la_hoja_cambia_el_hash() {
        // Si alguno no entrara en la hoja, una prueba serviria para cobrar otra
        // cantidad, en otra epoca o a otra wallet.
        let w = [7u8; 32];
        let base = leaf_hash(100, &w, 500);
        assert_ne!(base, leaf_hash(101, &w, 500), "la epoca no entra en la hoja");
        assert_ne!(base, leaf_hash(100, &w, 501), "la cantidad no entra en la hoja");
        assert_ne!(base, leaf_hash(100, &[8u8; 32], 500), "la wallet no entra en la hoja");
    }

    #[test]
    fn una_prueba_vacia_solo_vale_si_la_raiz_es_la_hoja() {
        let hoja = leaf_hash(1, &[3u8; 32], 42);
        assert!(verify_proof(&[], hoja, hoja));
        assert!(!verify_proof(&[], [0u8; 32], hoja));
    }

    #[test]
    fn el_orden_de_los_hermanos_da_igual() {
        // Pares ordenados: por eso la prueba no lleva la posicion de cada nodo.
        let a = leaf_hash(1, &[1u8; 32], 10);
        let b = leaf_hash(1, &[2u8; 32], 20);
        let raiz = if a <= b {
            hash::hashv(&[&[NODE_PREFIX], &a, &b]).to_bytes()
        } else {
            hash::hashv(&[&[NODE_PREFIX], &b, &a]).to_bytes()
        };
        assert!(verify_proof(&[b], raiz, a));
        assert!(verify_proof(&[a], raiz, b));
    }
}

/* ===================== CUENTAS ===================== */

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub mint: Pubkey,
    /// Fecha de desbloqueo de la tesoreria. Solo puede aumentar.
    pub unlock_ts: i64,
    pub finalized: bool,
    pub epoch_secs: i64,
    pub reward_cap_per_epoch: u64,
    pub reward_bps_per_epoch: u16,
    pub challenge_secs: i64,
    pub sweep_cap_per_epoch: u64,
    pub sweep_epoch: i64,
    pub swept_this_epoch: u64,
    /// Grifo de la quema. Aparte del de sweep: son salidas distintas y una de ellas
    /// (esta) es irreversible incluso para la tesoreria.
    pub burn_cap_per_epoch: u64,
    pub burn_epoch: i64,
    pub burned_this_epoch: u64,
    pub total_burned: u64,
    /// Suma de lo pendiente de reclamar en rondas vivas. Bloquea ese saldo.
    pub reserved: u64,
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub total_funded: u64,
    pub total_swept: u64,
    pub total_rewarded: u64,
    pub total_expired: u64,
    pub rounds_published: u64,
    pub config_bump: u8,
    pub custody_bump: u8,
    pub treasury_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RewardRound {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub total: u64,
    pub claimed: u64,
    pub winners: u16,
    pub published_at: i64,
    pub claimable_at: i64,
    pub cancelled: bool,
    pub expired: bool,
    pub bump: u8,
}

/// Recibo de cobro. Que exista es la prueba de que esa wallet ya cobro esa ronda:
/// el segundo intento falla al intentar crear una cuenta que ya existe.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub amount: u64,
    pub ts: i64,
    pub bump: u8,
}

/* ===================== ARGUMENTOS ===================== */

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitArgs {
    pub unlock_ts: i64,
    pub epoch_secs: i64,
    pub reward_cap_per_epoch: u64,
    pub reward_bps_per_epoch: u16,
    pub challenge_secs: i64,
    pub sweep_cap_per_epoch: u64,
    pub burn_cap_per_epoch: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TightenArgs {
    pub reward_cap_per_epoch: Option<u64>,
    pub reward_bps_per_epoch: Option<u16>,
    pub sweep_cap_per_epoch: Option<u64>,
    pub burn_cap_per_epoch: Option<u64>,
    pub challenge_secs: Option<i64>,
}

/* ===================== CONTEXTOS ===================== */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Vault de custodia: token account en un PDA que es su propia autoridad.
    /// No existe ninguna llave privada capaz de firmar por ella.
    #[account(
        init,
        payer = payer,
        seeds = [CUSTODY_SEED],
        bump,
        token::mint = mint,
        token::authority = custody,
    )]
    pub custody: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [TREASURY_SEED],
        bump,
        token::mint = mint,
        token::authority = treasury,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    /// CHECK: solo se guarda como autoridad; no se lee ni se escribe.
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
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
    #[account(mut, constraint = from.mint == config.mint @ TreasuryError::WrongMint)]
    pub from: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut, constraint = from.mint == config.mint @ TreasuryError::WrongMint)]
    pub from: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CUSTODY_SEED], bump = config.custody_bump)]
    pub custody: Account<'info, TokenAccount>,
    /// Se pasa solo para poder comprobar que el destino no es el treasury.
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut, constraint = to.mint == config.mint @ TreasuryError::WrongMint)]
    pub to: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CUSTODY_SEED], bump = config.custody_bump)]
    pub custody: Account<'info, TokenAccount>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnFromCustody<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CUSTODY_SEED], bump = config.custody_bump)]
    pub custody: Account<'info, TokenAccount>,
    /// Mutable: quemar baja el supply, que vive en la cuenta del mint.
    #[account(mut, address = config.mint @ TreasuryError::WrongMint)]
    pub mint: Account<'info, Mint>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct PublishRound<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    /// El PDA lleva la epoca en las seeds: publicar dos veces la misma epoca es
    /// imposible, y con ello el cap por epoca se aplica solo.
    #[account(
        init,
        payer = authority,
        space = 8 + RewardRound::INIT_SPACE,
        seeds = [ROUND_SEED, &epoch.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, RewardRound>,
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelRound<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round.epoch.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, RewardRound>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct Claim<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &epoch.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, RewardRound>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,

    /// El ganador NO firma. Su direccion sale de la hoja del Merkle.
    /// CHECK: solo se usa como semilla y como dueno de la ATA de destino.
    pub winner: UncheckedAccount<'info>,

    /// La ATA del ganador para este mint. Se crea si no existe (la paga quien firme).
    /// Que sea la ATA canonica es lo que impide desviar el pago a otra cuenta.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = winner,
    )]
    pub winner_ata: Account<'info, TokenAccount>,

    #[account(address = config.mint @ TreasuryError::WrongMint)]
    pub mint: Account<'info, Mint>,

    /// Recibo: si ya existe, esta instruccion falla. Es el anti doble cobro.
    #[account(
        init,
        payer = payer,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, &epoch.to_le_bytes(), winner.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, ClaimReceipt>,

    /// Cualquiera puede pagar el gas del claim, incluido un tercero.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExpireRound<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round.epoch.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, RewardRound>,
    /// Permissionless: solo libera reserva de una ronda ya caducada.
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
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

#[derive(Accounts)]
pub struct UnlockWithdraw<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.config_bump,
        has_one = authority @ TreasuryError::NotAuthority
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut, constraint = to.mint == config.mint @ TreasuryError::WrongMint)]
    pub to: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/* ===================== EVENTOS ===================== */

#[event]
pub struct Initialized {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub custody: Pubkey,
    pub treasury: Pubkey,
    pub unlock_ts: i64,
}
#[event]
pub struct Deposited { pub owner: Pubkey, pub amount: u64 }
#[event]
pub struct Funded { pub from: Pubkey, pub amount: u64 }
#[event]
pub struct Withdrawn { pub to: Pubkey, pub amount: u64 }
#[event]
pub struct Swept { pub amount: u64, pub epoch: i64 }
#[event]
pub struct Burned { pub amount: u64, pub epoch: i64 }
#[event]
pub struct RoundPublished {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub total: u64,
    pub winners: u16,
    pub claimable_at: i64,
}
#[event]
pub struct RoundCancelled { pub epoch: u64, pub liberado: u64 }
#[event]
pub struct RoundExpired { pub epoch: u64, pub liberado: u64 }
#[event]
pub struct Claimed { pub epoch: u64, pub winner: Pubkey, pub amount: u64 }
#[event]
pub struct LockExtended { pub anterior: i64, pub nuevo: i64 }
#[event]
pub struct Tightened {
    pub reward_cap_per_epoch: u64,
    pub reward_bps_per_epoch: u16,
    pub sweep_cap_per_epoch: u64,
    pub burn_cap_per_epoch: u64,
    pub challenge_secs: i64,
}
#[event]
pub struct Finalized { pub unlock_ts: i64 }
#[event]
pub struct AuthorityTransferStarted { pub nueva: Pubkey }
#[event]
pub struct AuthorityTransferred { pub anterior: Pubkey, pub nueva: Pubkey }
#[event]
pub struct UnlockWithdrawn { pub to: Pubkey, pub amount: u64 }

/* ===================== ERRORES ===================== */

#[error_code]
pub enum TreasuryError {
    #[msg("La cantidad debe ser mayor que cero")]
    ZeroAmount,
    #[msg("Solo la autoridad puede hacer esto")]
    NotAuthority,
    #[msg("La cuenta de tokens no es del mint de este programa")]
    WrongMint,
    #[msg("La fecha de desbloqueo tiene que estar en el futuro")]
    UnlockInThePast,
    #[msg("La epoca es demasiado corta (minimo 1 h)")]
    EpochTooShort,
    #[msg("La ventana de impugnacion es demasiado corta (minimo 1 h)")]
    ChallengeTooShort,
    #[msg("Los basis points no pueden pasar de 10000")]
    BpsOutOfRange,
    #[msg("Ese premio supera el tope de la epoca")]
    RewardCapExceeded,
    #[msg("Ese barrido supera el tope de la epoca")]
    SweepCapExceeded,
    #[msg("Esa quema supera el tope de la epoca")]
    BurnCapExceeded,
    #[msg("No hay saldo libre suficiente en la tesoreria")]
    InsufficientTreasury,
    #[msg("Esa epoca todavia no ha terminado")]
    EpochNotFinished,
    #[msg("Una ronda necesita al menos un ganador")]
    NoWinners,
    #[msg("La raiz de Merkle no puede estar vacia")]
    EmptyRoot,
    #[msg("La prueba de Merkle no es valida para esa wallet y esa cantidad")]
    InvalidProof,
    #[msg("La prueba de Merkle es demasiado larga")]
    ProofTooLong,
    #[msg("La ronda esta cancelada")]
    RoundCancelled,
    #[msg("La ronda ya caduco")]
    RoundExpired,
    #[msg("La ventana de impugnacion sigue abierta: aun no se puede cobrar")]
    ChallengeWindowOpen,
    #[msg("La ventana de impugnacion ya se cerro: la ronda no se puede cancelar")]
    ChallengeWindowClosed,
    #[msg("Todavia se puede reclamar: la ronda no ha caducado")]
    ClaimWindowOpen,
    #[msg("Se ha reclamado mas de lo que anuncio la ronda")]
    RoundOverclaimed,
    #[msg("El bloqueo solo puede alargarse, nunca acortarse")]
    LockWouldShorten,
    #[msg("Los limites solo pueden endurecerse")]
    WouldLoosen,
    #[msg("La configuracion ya esta finalizada y no se puede tocar")]
    AlreadyFinalized,
    #[msg("La tesoreria sigue bloqueada")]
    StillLocked,
    #[msg("No eres la autoridad pendiente")]
    NotPendingAuthority,
    #[msg("El destino de un retiro de custodia no puede ser la tesoreria")]
    DestinationIsTreasury,
    #[msg("Desbordamiento aritmetico")]
    MathOverflow,
}
