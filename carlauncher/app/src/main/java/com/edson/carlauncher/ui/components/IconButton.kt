package com.edson.carlauncher.ui.components

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import com.edson.carlauncher.ui.theme.CardBorder
import com.edson.carlauncher.ui.theme.CardSurface
import com.edson.carlauncher.ui.theme.DriveShapes

/** Fundo padrão dos cards: superfície escura, borda fina discreta e sombra suave para baixo. */
fun Modifier.driveCard(shape: Shape = DriveShapes.card): Modifier = this
    .shadow(
        elevation = 16.dp,
        shape = shape,
        ambientColor = Color.Black.copy(alpha = 0.24f),
        spotColor = Color.Black.copy(alpha = 0.24f)
    )
    .clip(shape)
    .background(Brush.verticalGradient(listOf(Color(0xFF13202F), CardSurface)))
    .border(1.dp, CardBorder.copy(alpha = 0.55f), shape)

/** Botão com área de toque fixa, ripple discreto e escala 0.97 → 1.0 ao pressionar (120 ms). */
@Composable
fun DriveIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 52.dp,
    background: Color = Color.Transparent,
    shape: Shape = CircleShape,
    contentDescription: String? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = tween(120, easing = FastOutSlowInEasing),
        label = "press"
    )
    Box(
        modifier = modifier
            .size(size)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .background(background)
            .clickable(
                interactionSource = interaction,
                indication = LocalIndication.current,
                onClickLabel = contentDescription,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center,
        content = content
    )
}

/** Ícone oficial de um app instalado (ou nulo se não estiver instalado). */
@Composable
fun rememberAppIcon(packageName: String?): ImageBitmap? {
    val context = LocalContext.current
    return remember(packageName) { packageName?.let { appIcon(context, it) } }
}

fun appIcon(context: Context, packageName: String): ImageBitmap? = try {
    context.packageManager.getApplicationIcon(packageName).toBitmap(160, 160).asImageBitmap()
} catch (e: Exception) {
    null
}

/** Ícone do app de telefone padrão. */
@Composable
fun rememberDialerIcon(): ImageBitmap? {
    val context = LocalContext.current
    return remember {
        try {
            val pm = context.packageManager
            val info = pm.resolveActivity(Intent(Intent.ACTION_DIAL), PackageManager.MATCH_DEFAULT_ONLY)
            if (info == null || info.activityInfo.packageName == "android") null
            else info.loadIcon(pm).toBitmap(160, 160).asImageBitmap()
        } catch (e: Exception) {
            null
        }
    }
}
