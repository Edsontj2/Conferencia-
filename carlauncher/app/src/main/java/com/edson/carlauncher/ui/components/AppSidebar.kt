package com.edson.carlauncher.ui.components

import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import com.edson.carlauncher.Launch
import com.edson.carlauncher.R
import com.edson.carlauncher.ui.theme.AccentBlue
import com.edson.carlauncher.ui.theme.CardBorder
import com.edson.carlauncher.ui.theme.DriveShapes
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.SidebarActiveSurface
import com.edson.carlauncher.ui.theme.SidebarIconSurface
import com.edson.carlauncher.ui.theme.SidebarSurface
import com.edson.carlauncher.ui.theme.TextPrimary
import com.edson.carlauncher.ui.theme.TextSecondary
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class SidebarItem { DASHBOARD, WAZE }

@Composable
fun AppSidebar(
    active: SidebarItem,
    onWaze: () -> Unit,
    onMusic: () -> Unit,
    onPhone: () -> Unit,
    onDashboard: () -> Unit,
    onApps: () -> Unit,
    modifier: Modifier = Modifier
) {
    val wazeIcon = rememberAppIcon(Launch.WAZE)
    val musicIcon = rememberAppIcon(Launch.YT_MUSIC)
    val phoneIcon = rememberDialerIcon()

    BoxWithConstraints(
        modifier = modifier
            .width(76.dp)
            .fillMaxHeight()
            .shadow(14.dp, DriveShapes.sidebar, ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
            .clip(DriveShapes.sidebar)
            .background(SidebarSurface)
            .border(1.dp, CardBorder.copy(alpha = 0.5f), DriveShapes.sidebar)
    ) {
        // Tamanho dos botões conforme a altura disponível (mínimo de 48dp de toque)
        val button = ((maxHeight - 120.dp) / 5.6f).coerceIn(48.dp, 56.dp)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            ClockText()
            ConnectivityRow(Modifier.padding(top = 2.dp))

            Spacer(Modifier.weight(1f))

            SidebarSlot(active = active == SidebarItem.WAZE) {
                AppTile(wazeIcon, R.drawable.ic_navigation, button, onWaze, "Waze")
            }
            Spacer(Modifier.height(10.dp))
            SidebarSlot(active = false) {
                AppTile(musicIcon, R.drawable.ic_music, button, onMusic, "YouTube Music")
            }
            Spacer(Modifier.height(10.dp))
            SidebarSlot(active = false) {
                AppTile(phoneIcon, R.drawable.ic_phone, button, onPhone, "Telefone")
            }
            Spacer(Modifier.height(10.dp))
            SidebarSlot(active = active == SidebarItem.DASHBOARD) {
                VectorTile(R.drawable.ic_car, button, active == SidebarItem.DASHBOARD, onDashboard, "Painel")
            }

            Spacer(Modifier.weight(1f))

            VectorTile(R.drawable.ic_grid, button, false, onApps, "Aplicativos")
        }
    }
}

/** Indicador discreto de seleção à esquerda do ícone. */
@Composable
private fun SidebarSlot(active: Boolean, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        if (active) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = 3.dp)
                    .size(width = 3.dp, height = 22.dp)
                    .background(AccentBlue, RoundedCornerShape(2.dp))
            )
        }
        content()
    }
}

@Composable
private fun AppTile(icon: ImageBitmap?, fallback: Int, size: Dp, onClick: () -> Unit, label: String) {
    DriveIconButton(
        onClick = onClick,
        size = size,
        background = if (icon == null) SidebarIconSurface else Color.Transparent,
        shape = DriveShapes.sidebarIcon,
        contentDescription = label
    ) {
        if (icon != null) {
            Image(icon, label, modifier = Modifier.fillMaxSize().clip(DriveShapes.sidebarIcon))
        } else {
            Icon(painterResource(fallback), label, tint = TextPrimary, modifier = Modifier.size(26.dp))
        }
    }
}

@Composable
private fun VectorTile(icon: Int, size: Dp, active: Boolean, onClick: () -> Unit, label: String) {
    DriveIconButton(
        onClick = onClick,
        size = size,
        background = if (active) SidebarActiveSurface else SidebarIconSurface,
        shape = DriveShapes.sidebarIcon,
        contentDescription = label
    ) {
        Icon(painterResource(icon), label, tint = if (active) AccentBlue else TextPrimary, modifier = Modifier.size(26.dp))
    }
}

@Composable
private fun ClockText() {
    var time by remember { mutableStateOf(nowText()) }
    LaunchedEffect(Unit) {
        while (true) {
            time = nowText()
            delay(60_000 - System.currentTimeMillis() % 60_000 + 50)
        }
    }
    Text(time, style = DriveType.sidebarTime.copy(fontSize = DriveType.sidebarTime.fontSize * 0.86f))
}

private fun nowText() = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

/** Rede atual (Wi-Fi / dados móveis) e Bluetooth ligado. */
@Composable
private fun ConnectivityRow(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var label by remember { mutableStateOf(networkLabel(context)) }
    var bluetooth by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                label = labelFor(caps)
            }

            override fun onLost(network: Network) {
                label = networkLabel(context)
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
        } catch (_: Exception) {
        }
        onDispose {
            try {
                cm.unregisterNetworkCallback(callback)
            } catch (_: Exception) {
            }
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            bluetooth = try {
                @Suppress("DEPRECATION")
                BluetoothAdapter.getDefaultAdapter()?.isEnabled == true
            } catch (_: Exception) {
                false
            }
            delay(10_000)
        }
    }

    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Icon(
            painterResource(if (label == "Wi-Fi") R.drawable.ic_wifi else R.drawable.ic_signal),
            null,
            tint = TextSecondary,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(3.dp))
        Text(label, style = DriveType.sidebarNetwork, maxLines = 1)
        if (bluetooth) {
            Spacer(Modifier.width(2.dp))
            Icon(painterResource(R.drawable.ic_bluetooth), "Bluetooth ligado", tint = TextSecondary, modifier = Modifier.size(12.dp))
        }
    }
}

private fun networkLabel(context: Context): String {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val caps = try {
        cm.getNetworkCapabilities(cm.activeNetwork)
    } catch (_: Exception) {
        null
    }
    return caps?.let { labelFor(it) } ?: "Offline"
}

private fun labelFor(caps: NetworkCapabilities) = when {
    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Dados"
    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Rede"
    else -> "Online"
}
