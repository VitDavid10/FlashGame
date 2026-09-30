package _fun.pillwars.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Pantalla de carga "BUILT ON SOLANA": el mismo rotulo que abre el video de la
// app (tools/origin-video/src/Mobile.tsx, escena 1): BUILT ON + marca + SOLANA
// sobre negro. Entra con un fundido y un pequeno "pop" de escala, y se queda
// respirando (escala 0.94 -> 1.02) mientras la pagina carga, como en el video.
@Composable
fun SolanaSplash() {
    val alpha = remember { Animatable(0f) }
    val scale = remember { Animatable(0.9f) }
    LaunchedEffect(Unit) {
        alpha.animateTo(1f, tween(350, easing = LinearEasing))
    }
    LaunchedEffect(Unit) {
        scale.animateTo(0.97f, tween(350, easing = FastOutSlowInEasing))
        scale.animateTo(1.03f, tween(1800, easing = LinearEasing))
    }
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier =
                Modifier.graphicsLayer {
                    this.alpha = alpha.value
                    scaleX = scale.value
                    scaleY = scale.value
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text("BUILT ON", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 3.sp)
            SolanaMark(height = 42.dp)
            Text("SOLANA", color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        }
    }
}

// Las tres barras inclinadas de la marca, con el degradado violeta -> verde
// (mismos puntos que SolMark en Mobile.tsx, viewBox 100 x 86).
@Composable
private fun SolanaMark(height: androidx.compose.ui.unit.Dp) {
    Canvas(modifier = Modifier.height(height).width(height * (100f / 86f))) {
        val k = size.height / 86f
        val brush =
            Brush.linearGradient(
                colors = listOf(Color(0xFF9945FF), Color(0xFF14F195)),
                start = Offset(0f, 0f),
                end = Offset(size.width * 0.25f, size.height),
            )
        fun bar(vararg p: Pair<Float, Float>) {
            val path = Path()
            p.forEachIndexed { i, (x, y) -> if (i == 0) path.moveTo(x * k, y * k) else path.lineTo(x * k, y * k) }
            path.close()
            drawPath(path, brush)
        }
        bar(18f to 0f, 100f to 0f, 82f to 20f, 0f to 20f)
        bar(0f to 33f, 82f to 33f, 100f to 53f, 18f to 53f)
        bar(18f to 66f, 100f to 66f, 82f to 86f, 0f to 86f)
    }
}
