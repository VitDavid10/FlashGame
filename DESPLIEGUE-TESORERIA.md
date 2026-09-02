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

---

## 1. La dirección del programa

La dirección sale de un keypair. Se genera una vez y **se guarda fuera de git** —
está en `.gitignore` por algo:

- si se filtra, otro puede desplegar en esa dirección antes que tú;
- si se pierde, no se puede volver a desplegar ahí **nunca más**.

```bash
node scripts/grind-program-id.js PiLL
```

Busca una dirección que empiece por `PiLL`. Con 8 núcleos tarda unos 20 minutos
(son ~11 millones de intentos). Un prefijo de 3 letras sale en medio minuto.

No es seguridad de verdad, pero una dirección reconocible hace que colar un
contrato falso con otra dirección tenga que explicarse.

Después, el `declare_id!` de `programs/pill-treasury/src/lib.rs` y las dos entradas
de `Anchor.toml` tienen que llevar esa dirección.

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
export TREASURY_PROGRAM=<la dirección>
export PILL_MINT=<el mint de $PILL>
export SOL_RPC=https://api.devnet.solana.com

npm run treasury -- init --unlock-days 30 --cap 60000 --bps 5 --sweep-cap 500000 --burn-cap 500000
```

Los valores por defecto son los de **calibración**, no los definitivos:

| Parámetro | Valor | Por qué |
|---|---|---|
| `--unlock-days 30` | 30 días | corto a propósito: hay que medir antes de bloquear años |
| `--cap 60000` | 60 000 PILL/día | el equilibrio del escenario pesimista de `npm run treasury:sim` |
| `--bps 5` | 0,05 %/día | segundo freno, relativo al saldo |
| `--sweep-cap 500000` | 500 000 PILL/día | techo de lo que puede pasar de custodia a tesorería |
| `--burn-cap 500000` | 500 000 PILL/día | techo de lo que la tienda puede quemar de la custodia |

El comando imprime las direcciones de **CUSTODIA** y **TESORERÍA**. Guárdalas: son
las dos que la gente va a mirar en el explorador.

```bash
npm run treasury -- status
```

---

## 4. Enchufar el servidor

En el VPS, a `pillwars.service`:

```ini
Environment=TREASURY_PROGRAM=<la dirección>
Environment=PILL_TREASURY_PCT=50      # mitad de la tienda a tesorería, mitad se quema
Environment=REWARDS_TICK_MIN=20
Environment=LB_MIN_KILLS=3
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
exit fee de classic y el bote no reclamado de arcade dejan en la casa, tal y como
ocurrió. Ese número, y no una hipótesis, es el que decide los caps.

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

## 7. El cerrojo

Cuando los números cuadren, y en este orden:

```bash
# 1. Los caps definitivos (solo se puede apretar)
npm run treasury -- tighten --cap <el que salga de los datos reales>

# 2. El bloqueo de años
npm run treasury -- extend-lock --years 4

# 3. Congelar los parámetros para siempre
npm run treasury -- finalize

# 4. Y lo que de verdad importa: revocar la upgrade authority
solana program set-upgrade-authority <TREASURY_PROGRAM> --final
```

Los tres primeros piden escribir a mano lo que va a pasar. No hay deshacer.

**El paso 4 no es opcional.** Mientras exista la upgrade authority, todo lo anterior
es decorativo: con ella se despliega otra versión del programa que vacíe los vaults.
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
