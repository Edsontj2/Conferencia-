package com.edson.carlauncher.ui.components

import android.os.SystemClock
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.coerceAtMost
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import com.edson.carlauncher.R
import com.edson.carlauncher.domain.model.MediaInfo
import com.edson.carlauncher.ui.theme.CardSurface
import com.edson.carlauncher.ui.theme.DriveShapes
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.PlayButtonSurface
import com.edson.carlauncher.ui.theme.ProgressBase
import com.edson.carlauncher.ui.theme.TextPrimary
import com.edson.carlauncher.ui.theme.TextSecondary
import com.edson.carlauncher.ui.theme.YouTubeRed
import kotlinx.coroutines.delay

@Composable
fun MusicPlayerCard(
    info: MediaInfo,
    appIcon: ImageBitmap?,
    onPlayPause: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onOpenPlayer: () -> Unit,
    onGrantAccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    BoxWithConstraints(modifier.driveCard()) {
        val density = LocalDensity.current
        val w = maxWidth
        val h = maxHeight
        val pad = (h * 0.12f).coerceIn(12.dp, 24.dp)
        val compact = h < 190.dp || w < 420.dp
        val tiny = h < 140.dp
        val artSize = min(136.dp, h - pad * 2).coerceAtMost(w * 0.3f).coerceAtLeast(52.dp)
        val playSize = (h * 0.34f).coerceIn(48.dp, 64.dp)
        val titleSize = with(density) { (h * 0.13f).coerceIn(17.dp, 28.dp).toSp() }
        val artistSize = with(density) { (h * 0.09f).coerceIn(13.dp, 19.dp).toSp() }

        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(pad),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AlbumArt(info, artSize, onOpenPlayer)
            Spacer(Modifier.width(pad))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Título, artista e identificação do YouTube Music
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = info.title ?: "Nada tocando",
                            style = DriveType.musicTitle.copy(fontSize = titleSize),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (!tiny) {
                            Text(
                                text = when {
                                    info.title == null -> "Toque em ▶ para abrir o YouTube Music"
                                    else -> info.artist ?: ""
                                },
                                style = DriveType.musicArtist.copy(fontSize = artistSize),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                    PlayerBadge(appIcon, onOpenPlayer)
                }

                // Progresso
                Column {
                    MusicProgress(info, showTimes = !compact)
                }

                // Controles
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    DriveIconButton(onClick = onPrevious, size = 52.dp, contentDescription = "Anterior") {
                        Icon(painterResource(R.drawable.ic_prev), null, tint = TextPrimary, modifier = Modifier.size(30.dp))
                    }
                    DriveIconButton(
                        onClick = onPlayPause,
                        size = playSize,
                        background = PlayButtonSurface,
                        contentDescription = "Reproduzir ou pausar",
                        modifier = Modifier.shadow(4.dp, CircleShape)
                    ) {
                        Icon(
                            painterResource(if (info.playing) R.drawable.ic_pause else R.drawable.ic_play),
                            null,
                            tint = TextPrimary,
                            modifier = Modifier.size(30.dp)
                        )
                    }
                    DriveIconButton(onClick = onNext, size = 52.dp, contentDescription = "Próxima") {
                        Icon(painterResource(R.drawable.ic_next), null, tint = TextPrimary, modifier = Modifier.size(30.dp))
                    }
                }
            }
        }

        if (info.isDemo) DemoChip(Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 64.dp))

        // Sem acesso às notificações não dá para ler/controlar a música
        if (!info.hasAccess && !info.isDemo) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(CardSurface.copy(alpha = 0.96f))
                    .clickable(onClick = onGrantAccess)
                    .padding(pad),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    "Para mostrar e controlar o YouTube Music, permita o acesso às notificações.",
                    style = DriveType.settingsText.copy(color = TextSecondary),
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "Permitir acesso",
                    style = DriveType.settingsText.copy(color = TextPrimary),
                    modifier = Modifier
                        .background(PlayButtonSurface, DriveShapes.bigButton)
                        .padding(horizontal = 22.dp, vertical = 12.dp)
                )
            }
        }
    }
}

@Composable
private fun AlbumArt(info: MediaInfo, size: Dp, onClick: () -> Unit) {
    val bitmap = remember(info.art) { info.art?.asImageBitmap() }
    Box(
        modifier = Modifier
            .size(size)
            .shadow(8.dp, DriveShapes.albumArt, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.3f))
            .clip(DriveShapes.albumArt)
            .background(Brush.linearGradient(listOf(Color(0xFF1C2B3D), Color(0xFF0F1824))))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(bitmap, contentDescription = "Capa do álbum", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Icon(painterResource(R.drawable.ic_music), null, tint = TextSecondary.copy(alpha = 0.6f), modifier = Modifier.size(size * 0.36f))
        }
    }
}

/** Identificação discreta do player (ícone oficial do YouTube Music). */
@Composable
private fun PlayerBadge(icon: ImageBitmap?, onClick: () -> Unit) {
    DriveIconButton(onClick = onClick, size = 48.dp, contentDescription = "Abrir o YouTube Music") {
        if (icon != null) {
            Image(icon, null, modifier = Modifier.size(32.dp).clip(CircleShape))
        } else {
            Box(Modifier.size(28.dp).background(YouTubeRed, CircleShape), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_play), null, tint = Color.White, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun MusicProgress(info: MediaInfo, showTimes: Boolean) {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(info.playing) {
        while (info.playing) {
            now = SystemClock.elapsedRealtime()
            delay(250)
        }
        now = SystemClock.elapsedRealtime()
    }
    val pos = info.positionAt(now)
    val target = if (info.durationMs > 0) pos.toFloat() / info.durationMs else 0f
    val fraction by animateFloatAsState(target, tween(250, easing = LinearEasing), label = "progress")

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(4.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(ProgressBase)
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .clip(RoundedCornerShape(2.dp))
                .background(TextPrimary)
        )
    }
    if (showTimes) {
        Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
            Text(formatTime(pos), style = DriveType.musicTime)
            Spacer(Modifier.weight(1f))
            Text(if (info.durationMs > 0) formatTime(info.durationMs) else "--:--", style = DriveType.musicTime)
        }
    }
}

private fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
}
