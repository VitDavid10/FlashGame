#!/usr/bin/env bash
#
# Instala lo necesario para compilar y desplegar el programa pill_treasury:
# Rust, la CLI de Solana y Anchor. Pensado para Ubuntu (WSL o VPS).
#
#   bash deploy/setup-solana-toolchain.sh
#
# NO instala nada del juego. El servidor de PillWars es Node puro y no necesita
# nada de esto: solo hace falta en la maquina desde la que se compila el contrato.
#
# Las tres cosas que costaron una noche averiguar, y que este script ya trae puestas:
#
#   1. Sin build-essential/pkg-config/libssl-dev, el compilador de Rust falla a
#      mitad con errores que no dicen que falten librerias del sistema.
#
#   2. `avm use` instala su PROPIO toolchain de Solana (2.1.0 con platform-tools
#      v1.43 y rustc 1.79) y gana en el PATH sobre el que instales tu. Ese rustc va
#      muy por detras del ecosistema: medio crates.io publica ya para edition2024
#      (Rust 1.85+), asi que el build revienta con "feature `edition2024` is
#      required" en dependencias que ni salen en nuestro Cargo.toml. Se arregla
#      pidiendo tools mas nuevos: `cargo-build-sbf --tools-version v1.50`.
#
#   3. Los platform-tools se descargan a veces SIN permiso de ejecucion, y entonces
#      el build muere con "command failed: 'cargo': Permission denied" — un error
#      que no dice nada sobre permisos de un fichero que no es el tuyo.
#
set -e

TOOLS_VERSION="${TOOLS_VERSION:-v1.50}"
ANCHOR_VERSION="${ANCHOR_VERSION:-0.31.1}"

echo "==> 1/5  Librerias del sistema"
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev curl

echo "==> 2/5  Rust"
if ! command -v rustc >/dev/null 2>&1; then
    # -y para que no abra el menu interactivo: por SSH se queda colgado esperando.
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
. "$HOME/.cargo/env"
rustc --version

echo "==> 3/5  CLI de Solana"
if ! command -v solana >/dev/null 2>&1; then
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release' "$HOME/.bashrc" 2>/dev/null || \
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
solana --version

echo "==> 4/5  Anchor $ANCHOR_VERSION  (compila desde fuente, tarda)"
if ! command -v avm >/dev/null 2>&1; then
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
fi
avm install "$ANCHOR_VERSION"
avm use "$ANCHOR_VERSION"
anchor --version

echo "==> 5/5  platform-tools $TOOLS_VERSION"
# Se baja solo la primera vez que se compila; forzarlo aqui deja el fallo de
# permisos a la vista ahora y no en mitad de un build de veinte minutos.
cargo-build-sbf --tools-version "$TOOLS_VERSION" --version || true
if [ -d "$HOME/.cache/solana/$TOOLS_VERSION" ]; then
    chmod -R +x "$HOME/.cache/solana/$TOOLS_VERSION/platform-tools/" 2>/dev/null || true
    echo "    permisos de ejecucion asegurados en $TOOLS_VERSION"
fi

echo ""
echo "==> Listo. Para compilar el programa:"
echo "      cd <repo> && cargo-build-sbf --tools-version $TOOLS_VERSION"
echo ""
echo "    OJO con 'anchor build' a secas: usa el toolchain viejo de avm (rustc 1.79)"
echo "    y falla con 'feature edition2024 is required'. Compila con cargo-build-sbf"
echo "    directamente (genera el mismo target/deploy/pill_treasury.so) hasta"
echo "    confirmar si esta version de anchor-cli acepta pasarle --tools-version."
