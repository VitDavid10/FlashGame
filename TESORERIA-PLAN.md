# PillWars — Tesorería on-chain con bloqueo de años

Diseño del programa **`pill_treasury`** (Solana / Anchor): una caja fuerte con
timelock de años para la tesorería del proyecto, separada de la custodia del
dinero de los jugadores, con una única salida antes del desbloqueo — premios
reclamables contra una lista pública publicada 48 h antes.

> Documento hermano de [BLOCKCHAIN-PLAN.md](BLOCKCHAIN-PLAN.md), que cubre el
> escrow de partidas. Aquí se trata **dónde vive el dinero**, no cómo se juega.

---

## 0. El problema, dicho sin rodeos

Quiero poder demostrar dos cosas a la vez:

1. **"No puedo tocar la tesorería."** Bloqueo de años, verificable en el explorador.
2. **"La tesorería premia al top 10 diario."** O sea: de la tesorería sale dinero.

Son contradictorias si la salida la firma quien tiene la llave. Un vault del que
la autoridad puede ordenar pagos arbitrarios **no está bloqueado**: bastaría con
declarar que mis propias wallets son el top 10.

El matiz importante: eso no es "tener acceso a los fondos", es **tener acceso al
criterio**. El contrato no puede ver quién jugó bien — solo ve firmas. Así que el
diseño no intenta que el contrato juzgue el gameplay (imposible); intenta que el
**criterio sea público y anterior al pago**, y que el pago **no lo ejecute yo**.

### La solución: nadie cobra por orden mía

```
                    ┌── el servidor NO paga a nadie ──┐
día D    partidas → leaderboard público (hash encadenado, se publica cada día)
día D+1  el servidor publica una RAÍZ DE MERKLE de la lista {wallet, cantidad}
         → los tokens NO se mueven. Empieza una ventana de 48 h.
         → cualquiera descarga la lista, recalcula la raíz y la contrasta
           contra el leaderboard que ya estaba publicado el día D.
día D+3  se abre el claim. Lo ejecuta EL GANADOR (o cualquiera por él).
         El destino sale de la hoja del Merkle, no de quién firma.
```

El programa **no tiene ninguna instrucción** que mueva tokens de la tesorería a
una cuenta elegida en el momento del pago. Antes del desbloqueo la única salida
es `claim`, y su destinatario está fijado en una lista de hace dos días.

Para cobrar de ahí yo tendría que aparecer en esa lista: **lo mismo que todos, y
a la vista de todos.**

---

## 1. Cómo está hoy (y qué falla)

Modelo actual, en `server/solana.js` + `server/warbank.js`:

```
jugador --transfer SPL--> TREASURY (una wallet normal, la keypair de la autoridad)
                              │
                              ├─ el servidor apunta el saldo en warbalances.json
                              ├─ /api/withdraw → la autoridad firma y devuelve PILL
                              └─ skins: se QUEMAN del ATA de la autoridad
```

| Qué | Estado hoy |
|---|---|
| Dónde vive el dinero | **Una sola wallet**, la de la autoridad |
| Depósitos de jugadores vs tesorería | **Indistinguibles**: el mismo saldo |
| Quién puede sacarlo todo | La keypair de la autoridad, ahora mismo, sin límite |
| Bloqueo temporal | **Ninguno** |
| Qué ve un holder en el explorador | Un número. Sin saber cuánto es de los jugadores |

Los tres fallos:

1. **No hay bloqueo.** Nada impide vaciar la wallet en un tx.
2. **No se distingue custodia de tesorería.** Si en la wallet hay 10 M PILL, nadie
   sabe si 9 M son depósitos de jugadores (deuda) o beneficio del proyecto.
3. **Cada skin quemada es dinero que desaparece.** Válido como narrativa
   deflacionaria, pero es dinero que no puede volver a los jugadores como premio.

Un detalle que ya existe y no se contabiliza: el **exit fee de classic**
(`classicExitFeePct`, 10/20/50 % según kills, `server/index.js:651`) se descuenta
del saldo interno y **el PILL se queda físicamente en el treasury**. Es un rake
real que hoy no aparece en ningún sitio. Igual con las partes del bote de arcade
que no se pagan por falta de wallet (`server/room-loop.js:155`).

---

## 2. El diseño: tres cuentas, tres reglas

En vez de una wallet, **dos token accounts propiedad de PDAs** — direcciones
distintas, saldos distintos, visibles por separado en el explorador.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CUSTODY  (PDA "custody")            "dinero que NO es mío"         │
│  ───────────────────────────────────────────────────────────────    │
│  entra:  deposit()        cualquiera, sin permiso                   │
│  sale:   withdraw()       la autoridad, en nombre del jugador       │
│          sweep()          hacia treasury, capado, sin retorno       │
│                                                                     │
│  Este saldo DEBE ser >= la suma de saldos WAR off-chain.            │
│  Eso es la prueba de reservas, y es pública y comprobable.          │
└─────────────────────────────────────────────────────────────────────┘
                                  │ sweep (solo en este sentido)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TREASURY  (PDA "treasury")          "dinero del proyecto, LOCKED"  │
│  ───────────────────────────────────────────────────────────────    │
│  entra:  fund()           cualquiera (aquí van mis compras)         │
│          sweep()          rake de partidas, tienda, conversor       │
│  sale:   claim()          SOLO contra una raíz Merkle publicada     │
│                           48 h antes, y lo ejecuta el ganador       │
│          unlock_withdraw() SOLO a partir de unlock_ts (años)        │
│                                                                     │
│  No hay instrucción "manda X a la wallet Y" antes de unlock_ts.     │
└─────────────────────────────────────────────────────────────────────┘
```

**Ésa es la respuesta a "¿cómo se diferencian los tokens de depósito de los de
tesorería?"** — no es un campo contable ni una promesa: son **dos direcciones
distintas**. Un holder abre Solscan, ve las dos, y sabe al céntimo cuánto dinero
es deuda con los jugadores y cuánto es del proyecto.

Y **"cuánto dinero no custodiado hay"** = el saldo de `CUSTODY`. El servidor
publica en `/api/treasury` la suma de saldos WAR; si `custody >= suma`, las
reservas están completas. Si no, se ve inmediatamente.

---

## 3. El programa

### 3.1 Cuentas

```rust
// PDA ["config"] — parámetros y contadores
pub struct Config {
    pub authority: Pubkey,          // servidor: publica rondas, firma withdraws de custodia
    pub pending_authority: Pubkey,  // traspaso en dos pasos
    pub mint: Pubkey,
    pub unlock_ts: i64,             // fecha de desbloqueo. SOLO PUEDE AUMENTAR
    pub finalized: bool,            // irreversible: congela todos los parámetros
    // grifo de premios
    pub epoch_secs: i64,            // 86_400 (1 día)
    pub reward_cap_per_epoch: u64,  // tope absoluto por época
    pub reward_bps_per_epoch: u16,  // tope relativo al saldo (‱ del treasury)
    pub challenge_secs: i64,        // ventana de impugnación (172_800 = 48 h)
    // grifo de sweep custody -> treasury
    pub sweep_cap_per_epoch: u64,
    pub sweep_epoch: i64,
    pub swept_this_epoch: u64,
    // contadores acumulados: transparencia on-chain, nadie los puede maquillar
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub total_funded: u64,
    pub total_swept: u64,
    pub total_rewarded: u64,
    pub rounds_published: u64,
}

// PDA ["round", epoch] — una ronda de premios diaria
pub struct RewardRound {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub total: u64,          // suma exacta de la lista; se reserva del treasury
    pub claimed: u64,
    pub winners: u16,
    pub published_at: i64,
    pub claimable_at: i64,   // published_at + challenge_secs
    pub cancelled: bool,
}

// PDA ["claim", epoch, wallet] — recibo. Existe = ya cobró.
pub struct ClaimReceipt { pub amount: u64, pub ts: i64 }
```

Los vaults son token accounts en PDAs `["custody"]` y `["treasury"]`, con
`authority = el propio PDA`. **No hay ninguna llave privada que los controle.**

### 3.2 Instrucciones

| Instrucción | Quién firma | Qué hace | Límite |
|---|---|---|---|
| `initialize` | deployer | crea config + los dos vaults | una sola vez |
| `deposit(amount)` | **cualquiera** | jugador → CUSTODY | — |
| `fund(amount)` | **cualquiera** | quien sea → TREASURY | sin retorno |
| `withdraw(amount)` | autoridad | CUSTODY → jugador | nunca toca treasury |
| `sweep(amount)` | autoridad | CUSTODY → TREASURY | cap por época |
| `publish_round(epoch, root, total, winners)` | autoridad | anota la raíz | `total <= cap`; época irrepetible |
| `cancel_round(epoch)` | autoridad | anula una ronda | **solo antes de `claimable_at`** |
| `claim(epoch, amount, proof)` | **cualquiera** | TREASURY → ganador de la hoja | `now >= claimable_at`, una vez por wallet |
| `extend_lock(new_ts)` | autoridad | alarga el bloqueo | **solo si `new_ts > unlock_ts`** |
| `tighten(...)` | autoridad | endurece los caps | **solo a la baja**, y si `!finalized` |
| `finalize()` | autoridad | congela parámetros | irreversible |
| `transfer_authority` / `accept_authority` | autoridad / nueva | rotación en dos pasos | no da acceso a fondos |
| `unlock_withdraw(amount)` | autoridad | TREASURY → donde sea | **solo si `now >= unlock_ts`** |

### 3.3 Las invariantes, que es lo que de verdad importa

Cualquiera puede leer el código del programa y comprobar estas cinco:

1. **`unlock_ts` nunca decrece.** `extend_lock` rechaza cualquier valor menor o
   igual. No hay otra instrucción que lo escriba.
2. **Antes de `unlock_ts`, la única salida del treasury es `claim`**, cuyo
   destinatario está en la hoja del Merkle y cuya cantidad está en la hoja.
   `claim` no lee ninguna cuenta que la autoridad controle en ese momento.
3. **`publish_round` no mueve un solo token.** Solo escribe 32 bytes y arranca el
   reloj de 48 h. Y una ronda publicada no se puede modificar; solo cancelar, y
   solo dentro de la ventana.
4. **El flujo custody → treasury es unidireccional.** No existe
   `treasury → custody`. Nada que caiga en la tesorería vuelve.
5. **`claim` es idempotente por wallet** — el `ClaimReceipt` es un PDA; si ya
   existe, la transacción falla.

### 3.4 El grifo, con números

```
epoch_secs           = 86 400        (1 día)
reward_bps_per_epoch = 5             (0,05 % del treasury por día)
reward_cap_per_epoch = 250 000 PILL  (tope absoluto, el que sea menor)
challenge_secs       = 172 800       (48 h)
unlock_ts            = hoy + 4 años
```

`publish_round` valida `total <= min(saldo·bps/10000, cap)`.

Con 0,05 %/día, **el máximo teórico anual es ~17 %** — y eso suponiendo que
publico rondas al tope todos los días. Aun con un atacante que controlase la
autoridad y falsease todas las listas, drenar la tesorería le llevaría años, a la
vista de todos, con 48 h de aviso en cada tirada.

Ese es el compromiso duro. Todo lo demás es detectabilidad; **esto es un techo.**

---

## 4. Qué garantiza y qué no

Nada de esto sirve si se vende como más de lo que es.

### Garantizado por el contrato (imposible de saltar)

- No puedo sacar del treasury a una wallet que elija en el momento del pago.
- No puedo sacar más del cap por época, pase lo que pase.
- No puedo acortar el bloqueo.
- No puedo pagar sin haber publicado la lista 48 h antes.
- No puedo pagar dos veces al mismo ganador de la misma ronda.
- No puedo sacar de la custodia hacia mí: `withdraw` solo va a la ATA del jugador.

### Garantizado por publicación (detectable al 100 %, no impedido)

- Que los ganadores sean los del leaderboard. La lista completa es pública y su
  hash está on-chain; el leaderboard del día se publica **antes** con hash
  encadenado al del día anterior. Meter una wallet fantasma exige romper una
  cadena de hashes ya publicada, y sigue estando a la vista durante 48 h.

### **NO** garantizado — hay que decirlo

- **Si el programa es upgradeable, todo lo anterior vale cero.** Con la upgrade
  authority puedo desplegar una versión nueva que vacíe los vaults. Esto es lo
  primero que mira cualquiera que audite. **Es obligatorio revocar la upgrade
  authority** (`solana program set-upgrade-authority --final`) o pasarla a un
  multisig con timelock propio. Sin eso, no se anuncia como bloqueado.
- **Sybil.** Puedo crear wallets, depositar dinero real, jugar con ellas y salir
  en el leaderboard legítimamente. Eso es multi-cuenta, no saqueo: me cuesta
  dinero, va capado y es el mismo camino que tiene cualquiera.
  Con una barrera que sale gratis del diseño que ya había: **al leaderboard diario
  solo entra quien jugó en salas de pago** — `payWallet` únicamente existe si se
  cobró entrada (`server/game-host.js:362`). Montar diez cuentas para cobrarse los
  premios cuesta diez entradas al día, y cada pago queda escrito en la cadena.
- **Los saldos WAR son off-chain.** El contrato no sabe cuánto le debo a cada
  jugador; solo que `custody` tiene X. La prueba de reservas es la mitigación.
- **`sweep` puede vaciar la custodia hacia el treasury.** Los jugadores se
  quedarían sin poder retirar — pero yo tampoco recuperaría nada, queda
  bloqueado igual. Es autolesivo, va capado, y la prueba de reservas lo delata al
  instante. Aun así es el vector más feo que queda; el cap debe ser ajustado.

---

## 5. Los flujos, uno a uno

### 5.1 Depósito (cambia poco respecto a hoy)

```
jugador firma  deposit(amount)  → CUSTODY
servidor lee el evento/tx       → acredita saldo WAR (warbank.creditDeposit)
```

Igual que ahora pero el destino es un PDA, no mi wallet. `verifyDeposit()` pasa
de mirar el delta de una wallet a mirar el delta del PDA de custodia.

### 5.2 Retiro (idéntico en UX)

```
jugador firma un mensaje  → servidor valida saldo → withdraw(amount) → ATA del jugador
```

Sale de `CUSTODY`. **El contrato impide que salga del treasury**, así que un bug
del servidor no puede tocar el dinero bloqueado.

### 5.3 Tienda de skins y conversor  →  tesorería en vez de humo

Hoy la tienda quema (`skinshop.js`). Propuesta: **split configurable**.

```
compra de skin: 25 000 PILL del saldo WAR
   ├─ 50 % → BURN     (baja el supply, la narrativa deflacionaria se mantiene)
   └─ 50 % → SWEEP    (custody → treasury: financia los premios diarios)
```

Ambos salen de la misma cola diferida que ya existe (`apuntaQuema`), así que
comprar sigue siendo instantáneo. Se convierte en `apuntaSalida(pill)` con dos
contadores, y el temporizador vacía los dos.

**Y aquí está la clave de tu pregunta sobre las skins nuevas:** el contrato no
sabe qué es una skin. No conoce precios, ni códigos, ni catálogos. Solo ve
`sweep(amount)`. Puedes añadir 300 skins, cambiar precios, inventarte un pase de
temporada o un mercado de reventa — **cero cambios en el contrato**, que puede
estar finalizado y con la upgrade authority revocada. Todo el catálogo vive en
`skinshop.js`, donde ya está.

Misma historia con el rake de partidas: el exit fee de classic y las partes no
reclamadas del bote de arcade dejan de "desaparecer" y pasan a contabilizarse
como ingreso de tesorería, saldado con un `sweep` diario.

### 5.4 Premios del top 10 diario

```
23:59 UTC  el servidor cierra el día:
           - snapshot del leaderboard diario (no el histórico: el del día)
           - lo publica en /api/leaderboard/2026-09-02.json
           - con hash SHA-256 encadenado al del día anterior
             → un log append-only: reescribir el pasado rompe la cadena

+1 día     calcula la lista de premios con los pesos del top 10
           construye el árbol de Merkle
           publish_round(epoch, root, total, winners)
           publica la lista completa en /api/rewards/<epoch>.json

+3 días    se abre el claim. El jugador entra al juego y ve "CLAIM 12 450 $PILL".
           Firma. Los tokens salen del treasury a su ATA.
           (o los reclama cualquiera por él: el destino está en la hoja)
```

Pesos sugeridos, reutilizando la curva que ya usa arcade
(`server/room-loop.js:156`), que está calibrada y la gente ya entiende:

```
#1  35 %   #2  20 %   #3  13 %   #4  9 %   #5  7 %
#6   5 %   #7   4 %   #8   3 %   #9  2.5 %  #10 1.5 %
```

**Antes de reclamar hay que tener wallet.** Un premio sin wallet asignada expira
y vuelve a la tesorería (no se publica en la lista siquiera).

---

## 6. Calibrar antes de bloquear — esto no se puede deshacer

Dijiste lo importante: *"si es un contrato bloqueado, deberemos antes medir bien
cómo funcionan las recompensas"*. Exacto. Un cap mal puesto es irreversible:

- **Cap muy bajo** → los premios son ridículos y la tesorería se hincha sin poder
  usarse durante años. No se puede subir el cap (`tighten` solo baja).
- **Cap muy alto** → si el juego no ingresa lo suficiente, la tesorería se drena
  y los premios se cortan de golpe.

Por eso el bloqueo se monta en dos tiempos:

```
FASE CALIBRACIÓN     unlock_ts = hoy + 30 días,  finalized = false
                     Se puede extender el lock y endurecer caps.
                     Se mide con datos reales: ingresos, claims, sostenibilidad.

FASE BLOQUEO         extend_lock(hoy + 4 años)
                     tighten(caps definitivos)
                     finalize()
                     solana program set-upgrade-authority --final
                     ← a partir de aquí no hay marcha atrás, y ése es el punto
```

La asimetría está puesta a propósito: durante la calibración **solo se puede ir
en la dirección de más restricción**. Nunca se afloja.

Para medirlo hay un simulador: `scripts/treasury-sim.js` (ver §8), que proyecta
la tesorería a N años con los ingresos reales del juego.

---

## 7. Transparencia pública

Endpoint `/api/treasury`, y una página que lo pinte:

```json
{
  "program": "PiLL...",
  "custody":  { "address": "...", "balance": 8420000 },
  "treasury": { "address": "...", "balance": 31500000, "unlockTs": 1883000000 },
  "obligations": 8390000,
  "reservesRatio": 1.0036,
  "caps": { "rewardPerEpoch": 250000, "bps": 5, "challengeHours": 48 },
  "lastRound": { "epoch": 20334, "total": 148200, "claimed": 121000, "winners": 10 },
  "upgradeAuthority": null
}
```

`obligations` es la suma de saldos WAR. `reservesRatio = custody / obligations`;
si baja de 1, se ve al momento. `upgradeAuthority: null` es la prueba de que el
programa es inmutable — el dato que más pesa de todo el JSON.

---

## 8. Plan de implementación

| # | Entregable | Estado |
|---|---|---|
| T1 | `programs/pill-treasury/src/lib.rs` — el programa | ✅ escrito |
| T2 | Tests del Merkle y del cliente contra el `.rs` | ✅ 77 tests |
| T3 | `server/treasury-client.js` — cliente sin dependencia de Anchor | ✅ |
| T4 | `scripts/treasury-sim.js` — simulador de sostenibilidad | ✅ |
| T5 | Leaderboard diario con hash encadenado + `/api/leaderboard` | ✅ |
| T6 | Constructor del Merkle + `publish_round` automático | ✅ `server/rewards.js` |
| T7 | Split quema/tesorería en la tienda y el conversor | ✅ `PILL_TREASURY_PCT` |
| T8 | `/api/treasury` + `scripts/treasury.js` (operación y auditoría) | ✅ |
| T9 | UI de claim en el juego | pendiente |
| T10 | Compilar y desplegar en devnet | pendiente — necesita WSL |
| T11 | Calibración de 30 días con datos reales | pendiente |
| T12 | Bloqueo: extend + tighten + finalize + **revocar upgrade** | pendiente |

Los pasos de despliegue, uno a uno: [DESPLIEGUE-TESORERIA.md](DESPLIEGUE-TESORERIA.md).

---

## 9. Diferencias con el modelo actual, en una tabla

| | Hoy | Con `pill_treasury` |
|---|---|---|
| Dónde vive el dinero | 1 wallet | 2 PDAs sin llave privada |
| Custodia vs tesorería | Indistinguible | Dos direcciones, dos saldos |
| ¿Puedo vaciarlo? | Sí, ahora mismo | No antes de `unlock_ts` |
| Salida de tesorería | Libre | Solo claim contra Merkle de hace 48 h |
| Quién ejecuta el pago | Yo | El ganador |
| Techo de salida | Ninguno | ~0,05 %/día del saldo |
| Prueba de reservas | Imposible | `custody` vs obligaciones publicadas |
| Skins nuevas | — | No tocan el contrato |
| Si me roban la llave | Se lo llevan todo | Custodia en riesgo; tesorería no |
