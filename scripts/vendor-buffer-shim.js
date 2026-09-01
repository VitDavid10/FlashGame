/*
 * Buffer como GLOBAL dentro del bundle (esbuild --inject).
 *
 * @solana/spl-token está escrito para Node y usa `Buffer` sin importarlo: da
 * por hecho que existe como global. En Node lo es; en el navegador NO, así que
 * createTransferInstruction reventaba con "Buffer is not defined" en cuanto
 * codificaba el importe del depósito. esm.sh inyectaba este mismo apaño por su
 * cuenta — es una de las cosas que hacía por nosotros sin que se viera.
 *
 * Con --inject, esbuild mete esta definición en cada módulo del bundle que
 * mencione `Buffer`, resolviéndolo al del paquete `buffer` (que queda inlineado
 * en el propio fichero). No toca el `window.Buffer` de la página: vive solo
 * dentro del bundle.
 */
import { Buffer } from 'buffer';
export { Buffer };
