# Desplegar `pill_treasury` — de cero a bloqueado

Pasos para poner en marcha el programa de tesorería. Todo en **devnet** primero;
mainnet solo después de la calibración y con la lista del final entera en verde.

Diseño y razones: [TESORERIA-PLAN.md](TESORERIA-PLAN.md).

---

## 0. Herramientas

Compilar un programa de Solana necesita Rust + la CLI de Solana + Anchor. **En
Windows hay que hacerlo desde WSL**: el toolchain de BPF no compila nativo.

```bash
# En WSL (Ubuntu)
sudo apt install -y build-essential pkg-config libssl-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1 && avm use 0.31.1
```

Comprobación:

```bash
rustc --version && solana --version && anchor --version
```

El resto del repo (servidor, tests, scripts) **no necesita nada de esto**: es Node
puro y funciona sin cadena.

### El token de pruebas ya existe

Creado el 19/06/2026 con `scripts/create-devnet-token.js`, apuntado en
`scripts/devnet-token.json`. No hay que crear otro:

```
mint       Exth8VyQVuNaJdZsUjoPK3QdegdxJBYXAnzT3mP5xY1r   (devnet, 6 decimales)
autoridad  4ToGD9MyS5vxDtGGMgU2SRvmqnZ66XHmaUgKKdH65YMN
```

https://solscan.io/token/Exth8VyQVuNaJdZsUjoPK3QdegdxJBYXAnzT3mP5xY1r?cluster=devnet

**Hay que cambiar el cluster a devnet** en el selector de Solscan, o dirá que no
existe. Supply 994.575.000 de 1.000M — la diferencia son quemas de la tienda de
antes de que la tienda pasara a mandarlo todo al pozo del staking.

Casi todo está hoy en la wallet de autoridad, con llave privada. Eso es justo lo
que estos pasos vienen a cambiar.

---

## 1. La dirección del programa

La dirección sale de un keypair. Se genera una vez y **se guarda fuera de git** —
está en `.gitignore` por algo:

- si se filtra, otro puede desplegar en esa dirección antes que tú;
- si se pierde, no se puede volver a desplegar ahí **nunca más**.

```bash
node scripts/grind-program-id.js PiLL
```

Ya está hecho: la dirección es **`PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW`** y su
clave está en `programs/pill-treasury-keypair.json`, fuera de git. Tardó 5 h y 27 min
y 97 millones de intentos con 8 núcleos — la media teórica era de 11 millones, así que
fue mala suerte. **Guarda esa clave fuera de este equipo antes de desplegar.**

Para volver a generarla (otro prefijo, o si se pierde y da igual la dirección): el
mismo comando. Un prefijo de 3 letras sale en medio minuto.

No es seguridad de verdad, pero una dirección reconocible hace que colar un
contrato falso con otra dirección tenga que explicarse.

El `declare_id!` de `programs/pill-treasury/src/lib.rs` y las dos entradas de
`Anchor.toml` ya la llevan.

```bash
solana address -k programs/pill-treasury-keypair.json
```

---

## 2. Compilar y desplegar

```bash
solana config set --url devnet
solana airdrop 5                      # el despliegue cuesta ~3-4 SOL de devnet

anchor build
anchor deploy --provider.cluster devnet
```

Si `anchor build` se queja de que el ID no coincide, es que el `declare_id!` y el
keypair no son el mismo. `anchor keys sync` lo arregla.

---

## 3. Inicializar

Crea la config y los dos vaults. **Una sola vez en la vida del programa.**

```bash
export TREASURY_PROGRAM=PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW
export PILL_MINT=<el mint de $PILL>
export SOL_RPC=https://api.devnet.solana.com

npm run treasury -- init --unlock-days 30 --cap 1700000 --bps 225 --sweep-cap 500000 --burn-cap 500000
```

Los valores por defecto son los de **calibración**, no los definitivos:

| Parámetro | Valor | Por qué |
|---|---|---|
| `--unlock-days 30` | 30 días | corto a propósito: hay que medir antes de bloquear años |
| `--bps 225` | 2,25 %/día | **la curva de emisión**: halving mensual (ver §3.4 del plan) |
| `--cap 1700000` | 1 700 000 PILL/día | 44 días de premio alto y constante sobre una tesorería de 150 M |
| `--sweep-cap 500000` | 500 000 PILL/día | techo de lo que puede pasar de custodia a tesorería |
| `--burn-cap 500000` | 500 000 PILL/día | techo de lo que la tienda puede quemar de la custodia |

**`--bps` no es un tope de seguridad, es el calendario**: como el límite es un
porcentaje del saldo que queda, un bps constante *es* un halving. 225 reparte la
mitad de la tesorería cada mes; 38 cada semestre; 19 cada año. La tabla completa
está en [TESORERIA-PLAN.md §3.4](TESORERIA-PLAN.md).

Y **el número que pongas aquí es el techo de todo lo que puedas elegir después**,
porque `tighten` solo aprieta: de 225 se baja a 38, de 38 no se sube a 225. En caso
de duda, arrancar alto y bajar con los datos de los 30 días.

> **El cap depende de cuánto vayas a meter, así que decide eso ANTES del init.**
> Los dos frenos no se eligen por separado: manda el que muerda primero. Un cap de
> 200 000 sobre 30 M deja ~100 días de meseta; el mismo cap sobre 150 M deja 702,
> y el halving no se nota en dos años. La regla es
> `cap ≈ tesorería × bps / 10000 / 4`.
>
> ```bash
> # Ver la curva sobre lo que vas a meter DE VERDAD, antes de firmar nada
> npm run treasury -- init --bps 225 --cap 800000 --simular-con 150000000
> ```
>
> El comando imprime el reparto en los días 1/30/90/180/365 y avisa si el cap deja
> la curva sin efecto el primer año. La tabla de combinaciones está en
> [TESORERIA-PLAN.md §3.4](TESORERIA-PLAN.md).

**Si te quedas corto, `fund` no caduca.** Cualquiera puede aportar a la tesorería
cuando quiera, también después del cerrojo — `finalized` solo bloquea `tighten`. Y
como el grifo es un porcentaje del saldo, meter tokens **sube la emisión diaria
sola**: es la palanca que queda cuando los bps ya no se pueden subir.

El comando imprime las direcciones de **CUSTODIA** y **TESORERÍA**. Guárdalas: son
las dos que la gente va a mirar en el explorador.

```bash
npm run treasury -- status
```

### Activar el staking

Aparte del resto, y opcional: el programa funciona sin el.

```bash
npm run treasury -- init-staking
```

Crea las dos bolsas del pool. A partir de ahi, lo que la tienda desvia con
`PILL_TREASURY_PCT` alimenta las recompensas del staking en vez de la tesoreria, y
se reparte por goteo (24 h por defecto, `STAKE_DRIP_SECS`).

Para meter el rake de las partidas a mano:

```bash
npm run treasury -- fund-stake 50000 --hours 24
```

Por goteo y no de golpe a proposito: si se soltara entero, cualquiera stakearia un
segundo antes, cobraria su parte del dia y saldria.

---

## 4. Enchufar el servidor

En el VPS, a `pillwars.service`:

```ini
Environment=TREASURY_PROGRAM=PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW
Environment=PILL_TREASURY_PCT=50      # mitad de la tienda a tesorería, mitad se quema
Environment=REWARDS_TICK_MIN=20
Environment=LB_MIN_KILLS=3
Environment=LB_MIN_OPPONENTS=5     # oponentes distintos para entrar en el top 10
Environment=MATCH_BATCH_MIN=1      # cada cuanto se anclan los recibos de partida
Environment=RESERVES_EVERY_MIN=60  # cada cuanto se publica la lista de saldos
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart pillwars
curl -s https://TU-DOMINIO/api/treasury | jq
```

Ese JSON ya debería mostrar las dos bolsas por separado y `reservesRatio`.

**`PILL_TREASURY_PCT` no se toca hasta que el programa esté desplegado.** Sin
contrato no hay a dónde barrer, y la deuda de sweep se acumularía sin nadie que la
salde.

Con `TREASURY_PROGRAM` puesto, el servidor cambia de camino solo:

| | Sin contrato | Con contrato |
|---|---|---|
| Depósito | transferencia SPL a la wallet | instrucción `deposit` al PDA de custodia |
| Verificación | delta de la wallet | delta del PDA |
| Retiro | transfer desde la ATA de la autoridad | instrucción `withdraw` |
| Quema (tienda) | `burn` del ATA de la autoridad | instrucción `burn` del PDA, capada |

La web lo pregunta en cada depósito por `/api/fees`, no una vez al cargar: el día
que se despliegue, un jugador con la pestaña abierta desde hace horas seguiría
mandando el dinero a la cuenta vieja.

---

## 5. Meter los tokens del lanzamiento

Lo que compres en la salida va a la tesorería con `fund`. Es de ida: queda
bloqueado igual que todo lo demás, también para ti.

```bash
npm run treasury -- fund 30000000
```

### 5 bis. Qué ve exactamente alguien que mire el token

Es la pregunta que importa, porque toda la transparencia del diseño se apoya en
que cualquiera pueda comprobarlo sin fiarse de mí.

En Solana esto **no funciona como en Ethereum**. Allí el token *es* un contrato y
los holders pueden ser contratos. Aquí:

- El **mint** no tiene código propio. Lo gestiona el **SPL Token Program**, uno
  solo, compartido por todos los tokens de la red. No se le "mete" nada a un token.
- Los saldos no están en el mint: viven en **token accounts** aparte, cada una con
  un campo `owner`.
- Un programa **no puede tener llave privada**. Lo que tiene es una **PDA**: una
  dirección derivada de `hash(program_id + semilla)` que cae *fuera* de la curva
  ed25519. No es que la llave esté bien guardada — es que esa dirección **no puede
  tener llave**. Solo firma el programa, y solo ejecutando su propio código.

Las cuatro bolsas son deterministas: se derivan del program ID, así que cualquiera
las recalcula y comprueba que son estas y no otras.

```
CUSTODY   ETvkkwoHqdmdQfG8me9bLTFe8udgLgtNUNHZHCW3SqLP   dinero de los jugadores
TREASURY  4BHducidP1dnZJas3VCzjfBNyHbBfFAXn3t7LFcsoxQm   bloqueada años
STAKE     3nSsrgmeZHPaA4poFP8JH9DTv84EfQ2Q4RdyhrLuhFEp   principal de los stakers
REWARDS   82gqBvzN6p1r994eQ4VjGosubCMqEdDc8wMsisjS4ZeV   pozo por repartir
```

```bash
# Recalcularlas desde cero, sin fiarse del repo
solana find-program-derived-address PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW string:custody
solana account ETvkkwoHqdmdQfG8me9bLTFe8udgLgtNUNHZHCW3SqLP --output json
```

Lo que hace especiales a esas cuentas está en `lib.rs`:

```rust
token::authority = custody,
```

**La cuenta es su propia autoridad.** No apunta a mi wallet ni a un multisig: se
apunta a sí misma, y por sí misma no puede firmar nadie.

Después de `fund`, esas direcciones salen en la pestaña Holders del token. Pero
**Solscan no pone ningún cartel de "esto es un contrato" por su cuenta**: lo que se
ve es una dirección con saldo. Eso lo arregla el build verificable — ver §6 bis.

---

## 6. Calibrar (30 días)

Es la parte que no se puede saltar. Los caps **solo se pueden bajar**, y el bloqueo
va a durar años: un número mal puesto aquí no tiene arreglo después.

Cada semana:

```bash
npm run treasury -- status          # cuánto entra, cuánto sale, cuánto se reclama
npm run treasury:verify             # que la cadena y las raíces cuadren
npm run treasury:sim                # proyección con los datos REALES del log
```

El simulador lee `server/transactions.log` y saca el rake **medido**, no estimado:
entradas cobradas menos premios, cashouts y reembolsos. Lo que queda es lo que el
exit fee, la comisión de arcade, el bote no reclamado y las entradas perdidas dejan
en la casa, tal y como ocurrió.

Ojo con qué decide ese número: **ese rake va íntegro al pozo del staking**, así que
lo que estima es el rendimiento que van a ver los stakers, no los premios. Los caps
de la tesorería salen de otro sitio — del saldo que deje `fund()` dividido por los
años de recorrido que quieras darle:

    cap por época  ≤  saldo de tesorería / (365 × años)

Un cap por encima de eso vacía la tesorería antes de que venza el bloqueo, y
entonces el candado no protege nada porque ya no queda nada dentro.

```bash
# En el VPS, sobre el log de producción
node scripts/treasury-sim.js --log /ruta/a/server/transactions.log --anios 4
```

Lo que hay que responder antes de bloquear:

1. **¿Los ingresos reales se parecen al escenario del simulador?** Si el
   pesimista se queda largo, el cap tiene que bajar.
2. **¿La gente reclama?** Si la mitad de los premios caducan, el reparto está mal
   dimensionado o la UI de claim no se ve.
3. **¿`reservesRatio` se ha mantenido ≥ 1?** Si no, hay un descuadre entre los
   saldos internos y la custodia, y eso se arregla antes de seguir.
4. **¿El top 10 diario tiene sentido?** Si lo copan tres wallets, `LB_MIN_KILLS` se
   queda corto o hace falta otro criterio.

---

## 6 bis. El build verificable — antes del cerrojo, no después

Sin esto, cualquiera puede leer el código del repo y ver el programa desplegado,
pero **no puede comprobar que sean el mismo binario**. Todo el diseño se queda en
"el contrato hace esto, te lo prometo".

```bash
cargo install solana-verify
solana-verify verify-from-repo https://github.com/VitDavid10/FlashGame     --program-id PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW
```

Compila el repo en un contenedor reproducible y compara el hash con el binario que
hay en la cadena. Si coinciden, queda registrado y Solscan lo enseña como
verificado; a partir de ahí las invariantes del `lib.rs` dejan de ser una promesa y
pasan a ser algo que se lee del código que de verdad se está ejecutando.

**Va antes del cerrojo.** Después de revocar la upgrade authority ya no se puede
recompilar y volver a subir si el hash no cuadra por una versión distinta del
toolchain. Deja anotada la versión exacta de Anchor y de Rust con la que compilaste.

---

## 6 bis bis. El camino barato: arrancar por 1,5 SOL

Todo lo de arriba describe el contrato completo. Con presupuesto corto hay un orden
que cuesta mucho menos y no renuncia a lo que de verdad importa.

### Qué se despliega primero, y por qué ese

`programs/pill-custody` — **246 KB, 1,56 SOL** (medido compilando, no estimado).
Hace cuatro cosas: `initialize`, `deposit`, `withdraw` con dos firmas, y traspaso de
autoridad en dos pasos. Ni timelock, ni caps, ni premios, ni staking.

Es el primero porque **es el único que guarda dinero ajeno**. Los depósitos de los
jugadores pasan de estar en una wallet con llave privada —que se vacía en una
transacción— a una PDA que no puede tener llave. La tesorería, en cambio, guarda
dinero propio: si me lo llevo he mentido, pero no he robado a nadie.

De esos 246 KB, **175 KB son suelo de Anchor** y solo 71 KB son código nuestro. Por
eso partir el contrato en trozos sale más caro en total: ese suelo se paga entero
por cada programa.

### Cómo se reparten los premios mientras tanto

Sin contrato de tesorería, con **transferencias directas** desde la autoridad. Cuesta
el gas de diez transferencias al día en vez de la renta de un programa. Lo que lo
mantiene comprobable es el **orden**, no la confianza:

```
23:59  se cierra el día  →  hash de la clasificación
                                   │
                                   ▼
       Memo en la cadena  (leaderboard.anclarDia, ~0,000005 SOL)
                                   │   ← la lista queda fijada CON FECHA
                                   ▼
       10 transferencias a los ganadores  (rewards.pagarDirecto)
```

`pagarDirecto` **se niega a pagar un día que no esté anclado**, y hay un test que lo
fija: sin ancla previa el reparto no se puede contrastar con nada, y esto sería solo
una wallet mandando tokens.

Con eso, cualquiera coge el hash anclado —que lleva su fecha en la cadena—,
recalcula el hash de la lista de `/api/leaderboard/<fecha>` y comprueba que las
transferencias fueron a esas wallets y por esas cantidades.

**Lo que NO da, dicho sin adornos:** no impide pagar a otra wallet. Da que se
**note**, porque contradiría una lista cuyo hash ya estaba publicado antes. El
contrato convierte ese «se nota» en un «no se puede», y esa es exactamente la
diferencia por la que vale lo que cuesta — cuando se pueda pagar.

Se enciende con `REWARD_DIRECT_PAY=1`, apagado por defecto: que el servidor empiece
a mandar tokens porque falta una variable sería la peor forma de enterarse.

### Y el bloqueo del supply, aparte

Con **vesting externo** (ver TESORERIA-PLAN §3 bis): céntimos, ya auditado, y más
fuerte que el `unlock_ts` de aquí porque no depende de que yo no cambie el código.

### El orden completo, con precios

| paso | qué habilita | coste |
|---|---|---|
| Vesting externo del supply | «no puedo vender mi parte» | céntimos |
| `pill-custody` | los depósitos dejan de estar en mi wallet | **1,56 SOL** |
| Premios por transferencia + ancla | reparto diario comprobable | gas |
| `pill-treasury` (más tarde) | premios imposibles de desviar, y staking | 3,08 SOL |

---

## 6 ter. Lo que cuesta desplegar, y por qué importa antes de lo que parece

Desplegar cobra una **renta proporcional al tamaño del binario**, no una comisión
fija. En devnet da igual porque el SOL es gratis; en mainnet es dinero real:

```
3,967 SOL por 626 KB   ≈  6,3 lamports por byte
```

| SOL a | coste del despliegue |
|---|---|
| 100 $ | ~400 $ |
| 150 $ | ~595 $ |
| 200 $ | ~795 $ |

### Ese SOL NO se gasta: se aparca

`solana program close` lo devuelve **entero**, y esto cambia por completo la
decisión: mientras el programa siga siendo modificable, el despliegue cuesta cero
de verdad. Lo que convierte el depósito en gasto irreversible es el **paso 4 del
cerrojo** — revocar la upgrade authority. A partir de ahí el programa ya no se
puede cerrar y ese SOL queda enterrado para siempre.

O sea que hay dos momentos y no uno:

| | coste real | qué garantiza |
|---|---|---|
| Desplegar y no revocar | **0 $** (depósito recuperable) | El código está publicado y es verificable, pero podría cambiarse |
| Revocar la authority | 400-800 $ enterrados | Nadie puede tocarlo nunca, yo incluido |

**Con poco presupuesto, desplegar sin revocar es lo sensato.** Se dice en público
que la authority sigue viva y cuándo se revocará, y se revoca cuando el proyecto
valga más que ese depósito. Si el juego no arranca, se cierra el programa y el
dinero vuelve. Lo que no tiene marcha atrás es revocar y arrepentirse.

### Y el binario se puede encoger

Cada 100 KB que sobran son ~0,63 SOL inmovilizados. En `Cargo.toml`:

```toml
opt-level = "z"     # tamaño en vez de velocidad: aquí el límite son las
                    # unidades de computo de Solana, no el código máquina
panic = "abort"     # sin tablas de unwinding, que en Solana no sirven de nada
strip = true        # fuera los símbolos de depuración
```

Eso solo ya baja de **626 KB a 486 KB** — unos 134 $ a 150 $/SOL.

En `programs/pill-treasury/Cargo.toml`, `anchor-spl` con `default-features = false`
y solo lo que se usa. Ojo: `token_2022` hace falta aunque el mint sea SPL clásico,
porque el `#[derive(Accounts)]` de las restricciones `associated_token::` genera
código que lo referencia — sin esa feature no compila.

---

## 7. El cerrojo

Cuando los números cuadren, **con §6 bis ya hecho**, y en este orden:

```bash
# 1. Los caps definitivos (solo se puede apretar)
npm run treasury -- tighten --cap <el que salga de los datos reales>

# 2. El bloqueo de años
npm run treasury -- extend-lock --years 4

# 3. Congelar los parámetros para siempre
npm run treasury -- finalize

# 4. Y lo que de verdad importa: revocar la upgrade authority
solana program set-upgrade-authority PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW --final
```

Los tres primeros piden escribir a mano lo que va a pasar. No hay deshacer.

El paso 2 es el que responde a "que la gente vea que no puedo retirar nada":
mueve `unlock_ts` cuatro años hacia delante, y **`extend_lock` rechaza cualquier
fecha anterior a la que ya hay**. La única salida de la tesorería hasta entonces es
`claim`, que paga a la wallet que dice la hoja del árbol de Merkle — no a quien
firma la transacción.

**El paso 4 no es opcional** para que el resto signifique algo: mientras exista la
upgrade authority, todo lo anterior es decorativo, porque con ella se despliega otra
versión del programa que vacíe los vaults.

Pero **es también el que convierte la renta del despliegue en dinero enterrado**
(ver §6 ter): hasta ese momento el SOL se recupera cerrando el programa, y después
ya no. Si el presupuesto es corto, desplegar sin revocar y anunciarlo así es una
posición honesta; revocar y arrepentirse no tiene arreglo.
Es lo primero que mira cualquiera que audite esto, y `npm run treasury -- status`
lo dice en cada ejecución hasta que se revoca.

---

## 8. Antes de anunciarlo

- [ ] `npm run treasury -- status` dice **UPGRADE AUTHORITY: NINGUNA**
- [ ] `finalized: SI`
- [ ] `unlock_ts` a años vista
- [ ] `npm run treasury:verify` en verde
- [ ] `/api/treasury` accesible sin auth y con `reservesRatio ≥ 1`
- [ ] `/api/leaderboard/chain` verificable por cualquiera
- [ ] El código del programa publicado y **verificado** (`solana-verify`), para que
      se pueda comprobar que el binario desplegado sale de este código
- [ ] Al menos una ronda completa hecha en devnet: publicar → 48 h → claim
- [ ] Escrito en algún sitio, con estas palabras, **lo que NO garantiza**:
      que los saldos internos son off-chain, que sybil es posible aunque cueste
      dinero, y que la custodia depende de la clave del servidor

Ese último punto no es humildad. Un proyecto que solo publica lo que garantiza es
indistinguible de uno que esconde lo que no.

---

## Si algo va mal

| Síntoma | Qué pasa |
|---|---|
| `publish_round` da `RewardCapExceeded` | el reparto pasa del grifo de hoy; el presupuesto se recorta solo en el siguiente tick |
| `publish_round` da `EpochNotFinished` | se intenta premiar un día que aún se está jugando |
| `claim` da `ChallengeWindowOpen` | aún no han pasado las 48 h. Es lo esperado |
| `claim` da `InvalidProof` | la lista publicada no es la de la raíz. **Parar y mirar**: o el JSON se regeneró con otros datos, o alguien lo tocó |
| `sweep` da `SweepCapExceeded` | día de tienda muy bueno; el resto se barre mañana |
| `reservesRatio < 1` | hay menos en custodia de lo que se debe. Parar retiros y cuadrar antes de seguir |
| Una ronda se publicó mal | `cancel_round`, pero **solo dentro de las 48 h**. Después no hay forma, y ese es el punto |
