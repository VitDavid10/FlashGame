package _fun.pillwars.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

// Siempre los colores del juego, sin tema claro ni colores dinamicos del
// sistema: la barra de carga, el aviso de error y el fondo que asoma antes de
// que pinte la pagina tienen que casar con el negro y el amarillo de PillWars.
private val PillWarsColorScheme = darkColorScheme(
    primary = PillYellow,
    onPrimary = GameBlack,
    background = GameBlack,
    onBackground = TextWhite,
    surface = GameBlack,
    onSurface = TextWhite,
)

@Composable
fun WebShellTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PillWarsColorScheme,
        typography = Typography,
        content = content
    )
}
