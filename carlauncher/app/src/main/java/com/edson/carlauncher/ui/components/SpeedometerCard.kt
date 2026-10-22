package com.edson.carlauncher.ui.components

import android.graphics.BlurMaskFilter
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.coerceAtMost
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.edson.carlauncher.domain.model.SpeedInfo
import com.edson.carlauncher.ui.theme.AccentBlue
import com.edson.carlauncher.ui.theme.AlertRed
import com.edson.carlauncher.ui.theme.ArcBase
import com.edson.carlauncher.ui.theme.CardBorder
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.SidebarIconSurface
import com.edson.carlauncher.ui.theme.SpeedGreen
import com.edson.carlauncher.ui.theme.SpeedHighlight
import com.edson.carlauncher.ui.theme.TextMuted
import com.edson.carlauncher.ui.theme.TextPrimary
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Arco do velocímetro: começa à esquerda (160°) e passa por cima até a direita (20°). */
private const val ARC_START = 160f
private const val ARC_SWEEP = 220f

/** Quanto o arco ocupa na vertical em relação ao raio: 1 (topo) + sen(20°) (pontas). */
private const val ARC_HEIGHT_FACTOR = 1.342f

@Composable
fun SpeedometerCard(info: SpeedInfo, modifier: Modifier = Modifier) {
    val animated by animateFloatAsState(
        targetValue = (info.speed ?: 0).toFloat(),
        animationSpec = tween(350, easing = FastOutSlowInEasing),
        label = "speed"
    )
    val overLimit = info.showLimit && info.limit != null && (info.speed ?: 0) > info.limit

    BoxWithConstraints(modifier.driveCard()) {
        val density = LocalDensity.current
        val w = maxWidth
        val h = maxHeight
        val pad = (min(w.value, h.value) * 0.08f).dp.coerceIn(12.dp, 24.dp)
        val stroke = (h * 0.045f).coerceIn(6.dp, 10.dp)
        val badgeSize = (h * 0.24f).coerceIn(42.dp, 72.dp)

        // Geometria do arco (em dp), centralizada e sem encostar nas bordas
        val availW = w - pad * 2 - badgeSize * 0.6f
        // Folga para o brilho e o ponto na ponta do arco
        val availH = h - pad * 2 - stroke * 2.5f
        val radius: Dp = min(availW.value / 2f, availH.value / ARC_HEIGHT_FACTOR).dp.coerceAtLeast(30.dp)
        val cx = w / 2
        val top = pad + stroke * 1.25f + (availH - radius * ARC_HEIGHT_FACTOR) / 2
        val cy = top + radius

        Canvas(Modifier.fillMaxSize()) {
            val r = radius.toPx()
            val c = Offset(cx.toPx(), cy.toPx())
            val sw = stroke.toPx()
            val arcTopLeft = Offset(c.x - r, c.y - r)
            val arcSize = Size(r * 2, r * 2)

            drawArc(
                color = ArcBase,
                startAngle = ARC_START,
                sweepAngle = ARC_SWEEP,
                useCenter = false,
                topLeft = arcTopLeft,
                size = arcSize,
                style = Stroke(width = sw, cap = StrokeCap.Round)
            )

            val fraction = (animated / info.maxScale).coerceIn(0f, 1f)
            val sweep = ARC_SWEEP * fraction
            if (info.speed != null && sweep > 0.5f) {
                val base = if (overLimit) AlertRed else SpeedGreen
                val tip = if (overLimit) Color(0xFFFF9AA0) else SpeedHighlight
                rotate(ARC_START, pivot = c) {
                    // Brilho suave (desfoque) por baixo do arco
                    drawIntoCanvas { canvas ->
                        val glow = android.graphics.Paint().apply {
                            isAntiAlias = true
                            style = android.graphics.Paint.Style.STROKE
                            strokeWidth = sw * 1.4f
                            strokeCap = android.graphics.Paint.Cap.ROUND
                            color = base.copy(alpha = 0.28f).toArgb()
                            maskFilter = BlurMaskFilter(sw * 1.6f, BlurMaskFilter.Blur.NORMAL)
                        }
                        canvas.nativeCanvas.drawArc(c.x - r, c.y - r, c.x + r, c.y + r, 0f, sweep, false, glow)
                    }
                    val end = sweep / 360f
                    val brush = Brush.sweepGradient(
                        0f to base,
                        (end * 0.55f) to base,
                        end to tip,
                        (end + 0.02f).coerceAtMost(0.99f) to base,
                        1f to base,
                        center = c
                    )
                    drawArc(
                        brush = brush,
                        startAngle = 0f,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = arcTopLeft,
                        size = arcSize,
                        style = Stroke(width = sw, cap = StrokeCap.Round)
                    )
                }
                // Ponto de destaque na ponta do arco
                val a = Math.toRadians((ARC_START + sweep).toDouble())
                val tipPos = Offset(c.x + (r * cos(a)).toFloat(), c.y + (r * sin(a)).toFloat())
                drawCircle(tip.copy(alpha = 0.22f), radius = sw * 1.25f, center = tipPos)
                drawCircle(tip, radius = sw * 0.32f, center = tipPos)
            }
        }

        // Número e unidade dentro do arco, sem nunca passar da borda de baixo do card
        val numberDp = (radius * 0.66f).coerceAtMost(112.dp)
        val unitDp = (radius * 0.16f).coerceIn(12.dp, 26.dp)
        val numberSize = with(density) { numberDp.toSp() }
        val unitSize = with(density) { unitDp.toSp() }
        val blockHeight = numberDp + unitDp * 1.3f
        val blockTop = (cy - numberDp * 0.72f)
            .coerceAtMost(h - pad - blockHeight)
            .coerceAtLeast(pad)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = blockTop),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = info.speed?.toString() ?: "--",
                style = DriveType.speedNumber.copy(
                    fontSize = numberSize,
                    lineHeight = numberSize,
                    color = TextPrimary,
                    shadow = Shadow(Color.Black.copy(alpha = 0.35f), Offset(0f, 6f), 18f)
                ),
                textAlign = TextAlign.Center
            )
            Text(
                text = if (info.speed == null) info.status ?: "Aguardando GPS" else info.unit,
                style = DriveType.speedUnit.copy(
                    fontSize = if (info.speed == null) unitSize * 0.8f else unitSize,
                    lineHeight = unitSize * 1.3f
                ),
                textAlign = TextAlign.Center
            )
        }

        // Limite da via, na ponta direita do arco
        if (info.showLimit) {
            val endAngle = Math.toRadians((ARC_START + ARC_SWEEP).toDouble())
            val bx = (cx + radius * cos(endAngle).toFloat()).coerceAtMost(w - pad - badgeSize / 2)
            val by = (cy + radius * sin(endAngle).toFloat()).coerceAtMost(h - pad - badgeSize / 2)
            SpeedLimitBadge(
                limit = info.limit,
                size = badgeSize,
                modifier = Modifier.offset(x = bx - badgeSize / 2, y = by - badgeSize / 2)
            )
        }

        if (info.isDemo) DemoChip(Modifier.align(Alignment.TopStart).padding(pad))
    }
}

@Composable
private fun SpeedLimitBadge(limit: Int?, size: Dp, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    val known = limit != null
    Box(
        modifier = modifier
            .size(size)
            .shadow(6.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.3f))
            .background(if (known) Color.White else SidebarIconSurface, CircleShape)
            .border(size * 0.085f, if (known) AlertRed else CardBorder, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = limit?.toString() ?: "--",
            style = DriveType.speedUnit.copy(
                fontSize = with(density) { (size * 0.36f).toSp() },
                fontWeight = FontWeight.SemiBold,
                color = if (known) Color(0xFF0B1118) else TextMuted
            )
        )
    }
}

@Composable
fun DemoChip(modifier: Modifier = Modifier) {
    Text(
        text = "DEMONSTRAÇÃO",
        style = DriveType.caption.copy(color = AccentBlue, fontSize = 11.sp, letterSpacing = 1.sp),
        modifier = modifier
            .background(AccentBlue.copy(alpha = 0.12f), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    )
}
