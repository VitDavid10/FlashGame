package _fun.pillwars.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface

// Lo poco que el WebView no sabe hacer solo, para el SHARE de los carteles de
// fin de partida (game/app-share.js): guardar la card en la galeria y copiar el
// enlace. Desde JS: window.PillAndroid.saveImage(base64, nombre) / copyText(t).
class PillBridge(private val context: Context) {
    @JavascriptInterface
    fun saveImage(base64: String, name: String): Boolean {
        // Una card de 1200x630 en PNG no pasa de ~2 MB; mas que eso no es nuestra.
        if (base64.length > MAX_B64 || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val safe = name.filter { it.isLetterOrDigit() || it == '-' || it == '.' }.take(64).ifEmpty { "pillwars.png" }
            val values =
                ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, safe)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PillWars")
                }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
            true
        } catch (e: Exception) {
            Log.w("PillBridge", "saveImage: ${e.message}")
            false
        }
    }

    @JavascriptInterface
    fun copyText(text: String): Boolean {
        if (text.length > 2048) return false
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        cm.setPrimaryClip(ClipData.newPlainText("PillWars", text))
        return true
    }

    private companion object {
        const val MAX_B64 = 8 * 1024 * 1024
    }
}
