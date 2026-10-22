package com.edson.carlauncher.ui.screens

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.edson.carlauncher.Launch
import com.edson.carlauncher.R
import com.edson.carlauncher.domain.model.MediaInfo
import com.edson.carlauncher.domain.model.SpeedInfo
import com.edson.carlauncher.ui.components.AppSidebar
import com.edson.carlauncher.ui.components.DriveIconButton
import com.edson.carlauncher.ui.components.MusicPlayerCard
import com.edson.carlauncher.ui.components.SidebarItem
import com.edson.carlauncher.ui.components.SpeedometerCard
import com.edson.carlauncher.ui.components.driveCard
import com.edson.carlauncher.ui.components.rememberAppIcon
import com.edson.carlauncher.ui.theme.AccentBlue
import com.edson.carlauncher.ui.theme.BackgroundEnd
import com.edson.carlauncher.ui.theme.BackgroundPrimary
import com.edson.carlauncher.ui.theme.BackgroundSecondary
import com.edson.carlauncher.ui.theme.DriveShapes
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.PlayButtonSurface
import com.edson.carlauncher.ui.theme.Space
import com.edson.carlauncher.ui.theme.TextPrimary

/** Parte da largura útil reservada para o Waze quando ele abre ao lado (60% painel / 40% Waze). */
const val WAZE_FRACTION = 0.40f

/** Fundo: gradiente diagonal + brilho azul radial muito discreto (máx. 8%). */
fun Modifier.driveBackground(): Modifier = this
    .background(Brush.linearGradient(listOf(BackgroundPrimary, BackgroundSecondary, BackgroundEnd)))
    .drawBehind {
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(AccentBlue.copy(alpha = 0.08f), Color.Transparent),
                center = Offset(size.width * 0.42f, size.height * 0.45f),
                radius = size.maxDimension * 0.45f
            ),
            radius = size.maxDimension * 0.45f,
            center = Offset(size.width * 0.42f, size.height * 0.45f)
        )
    }

@Composable
fun DashboardScreen(
    speed: SpeedInfo,
    media: MediaInfo,
    wazePopupOpen: Boolean,
    nativeSplit: Boolean,
    onOpenWaze: () -> Unit,
    onCloseWazePane: () -> Unit,
    onMusicApp: () -> Unit,
    onPhone: () -> Unit,
    onApps: () -> Unit,
    onPlayPause: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onGrantMediaAccess: () -> Unit
) {
    val musicIcon = rememberAppIcon(media.packageName ?: Launch.YT_MUSIC)

    Box(
        Modifier
            .fillMaxSize()
            .driveBackground()
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(Space.outer)
        ) {
            // Em tela dividida nativa o próprio Android já encolhe a janela; no pop-up, reservamos 40%
            val reserve = wazePopupOpen && !nativeSplit
            val fullWazeWidth = maxWidth * WAZE_FRACTION
            val wazeWidth by animateDpAsState(
                targetValue = if (reserve) fullWazeWidth else 0.dp,
                animationSpec = tween(300, easing = FastOutSlowInEasing),
                label = "waze"
            )

            Row(Modifier.fillMaxSize()) {
                AppSidebar(
                    active = if (wazePopupOpen || nativeSplit) SidebarItem.WAZE else SidebarItem.DASHBOARD,
                    onWaze = onOpenWaze,
                    onMusic = onMusicApp,
                    onPhone = onPhone,
                    onDashboard = onCloseWazePane,
                    onApps = onApps
                )
                Spacer(Modifier.width(Space.cardGap))

                // Velocímetro em cima (52%) e música embaixo (48%), sempre ocupando toda a área
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                ) {
                    SpeedometerCard(
                        info = speed,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(0.52f)
                    )
                    Spacer(Modifier.height(Space.cardGap))
                    MusicPlayerCard(
                        info = media,
                        appIcon = musicIcon,
                        onPlayPause = onPlayPause,
                        onPrevious = onPrevious,
                        onNext = onNext,
                        onOpenPlayer = onMusicApp,
                        onGrantAccess = onGrantMediaAccess,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(0.48f)
                    )
                }

                if (wazeWidth > 1.dp) {
                    Spacer(Modifier.width(Space.cardGap * (wazeWidth / fullWazeWidth).coerceIn(0f, 1f)))
                    WazePane(
                        onReopen = onOpenWaze,
                        onFullScreen = onCloseWazePane,
                        modifier = Modifier
                            .width(wazeWidth)
                            .fillMaxHeight()
                    )
                }
            }
        }
    }
}

/**
 * Espaço do Waze. A janela do Waze fica por cima deste cartão; ele só aparece se a janela
 * for fechada ou minimizada (aí dá para reabrir ou voltar à tela cheia).
 */
@Composable
private fun WazePane(onReopen: () -> Unit, onFullScreen: () -> Unit, modifier: Modifier = Modifier) {
    val wazeIcon = rememberAppIcon(Launch.WAZE)
    Box(modifier.driveCard()) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(Space.XL),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            DriveIconButton(onClick = onReopen, size = 72.dp, shape = DriveShapes.bigButton, contentDescription = "Abrir o Waze") {
                if (wazeIcon != null) {
                    Image(wazeIcon, null, Modifier.fillMaxSize().clip(DriveShapes.bigButton))
                } else {
                    Icon(painterResource(R.drawable.ic_navigation), null, tint = AccentBlue, modifier = Modifier.size(30.dp))
                }
            }
            Spacer(Modifier.height(Space.LG))
            Text("Waze", style = DriveType.musicTitle.copy(fontSize = DriveType.musicTitle.fontSize * 0.8f))
            Text(
                "Toque para abrir o Waze aqui",
                style = DriveType.musicArtist.copy(fontSize = DriveType.musicArtist.fontSize * 0.8f),
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(Space.XXL))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.MD)) {
                PaneButton("Abrir", R.drawable.ic_navigation, onReopen)
                PaneButton("Tela cheia", R.drawable.ic_maximize, onFullScreen)
            }
        }
    }
}

@Composable
private fun PaneButton(label: String, icon: Int, onClick: () -> Unit) {
    DriveIconButton(
        onClick = onClick,
        size = 64.dp,
        background = PlayButtonSurface,
        shape = CircleShape,
        contentDescription = label
    ) {
        Icon(painterResource(icon), label, tint = TextPrimary, modifier = Modifier.size(26.dp))
    }
}
