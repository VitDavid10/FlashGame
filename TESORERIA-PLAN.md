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

## 2 bis. Staking: dos grifos con fuentes distintas

Hay dos tipos de dinero entrando y no tiene sentido mezclarlos:

```
ingresos corrientes del juego     →  STAKING      quien inmoviliza $PILL
(todo lo que recauda la casa)

principal de la compra inicial    →  TESORERÍA    premios del top 10 diario
(fund, bloqueado años)
```

**Todo lo que entra en el pozo del staking**, sin excepciones — son los cinco
únicos sitios del código que llaman a `rake.alStaking()`:

| Concepto | Cuánto | Dónde se genera |
|---|---|---|
| Exit fee de classic al acabar el tiempo de sala | 50 % sin kills / 20 % con una / 10 % con dos o más; 0 % si ganas la sala | `room-loop.js` |
| Exit fee de classic al salirse en plena partida | igual | `index.js` (`onPlayerLeave`) |
| Comisión del bote de arcade | `ARCADE_RAKE_PCT`, 5 % por defecto, tope duro 50 % | `room-loop.js` |
| Partes del bote de arcade que nadie reclama | lo que quede del top 10 sin wallet detrás | `room-loop.js` |
| Entrada del que se desconecta y no vuelve a tiempo | lo que llevara encima | `index.js` (`graceExpired`) |
| Tienda de skins y conversor de SP | 100 % (`SKINSHOP_TREASURY_PCT`) | `skinshop.js` |

**No se quema nada.** Lo que antes se destruía en la tienda ahora va a este mismo
pozo: destruir tokens no le devuelve dinero a nadie, y este sí.

**En la tesorería solo entra `fund()`** — los tokens de la compra inicial. Ni un
PILL de los jugadores acaba ahí. Es lo que hace que el bloqueo de años no sea un
problema: la tesorería no necesita liquidez porque no debe nada a nadie.

Si se mezclaran pasaría una de dos cosas malas: o el rendimiento del staking se come
el principal bloqueado, o los premios del leaderboard dependen de que el juego
facture ese mes. Separados, cada grifo tiene su fuente y su ritmo.

Y hay una diferencia que importa más de lo que parece:

| | Premios del top 10 | Staking |
|---|---|---|
| Quién decide quién cobra | El servidor (yo) | **El contrato, solo** |
| ¿Hay que confiar en el operador? | Sí — capado, publicado y auditable | **No** |
| Qué hay que hacer para cobrar | Jugar bien | Inmovilizar $PILL |

El reparto del staking es el único que el programa calcula por su cuenta: sabe cuánto
tiene stakeado cada wallet y desde cuándo, y no necesita que nadie se lo cuente.

### Dos bolsas separadas

`stake_vault` guarda el **principal de los usuarios** —dinero suyo, que sale cuando
quieran, sin permisos ni esperas ni tope— y `reward_vault` las recompensas por
repartir. Juntas, un error de cálculo pagaría recompensas con el principal de otro y
no se notaría hasta que alguien no pudiera sacar lo suyo.

### Por qué el reparto va por segundo

Si el rake se soltara de golpe cada vez que se barre, el juego sería obvio: stakeas un
segundo antes, cobras tu parte del día entero, sales. `fund_stake_rewards` reparte a lo
largo de un periodo (24 h por defecto), así que **lo que cobras es proporcional al
tiempo que estuviste dentro**.

Por dentro es el patrón del índice acumulado: un solo número global dice cuánta
recompensa lleva acumulada cada unidad stakeada desde el principio, y lo tuyo es la
diferencia con el índice que había la última vez que tocaste tu posición. Entrar,
salir y cobrar son O(1) y no dependen de cuánta gente haya.

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
    pub reward_bps_per_epoch: u16,  // curva de emision (‱ del saldo por epoca)
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
| `burn(amount)` | autoridad | CUSTODY → destruido | cap por época |
| `init_staking()` | autoridad | crea las dos bolsas del pool | una sola vez |
| `stake(amount)` | **el usuario** | su wallet → STAKE | — |
| `unstake(amount)` | **el usuario** | STAKE → su wallet | sin esperas ni tope |
| `claim_stake_rewards()` | **el usuario** | REWARDS → su wallet | lo devengado |
| `fund_stake_rewards(amount, dur)` | autoridad | CUSTODY → REWARDS, por goteo | — |
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
reward_bps_per_epoch = 225           (2,25 % del saldo por día)
reward_cap_per_epoch = 200 000 PILL  (tope absoluto)
challenge_secs       = 172 800       (48 h)
unlock_ts            = hoy + 4 años
```

`publish_round` valida `total <= min(saldo·bps/10000, cap)`. Son dos frenos con
formas distintas, y conviene entender por qué hay dos.

#### Los bps NO son un tope: son el calendario de emisión

Es lo que menos se ve del diseño. El tope no es una cantidad fija, es **un
porcentaje del saldo que queda** — y un porcentaje constante de algo que baja es
exactamente un halving, solo que continuo en vez de escalonado. Elegir los bps es
elegir la vida media de la tesorería:

| halving cada | bps | día 1 (sobre 30 M) | repartido al año |
|---|---|---|---|
| mes | 225 | 675 000 | 100 % |
| trimestre | 76 | 228 000 | 97 % |
| semestre | 38 | 114 000 | 75 % |
| año | 19 | 57 000 | 50 % |

Tres propiedades que salen gratis de que sea relativo y no absoluto:

- **Se autorregula con la actividad.** Lo que no se reparte un día flojo se queda
  dentro, y el grifo del día siguiente es un porcentaje de un saldo mayor. Si el
  juego arranca lento, la emisión dura más sola. Si arranca fuerte, se agota antes.
- **Nunca llega a cero.** Un calendario por fechas se vacía y convierte el candado
  en decoración; un porcentaje siempre deja algo dentro.
- **Nadie tiene que ejecutar nada.** Ningún halving que disparar cada X meses, y
  ninguna oportunidad de olvidarlo o hacerlo mal. Y como `tighten` solo baja los
  bps, la curva es un techo garantizado: se puede hacer más lenta, nunca más rápida.

#### El cap absoluto es lo que afeita el pico

Una exponencial pura reparte su máximo el día 1, que es justo cuando menos
jugadores hay — el peor momento posible. Con 225 bps y sin cap, el primero de la
tabla se llevaría 236 000 PILL diarios en un día de cinco jugadores, y con
`LB_MIN_OPPONENTS=5` bastan seis wallets para cobrarlo.

El cap corta esa cabeza y convierte la curva en **meseta y caída**:

| | día 1 | día 90 | supply nuevo el 1.er mes | repartido a 3 meses |
|---|---|---|---|---|
| 225 bps sin cap | 675 000 | 89 000 | 1,49 % | 87 % |
| 225 bps + cap 200 k | 200 000 | 200 000 | 0,60 % | 60 % |
| 225 bps + cap 120 k | 120 000 | 120 000 | 0,36 % | 36 % |

Con cap 200 k son ~100 días de premio alto y **constante**, que retiene mejor que
un pico que se desinfla en tres semanas, y el mercado absorbe 0,6 % de supply nuevo
al mes en vez de 1,5 %.

#### Si te quedas corto: `fund` no caduca

La objeción obvia a una curva agresiva es qué pasa si el juego arranca lento y coge
tracción al mes 6, con la tesorería ya casi vacía. La respuesta está en `fund`:

> *Aportación directa a la TESORERÍA. **Cualquiera puede llamarla.***
> — `lib.rs:202`

Sin autoridad, sin límite y sin caducidad. `finalized` solo bloquea `tighten`, así
que se puede aportar también después del cerrojo, para siempre.

Y como el grifo es un porcentaje del saldo, **meter tokens sube la emisión diaria
sola**. Los bps no se pueden subir; el saldo del que se calculan, sí. Para sostener
`E` PILL por época hace falta un saldo de `E × 10000 / bps` — con 225 bps y 800 000
al día, unos 35,6 M en tesorería.

Eso sí: lo que entra queda sujeto al timelock igual que lo demás. Es dinero que se
regala a la comunidad, no un préstamo que se recupere.

#### La proporción entre los dos frenos es lo que decide la forma

No sirve elegir los bps y el cap por separado: lo que manda es cuál de los dos
muerde primero, y eso depende de **cuánto haya en la tesorería**. El mismo cap de
200 000 sobre 30 M deja ~100 días de meseta, y sobre 150 M deja **702** — dos años
planos en los que el halving no llega a notarse nunca.

Regla: **el cap ronda un cuarto de lo que daría la curva el día 1**
(`saldo × bps / 10000 / 4`). Con eso el pico queda afeitado y la curva sigue
mordiendo a los pocos meses.

| tesorería | bps | cap | meseta | repartido 3 m / 6 m / 12 m | supply nuevo al mes |
|---|---|---|---|---|---|
| 30 M | 225 | 200 k | ~100 d | 60 % / 95 % / 100 % | 0,60 % |
| 150 M | 225 | 200 k | **702 d** | 12 % / 24 % / 49 % | 0,60 % |
| 150 M | 225 | 800 k | ~143 d | 48 % / 90 % / 100 % | 2,41 % |
| 150 M | 38 | 400 k | ~110 d | 24 % / 46 % / 73 % | 1,21 % |

`npm run treasury -- init` imprime esta simulación antes de firmar y avisa si el cap
deja la curva sin efecto durante el primer año. Usa `--simular-con <PILL>` para que
la calcule sobre lo que vas a meter de verdad, no sobre el ejemplo.

#### El tercer freno: el bote no puede pasar del RAKE del día

Los dos frenos anteriores son un techo, y un techo no sabe cuánta gente hay jugando:
en una sala vacía deja salir lo mismo que en una llena. Eso abre un ataque que
ningún filtro cierra del todo, porque **crear wallets es gratis**.

La primera versión de esto ataba el bote a lo cobrado en **entradas**. No sirve, y
la razón está en dos líneas del juego:

- `game-host.js:384` — `carry: fee || 0`: **la entrada se convierte en tu carry**.
- `room-loop.js:332` — a las 5 kills, cashout automático **sin fee**.

| | |
|---|---|
| 20 wallets propias entran | 20 × 1.160 = 23.200 PILL en carrys |
| Una mata a las otras 19 | acumula los 23.200 |
| Llega a 5 kills, gana la sala | cobra **sin fee**: recupera los 23.200 |
| Las 19 muertas | salen con carry 0, no pagan fee porque no llevan nada |
| **Coste del ataque** | **0 PILL** |

Recupera las entradas enteras. Medir el premio por lo que entró no defiende de nada.

Lo que **sí** es infalsificable es el **rake**: lo que la casa se queda de verdad
—exit fees, comisión de arcade, entradas de los que no vuelven, botes sin reclamar,
tienda. Jugando contra ti mismo eso da **cero**, porque el que gana no paga fee y los
muertos no llevaban nada.

```
bote del día = min( grifo del contrato , rake del día × REWARD_FACTOR )
```

##### Por qué el factor NO está acotado a 1

Porque el rake de classic es pequeño: solo lo paga quien sobrevive al timer sin
ganar la sala.

| jugadores | partidas/día | rake/día | con factor 1 |
|---|---|---|---|
| 100 | 400 | 81.200 PILL | 8,12 $ |
| 300 | 1.200 | 243.600 PILL | 24,36 $ |
| 500 | 2.500 | 507.500 PILL | 50,75 $ |

Ni con 500 jugadores llega a los 170 $ del grifo. Con factor 1 el leaderboard se
estrangula justo cuando el juego funciona, así que el factor es **el multiplicador
que se calibra con datos**, no una constante de seguridad.

Por defecto **12**, elegido para que la curva sea lineal el mayor tramo posible: con
20 el bote toca el techo del grifo a los 140 jugadores y a partir de ahí que crezca
la comunidad ya no paga más.

| jugadores | 50 | 100 | 150 | 200 | 233+ |
|---|---|---|---|---|---|
| factor 20 | 61 $ | 122 $ | **170 $** | 170 $ | 170 $ |
| **factor 12** | 37 $ | 73 $ | 110 $ | 146 $ | **170 $** |

Lo que no cambia por mucho que suba: **cero por cualquier factor sigue siendo cero.**
El factor decide cuánto se paga por actividad real, no si el ataque funciona.

La parte honesta: con factor 20, quien sacrifique 100 PILL en fees puede cobrar
2.000. No es imposible — es caro, lento y visible, y con el filtro de abajo encima,
además exige cincuenta wallets que se crucen con gente de verdad.

#### El quinto freno: el cluster cerrado

`oponentes >= 5` a secas no defiende de nada: veinte wallets propias jugando entre
ellas ven diecinueve oponentes distintos cada una y pasan sobradas.

Lo que las separa es que **un cluster tiene techo y un jugador no**. Con veinte
wallets jamás conocerás a más de diecinueve personas, juegues cuatro partidas o
cuatro mil. Un jugador de verdad se cruza con gente nueva cada vez que entra. Así
que la pregunta del filtro es **«¿a qué parte de la gente que jugó hoy has
conocido?»**:

| sobre 500 jugadores activos | conocidos | % |
|---|---|---|
| Atacante con 20 wallets | 19 (fijo) | **4 %** |
| Atacante con 50 wallets | 49 (fijo) | **10 %** |
| Jugador real, 2 partidas | ~65 | 13 % |
| Jugador real, 4 partidas | ~130 | 25 % |
| Jugador real, 20 partidas | ~380 | 76 % |

Se mide contra la **población** y no contra las partidas jugadas. Dividir por
partidas parecía razonable y estaba mal: baja cuanto más juegas, así que castigaba
al jugador activo y dejaba pasar al atacante que juega poco. Contra la población
pasa lo correcto: **jugar más solo puede subir tu porcentaje**, y el atacante se
queda clavado en su techo.

Para subirlo no hay atajo: más wallets, y cada una cuesta entradas y horas.

**El límite, dicho claro:** si en el juego hay treinta personas y el atacante
controla veinte, ha conocido al 66 % de la comunidad — igual que cualquiera. Con
poca población esto no distingue y no hay filtro que lo arregle. Por eso la defensa
principal es económica y esto es una capa encima, no al revés.

`LB_MIN_KNOWN_PCT` es **0,10** por defecto, conservador a propósito: entre «atacante
con 50 wallets» (9,8 %) y «jugador que echa dos partidas» (13 %) hay poco margen, y
ante la duda es mejor dejar pasar a un atacante que echar a un jugador de verdad.

#### Y todo esto es comprobable desde fuera

El JSON público de cada ronda lleva `elegibles`, `potCompletoCon`, `topeRaw`,
`trasActividadRaw` y `factor`, así que la cuenta se rehace freno a freno desde el
leaderboard publicado — que ya va encadenado por hash. "Ese día se repartió menos"
es comprobable, no algo que haya que creerse.

##### La ventana es el día que se premia, no las últimas 24 h

Los frenos que dependen del día viven en `prepararRonda`, no en `presupuestoRaw`,
y no es un detalle de organización: el tope del contrato es el mismo para todos los
días pendientes, pero **lo que se jugó no**. Con una ventana móvil de 24 horas, un
día flojo premiado con retraso —el servidor estuvo caído, o el ciclo corre a media
tarde— cobraría según la actividad de hoy. Y el ciclo prepara hasta siete días de
una tirada, así que los siete cobrarían lo mismo.

##### Calibrar en 48 h, no en 30 días

Con la curva de emisión actual el primer mes se reparte un tercio de la tesorería:
esperar treinta días para ajustar el factor significa habérselo gastado ya.

`REWARD_DRY_RUN=1` resuelve eso. El ciclo prepara las rondas de verdad, aplica los
cinco frenos y escribe los JSON públicos, pero **no publica nada en la cadena**. En
48 horas hay datos reales — cuánto rake se generó, cuántos elegibles hubo, qué bote
habría salido, quién habría cobrado — sin haber movido un solo token. Cuando los
números convenzan, se quita la variable.

El corte está dentro de `publicarRonda`, no en el ciclo, para que **todo** lo que
llame a publicar lo respete, incluido el botón del panel de admin.

> `REWARD_FACTOR=0` significa lo que parece: no se pagan premios.

#### El cuarto freno: el bote sale proporcional a cuánta gente jugó

Con los tres límites anteriores, **doce jugadores echando tres partidas ya sueltan
el bote entero**: hacen falta 34 entradas de 5 $ para llegar al tope de 170 $, y eso
lo alcanza casi cualquier día. Diez de esos doce cobran, o sea que estar en el top
10 sale gratis y el premio no vale lo que cuesta ganarlo.

```
bote = bote × min( 1 , elegibles del día / LB_FULL_POT_AT )     (50 por defecto)
```

| jugadores en la lista | sale del bote | bote | #1 |
|---|---|---|---|
| 5 | 10 % × 84 %* | 14 $ | 5,00 $ |
| 12 | 24 % | 41 $ | 14,28 $ |
| 25 | 50 % | 85 $ | 29,75 $ |
| 50 o más | 100 % | 170 $ | 59,50 $ |

<sub>* con cinco en la lista solo salen cinco pesos (35+20+13+9+7), los dos recortes se multiplican</sub>

**Cuenta a los elegibles, no a los que cobran.** La lista del día llega hasta
`PUBLICADOS = 100`; los premios siguen siendo del top 10. Del 11 al 50 no reciben
nada — lo único que hacen es que el bote sea el completo, lo que convierte *traer
gente* en un interés de los que ya están.

Y no reabre el sybil: el bote sigue acotado por el rake, y esto solo puede
**bajarlo**. Los cinco límites se aplican en cadena y gana siempre el más pequeño.

El JSON público de cada ronda lleva `elegibles`, `potCompletoCon`, `topeRaw` y
`trasActividadRaw`, así que la cuenta se rehace paso a paso desde el leaderboard
publicado — que ya va encadenado por hash. "Ese día se repartió menos" es
comprobable, no algo que haya que creerse.

##### La ventana es el día que se premia, no las últimas 24 h

Los frenos que dependen del día viven en `prepararRonda`, no en `presupuestoRaw`,
y no es un detalle de organización: el tope del contrato es el mismo para todos los
días pendientes, pero **lo que se jugó no**. Con una ventana móvil de 24 horas, un
día flojo premiado con retraso —el servidor estuvo caído, o el ciclo corre a media
tarde— cobraría según la actividad de hoy. Y el ciclo prepara hasta siete días de
una tirada, así que los siete cobrarían lo mismo.

#### Los premios en dólares, que es lo que mira el jugador

Todo lo anterior está en PILL, y el jugador no piensa en PILL: piensa en si vale la
pena jugar. Con **150 M en tesorería y un marketcap de 100 000 $** sobre 1 B de
supply (1 PILL = 0,0001 $), la tesorería entera vale **15 000 $**. Eso es todo lo
que hay que repartir, y ningún parámetro lo cambia.

Lo único que se decide es en cuánto tiempo:

| cap PILL/día | bote | meseta | #1 | #5 | #10 |
|---|---|---|---|---|---|
| 800 000 | 80 $ | 144 d | 28 $ | 5,60 $ | 1,20 $ |
| 1 200 000 | 120 $ | 81 d | 42 $ | 8,40 $ | 1,80 $ |
| **1 700 000** | **170 $** | **44 d** | **59 $** | **11,90 $** | **2,55 $** |
| 2 500 000 | 250 $ | 16 d | 88 $ | 17,50 $ | 3,75 $ |

**Estrechar el top no es la palanca.** Repartiendo lo mismo entre menos gente, el
primero pasa de 58 $ a 86 $ (top 3) — un 50 % más — y cinco personas se quedan sin
nada. La velocidad mueve doce veces más: de 14 $/día a 175 $/día. Si el premio
sabe a poco, el cap es lo que hay que tocar, no el número de ganadores.

##### Y el premio sigue al precio sin tocar nada

El cap está en PILL, así que su valor en dólares sube con el token; y la entrada
está en dólares, así que cuando el token sube se recaudan menos PILL y el límite por
actividad se vuelve el que manda. Los dos frenos se turnan solos:

| marketcap | recaudado/día* | manda | bote |
|---|---|---|---|
| 100 000 $ | 20 000 000 PILL | el cap | 170 $ |
| 1 000 000 $ | 2 000 000 PILL | el cap | 1 700 $ |
| 5 000 000 $ | 400 000 PILL | la actividad | 2 000 $ |
| 20 000 000 $ | 100 000 PILL | la actividad | 2 000 $ |

<sub>* 100 jugadores, 4 partidas/día, entrada de 5 $</sub>

A precio bajo reparte los tokens que hay; a precio alto **no puede repartir más de
lo que el juego factura**, valga lo que valga el token. Nadie tiene que ajustar nada
en ninguno de los dos extremos.

##### El premio no caduca, y se puede cobrar directo al stake

`expire_round` existe porque un ganador que pierde su wallet dejaría su parte
reservada para siempre y la tesorería se estrangularía sola. Pero **expirar solo
suelta la reserva; no cierra el cobro**: quien aparezca dos años después con su
prueba cobra igual, mientras quede saldo. Y la reserva de una ronda ya expirada no
se vuelve a restar — hacerlo dejaría `reserved` por debajo de lo real y
`publish_round` empezaría a aceptar rondas sin respaldo.

Además de `claim`, hay `claim_to_stake`: el mismo premio, mismo árbol, misma prueba,
pero los tokens van de TREASURY a la bóveda del staking y se suman a la posición del
ganador. Para el jugador es **una transacción en vez de dos**, y se ahorra la renta
de la ATA si aún no la tiene.

Las dos puertas comparten el **mismo recibo** (`["claim", epoch, winner]`), así que
cobrar por una cierra la otra. Y construyen la **misma hoja**: si se separasen,
harían falta dos árboles y el cerrojo del recibo no bastaría. Hay un test que lo fija
leyendo el `.rs`.

La diferencia: en `claim` el ganador **no** firma — el destino sale de la hoja, no
hay nada que desviar, y puede reclamar un tercero. En `claim_to_stake` **sí** firma,
porque se le está abriendo su posición de staking y eso solo lo puede pedir él.

##### El gas del claim

La `ClaimReceipt` cuesta 0,00213 SOL de renta (~0,43 $) que queda inmovilizada para
siempre: el recibo **no se puede cerrar** a propósito, porque cerrarlo permitiría
cobrar dos veces. Con un bote de 170 $/día eso es el 17 % del premio del #10.

El contrato no exige que el ganador firme su propio `claim` — un tercero puede
ejecutarlo, y el destino sale de la hoja del árbol, no de quién firma. Así que el
servidor puede cobrar por los ganadores y comerse el gas (~4,30 $/día con diez
ganadores) sin poder desviar un solo token. Es la diferencia entre "has ganado
2,55 $, haz una transacción de 0,43 $" y que los tokens aparezcan solos.

#### Y sigue siendo un techo

Aunque un atacante controlase la autoridad y falsease todas las listas, no puede
sacar más de lo que deja el menor de los dos frenos, con 48 h de aviso en cada
tirada y a la vista de todos. Todo lo demás del diseño es detectabilidad;
**esto es lo único que es imposibilidad.**

> **El número de `init` es el techo de todo lo que puedas elegir después.**
> `tighten` solo aprieta: de 225 bps se puede bajar a 38, de 38 no se sube a 225.
> En caso de duda, arrancar alto y bajar con datos.

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

**Y por eso el contrato necesita su propia `burn`.** Al mover la custodia a un PDA,
la autoridad deja de ser dueña de esos tokens y ya no puede quemarlos desde su ATA
como hacía antes. Sin una instrucción de quema, ese PILL —que el jugador *ya gastó*,
así que su saldo interno bajó— se quedaría en custodia respaldando saldos que ya no
existen, y la ratio de reservas iría inflándose hacia arriba sin significar nada.
`burn` va capada por época como `sweep`, y ahí el cap importa todavía más: lo
quemado no se recupera ni siquiera bloqueado.

**Y aquí está la clave de tu pregunta sobre las skins nuevas:** el contrato no
sabe qué es una skin. No conoce precios, ni códigos, ni catálogos. Solo ve
`sweep(amount)`. Puedes añadir 300 skins, cambiar precios, inventarte un pase de
temporada o un mercado de reventa — **cero cambios en el contrato**, que puede
estar finalizado y con la upgrade authority revocada. Todo el catálogo vive en
`skinshop.js`, donde ya está.

Misma historia con el rake de partidas: el exit fee de classic, la comisión del
bote de arcade, las partes no reclamadas de ese bote y la entrada del que se
desconecta y no vuelve dejan de "desaparecer" y pasan a contabilizarse. Todo eso
va al **pozo del staking** (`fund_stake_rewards`), no a la tesorería — ver §5.5.

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

## 6 bis. Los dos agujeros que quedaban, y qué se hizo con ellos

Todo lo de arriba impide **reescribir** el pasado. Ninguna de esas piezas impide
**escribir una mentira la primera vez**, y hay dos sitios donde eso importa.

### «Puedo anotar hoy que mi wallet hizo 500 kills»

Cierto. El servidor decide las kills, y hashearlas no las hace verdad. Lo que sí se
puede hacer es **anclar cuándo se dijo cada cosa**, y eso mata el ataque práctico.

Al acabar cada partida se guarda un **recibo** y cada minuto se ancla en Solana el
hash de un lote de recibos, encadenados entre sí (`server/matches.js`):

- **El pasado no se puede inventar.** Las partidas de ayer tienen transacciones de
  ayer. Fabricar un top 10 deja de ser un bucle sobre un JSON y pasa a exigir
  semanas de transacciones a horas creíbles.
- **Una partida anclada no se puede cambiar.** Cambiar una kill cambia el hash del
  recibo, el del lote y el de todos los lotes siguientes.
- **No se puede meter a un jugador que no jugó.** El recibo guarda la firma con la
  que cada uno pidió entrar a la sala (`authorizeEntry`, `server/index.js:966`), y
  esa la hizo su wallet.

Lo que ninguna firma impide es montar diez wallets propias y hacerlas jugar entre
ellas. Contra eso va la **diversidad de oponentes**: un jugador real se cruza con
decenas de personas sin proponérselo; un cluster cerrado, no. Por debajo de
`LB_MIN_OPPONENTS` una wallet no entra en el leaderboard **por muchas kills que
acumule**. Probado: tres wallets con 300 kills cada una y 2 oponentes distintos
quedaron fuera, mientras entraban jugadores con 39 kills y 13 oponentes.

Es mejor filtro que exigir una fianza porque **no cuesta dinero al jugador
legítimo**: filtra por comportamiento, no por capital.

### «Puedo darme saldo editando un fichero»

También cierto, y era el más grave. `warbalances.json` es texto plano.

Con el contrato eso ya hundía el ratio de reservas, pero **las obligaciones las
sumaba el propio servidor**: bastaba con reportar menos pasivo para que el ratio
volviera a dar 1. Un ratio que calcula el sospechoso no prueba nada.

`server/reserves.js` publica cada hora la **lista completa de saldos**, con su raíz
de Merkle anclada en la cadena y encadenada con el snapshot anterior:

| Ataque | Qué lo destapa |
|---|---|
| Me doy saldo | El pasivo publicado sube y deja de cuadrar con la custodia |
| Lo escondo bajando el saldo de otro | Tengo que quitárselo a **alguien concreto**, que lo ve en `/api/reserves/proof` |
| Reescribo un snapshot viejo | Se rompe la cadena, y la raíz vieja ya está en un memo de Solana |

La lista entera y no solo la raíz: con solo la raíz cada uno comprueba su fila, pero
nadie puede ver que no **falten** filas.

### Lo que sigue sin cerrarse

Que el servidor escribe las kills. El juego va a 40 Hz off-chain y nadie puede
re-verificar una partida desde fuera. Los recibos prueban que una partida existió a
una hora y quién firmó para entrar; **no prueban el marcador**. Lo único que cierra
eso es un **multisig donde uno de los firmantes no sea el operador**.

---

## 6 ter. El auditor, y por qué cada comprobación tapa el agujero de la anterior

`scripts/audit-treasury.js` está escrito para que **lo copie y lo ejecute cualquiera**:
no importa nada del repo, no necesita `npm install` y solo habla con las URLs públicas
y con un RPC de Solana. Un auditor que usara el código del auditado comprobaría que el
servidor está de acuerdo consigo mismo, que no demuestra nada.

```bash
node audit-treasury.js https://pillwars.fun
```

Probado contra un servidor trucado a propósito, subiendo el nivel del ataque:

| Ataque | Qué hace el atacante | Qué lo detecta |
|---|---|---|
| 1 | Cambia la wallet de un ganador en la lista de premios | La **raíz de Merkle** ya no sale de la lista |
| 2 | …y regenera el árbol para que cuadre | El **cruce con el leaderboard**: ese puesto lo ganó otro |
| 3 | …y reescribe el leaderboard de ese día | La **cadena de hashes**: el hash del día deja de salir |
| 4 | …y rehace la cadena de hashes entera | La **raíz on-chain**, publicada días antes e inmutable |

Cada capa sola es esquivable. Las cuatro juntas obligan a reescribir algo que ya está
en Solana, y eso no se puede. Por eso la comprobación contra la cadena no sobra aunque
parezca que repite: es la única que el servidor no puede tocar.

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
  "caps": { "rewardPerEpoch": 200000, "bps": 225, "challengeHours": 48 },
  "lastRound": { "epoch": 20334, "total": 148200, "claimed": 121000, "winners": 10 },
  "upgradeAuthority": null
}
```

`obligations` es la suma de saldos WAR. `reservesRatio = custody / obligations`;
si baja de 1, se ve al momento. `upgradeAuthority: null` es la prueba de que el
programa es inmutable — el dato que más pesa de todo el JSON.

---

## 8. Plan de implementación

### Lo que el staking no cambia

La tesorería sigue igual de bloqueada: `fund_stake_rewards` saca de **custodia**, no
de la tesorería. Los premios del top 10 y el rendimiento del staking no compiten por
el mismo dinero.

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
