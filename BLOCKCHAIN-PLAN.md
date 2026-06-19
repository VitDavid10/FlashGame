# PillWars — Plan blockchain ($PILL)

Plan para integrar el token **$PILL** (Solana, creado con pump.fun) como moneda de
acceso a las salas de pago, con un escrow on-chain y reparto de premios. Todo se
desarrolla y prueba primero en **devnet/testnet**; mainnet solo tras hardening + decisión legal.

> Principio rector: **contrato tonto, servidor listo.** Toda la lógica del juego
> (kills, dinero retenido, bote, ponderaciones) vive OFF-CHAIN en el servidor, que
> ya es autoritativo. El contrato solo hace de caja fuerte: acepta depósitos y paga
> según una instrucción de reparto firmada por la autoridad. Así el contrato es
> simple, auditable y barato.

---

## Arquitectura

```
JOIN  → el jugador firma un depósito de la entrada (PILL) a un vault (PDA por partida)
JUEGO → 100% off-chain en el servidor (40 Hz). NADA on-chain durante la partida.
        - Classic: al matar, el dinero del muerto queda "retenido" en tu cuenta de
          la partida; solo se consolida al salir vivo (cashout) o al ganar (5 kills).
        - Arcade: cada muerte llena el bote; al final, top 10 reparte, con más peso
          en top 3 y luego top 5.
FIN   → el servidor calcula los pagos finales y envía UNA instrucción de reparto
        firmada; el contrato paga del vault a cada wallet ganadora.
```

El contrato (programa Anchor en Rust) solo valida:
1. **Autoridad**: solo el servidor (keypair autoridad) puede ordenar el reparto.
2. **Conservación**: la suma repartida ≤ saldo del vault (no se puede crear dinero).
3. **Una vez**: cada partida se liquida una sola vez (anti doble-pago).

### Por qué off-chain durante la partida
Solana confirma en ~400 ms; el juego va a 40 Hz. Es imposible (y carísimo) llevar
cada kill on-chain. Por eso el dinero "retenido" de classic y el bote de arcade son
contadores en el servidor; la cadena solo entra al **entrar** (depósito) y al
**terminar** (reparto). Esto encaja con tu diseño: no cobras hasta salir/ganar.

---

## Las tres mecánicas (cómo se mapean)

### Classic — "te llevas su dinero al matar, cobras al salir/ganar"
- Off-chain: cada jugador tiene `pendiente` = su entrada + lo robado a quien mató.
- Si mueres → tu `pendiente` pasa al que te mató (y tu entrada se pierde para ti).
- Si haces cashout vivo o ganas (5 kills) → tu `pendiente` entra en la lista de pagos.
- Al final, el servidor manda `[{wallet, cantidad}]` y el contrato paga del vault.

### Arcade — "bote para el top 10, peso en top 3 / top 5"
- Off-chain: el bote = suma de entradas + lo que aporta cada muerte.
- Al acabar la partida, el servidor ordena por ranking y reparte el bote con una
  curva ponderada (ej.: top1 > top2 > top3 >> top4-5 > top6-10). Pesos configurables.
- Envía la lista de pagos; el contrato paga.

> Las curvas/pesos exactos son parámetros del servidor → fáciles de ajustar sin tocar el contrato.

---

## Oráculo de precio (entrada en $ → PILL, cada 5 min)
- Objetivo: la entrada cuesta un valor fijo en **$** (ej. 5 $), y se cobra el
  equivalente en PILL según el precio → a veces 50k PILL, a veces 100k.
- **Problema**: un token nuevo de pump.fun tiene poca liquidez → su precio es
  manipulable. Cobrar con un precio manipulable es un riesgo.
- **Plan**:
  - Fase inicial: precio **firmado por el servidor** (lee el pool cada 5 min, lo
    cachea y lo sirve). Simple, pero centralizado.
  - Más adelante (con liquidez): TWAP on-chain del pool de Raydium o un feed de
    Pyth/Switchboard si llega a existir para PILL. SOL/USD ya está en Pyth.

---

## Fases (todo en devnet primero)

- **B1 — Token + wallet + lectura.** Token SPL de prueba en devnet; pulir
  `@solana/wallet-adapter` (ya hay Phantom); leer balance de PILL; mostrar precio.
  Sin dinero en juego. *(Valida: conectar wallet y ver saldo.)*
- **B2 — Escrow de entrada.** Programa Anchor con vault (PDA) por partida. Al entrar
  a sala de pago: depósito on-chain; el servidor verifica el tx antes de dejar jugar.
  Reembolso si la sala no arranca. *(Valida: pagar entrada de verdad en devnet.)*
- **B3 — Settlement.** El servidor calcula y envía el reparto al final: cashout de
  classic + split ponderado de arcade. El contrato paga. *(Valida: cobrar premios.)*
- **B4 — Oráculo.** Entrada en $ → PILL refrescado cada 5 min (precio firmado por
  servidor al principio).
- **B5 — Hardening + mainnet.** Reembolsos y casos borde (desconexión, sala muerta),
  disputas, gestión de claves (de autoridad única a multisig), auditoría, y
  **decisión legal** antes de mainnet.

---

## Decisiones tomadas (recomendaciones por defecto; ajustables)
- **Vault por partida** (no bote global): fondos acotados, menos superficie de riesgo.
- **Custodia**: autoridad única (servidor) en devnet → **multisig** para mainnet.
- **Reembolsos**: SÍ. Si la sala no llega al mínimo y no arranca, se devuelve la entrada.

---

## Riesgos a vigilar
- ⚠️ **Clave de la autoridad = control de fondos.** Si se filtra, drenan vaults.
  Mitigar: vault por partida (poco dinero por vault), hot wallet acotada, multisig en mainnet.
- ⚠️ **Gambling / legal.** PvP con dinero real = apuestas. Devnet ok; mainnet tiene
  exposición legal según jurisdicción. Decidir ANTES de mainnet.
- ⚠️ **Oráculo manipulable** con poca liquidez (ver arriba).
- ⚠️ **Desconexiones / disputas**: definir qué pasa con el `pendiente` si te cae la
  conexión en classic (¿gracia de reconexión = sigue tuyo? ¿lo pierdes?).
- ⚠️ **Doble-liquidación**: el contrato debe marcar cada partida como pagada una sola vez.

---

## Stack
- **Cadena**: Solana (devnet → mainnet). Token SPL (pump.fun).
- **Programa**: Anchor (Rust).
- **Frontend**: `@solana/wallet-adapter` (Phantom ya integrado), `@solana/web3.js`, `@solana/spl-token`.
- **Servidor**: Node (ya existente) firma settlements y verifica depósitos con `@solana/web3.js`.
- **Oráculo**: precio firmado por servidor → Pyth/Switchboard/TWAP de Raydium más adelante.

## Próximos pasos concretos (Fase B1)
1. Crear token SPL en **devnet** (mint de prueba) y airdrop a un par de wallets.
2. Pulir el wallet-adapter en la web: estado conectado, balance de PILL, desconectar.
3. Mostrar el balance real y bloquear "salas de pago" si no hay saldo (aún sin cobrar).
