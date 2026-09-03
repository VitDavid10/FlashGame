#!/usr/bin/env bash
#
# Despliega pill_custody y lo inicializa. En ese orden y sin pausas: entre las dos
# cosas hay una ventana en la que cualquiera podria adelantarse a `initialize`.
#
#   scripts/deploy-custody.sh <mint> [autoridad]
#
# El mint es el token que va a custodiar. La autoridad es quien podra ordenar
# retiros (por defecto, la wallet activa).
#
# ANTES DE GASTAR NADA comprueba tres cosas, porque las tres cuestan 1,56 SOL si
# fallan despues:
#   1. la wallet activa es la que esta compilada en DEPLOYER
#   2. hay saldo de sobra
#   3. no quedan buffers huerfanos de un intento anterior (SOL olvidado)
set -euo pipefail

MINT="${1:?falta el mint}"
AUTORIDAD="${2:-$(solana address)}"
SO=target/deploy/pill_custody.so
KEYPAIR=target/deploy/pill_custody-keypair.json

[ -f "$SO" ] || { echo "No hay $SO. Compila primero."; exit 1; }

# 1. La constante DEPLOYER contra la wallet que va a firmar.
#    Si el codigo dice una direccion y firma otra, initialize falla DESPUES del
#    despliegue, con el SOL ya gastado — el mismo dano del que protege la constante.
FUENTE=programs/pill-custody/src/lib.rs
DEPLOYER=$(grep -o 'pubkey!("[^"]*"' "$FUENTE" | head -1 | cut -d'"' -f2)
YO=$(solana address)
[ -n "$DEPLOYER" ] || { echo "No encuentro DEPLOYER en $FUENTE"; exit 1; }
if [ "$DEPLOYER" != "$YO" ]; then
    echo "El codigo solo deja inicializar a:  $DEPLOYER"
    echo "La wallet activa es:                $YO"
    echo
    echo "Cambia DEPLOYER en $FUENTE y recompila, o cambia de wallet."
    exit 1
fi

#    Y que el binario sea de DESPUES del ultimo cambio del codigo: un .so viejo
#    lleva la constante vieja y el aviso de arriba no serviria de nada.
if [ "$FUENTE" -nt "$SO" ]; then
    echo "$FUENTE es mas reciente que $SO. Recompila antes de desplegar."
    exit 1
fi

# 2. Saldo. El despliegue son ~1,56 SOL de renta mas comisiones.
BYTES=$(stat -c%s "$SO")
NECESARIO=$(python3 -c "print(round(($BYTES + 45) * 6.96e-9 * 2 + 0.05, 3))")
SALDO=$(solana balance | cut -d' ' -f1)
echo "Binario: $BYTES bytes | necesario ~$NECESARIO SOL | tienes $SALDO SOL"
python3 -c "import sys; sys.exit(0 if float('$SALDO') >= float('$NECESARIO') else 1)" \
    || { echo "Saldo insuficiente."; exit 1; }

# 3. Buffers huerfanos. Un despliegue cortado a medias deja ~1,5 SOL dentro de un
#    buffer que no se ve por ningun lado. Es la forma mas comun de "perder" SOL.
BUFFERS=$(solana program show --buffers 2>/dev/null | tail -n +2 | wc -l)
if [ "$BUFFERS" -gt 0 ]; then
    echo "Hay $BUFFERS buffer(s) de intentos anteriores con SOL dentro:"
    solana program show --buffers
    echo "Recuperalo con: solana program close --buffers"
    exit 1
fi

echo
echo "Desplegando..."
solana program deploy "$SO" --program-id "$KEYPAIR"
PROGRAMA=$(solana address -k "$KEYPAIR")
echo "Programa: $PROGRAMA"

echo
echo "Inicializando (mint $MINT, autoridad $AUTORIDAD)..."
node scripts/custody.js init "$PROGRAMA" "$MINT" "$AUTORIDAD"

echo
echo "Listo. Comprueba antes de meter dinero:"
echo "  solana program show $PROGRAMA"
echo "  node scripts/custody.js estado $PROGRAMA"
echo
echo "OJO con los upgrades: --max-len por defecto reserva justo el tamano de HOY."
echo "Un parche que ocupe mas bytes NO cabra. Antes de subirlo:"
echo "  solana program extend $PROGRAMA <bytes de mas>   # cuesta renta adicional"
echo
echo "La upgrade authority sigue viva: puedes parchear bugs y recuperar la renta."
echo "Revocar (irreversible, y renuncia a los $NECESARIO SOL):"
echo "  solana program set-upgrade-authority $PROGRAMA --final"
