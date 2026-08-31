/*
 * Punto de entrada del bundle de Solana que sirve NUESTRO servidor.
 *
 * Antes, las dos páginas que firman transacciones (index.html y game/index.html)
 * importaban la librería desde https://esm.sh en tiempo de ejecución. Eso
 * significa que el navegador del jugador descargaba y ejecutaba, dentro de
 * nuestra web, código de un tercero — y precisamente el código que CONSTRUYE la
 * transacción que el usuario firma. Si esm.sh se cae, la wallet deja de
 * funcionar; si lo comprometen, pueden cambiar el destinatario de una
 * transferencia justo antes de la firma y el jugador aprueba sin notarlo (es lo
 * que le pasó a las 100.000+ webs que cargaban polyfill.io en 2024).
 *
 * Este fichero declara SOLO lo que las dos páginas usan de verdad. `npm run
 * vendor:solana` lo empaqueta con esbuild —resolviendo las ~14 dependencias que
 * el build de web3.js trae por nombre de paquete, que un navegador no sabe
 * resolver solo— en un único fichero autocontenido: vendor/solana.js.
 *
 * Si algún día una página necesita algo más de la librería, se añade aquí y se
 * vuelve a lanzar el comando: si se importa directamente en el HTML algo que no
 * esté exportado aquí, fallará al cargar (y no de forma silenciosa).
 */
export { Connection, PublicKey, Transaction } from '@solana/web3.js';
export {
    getAssociatedTokenAddress,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getAccount,
    TokenAccountNotFoundError,
} from '@solana/spl-token';
