package com.edson.carlauncher.ui.screens

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.edson.carlauncher.CarService
import com.edson.carlauncher.Launch
import com.edson.carlauncher.MediaHub
import com.edson.carlauncher.R
import com.edson.carlauncher.domain.model.DriveSettings
import com.edson.carlauncher.domain.model.MediaInfo
import com.edson.carlauncher.domain.model.WazeOpenMode
import com.edson.carlauncher.ui.components.DriveIconButton
import com.edson.carlauncher.ui.components.driveCard
import com.edson.carlauncher.ui.theme.AccentBlue
import com.edson.carlauncher.ui.theme.AlertRed
import com.edson.carlauncher.ui.theme.CardBorder
import com.edson.carlauncher.ui.theme.CardSurface
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.SidebarIconSurface
import com.edson.carlauncher.ui.theme.Space
import com.edson.carlauncher.ui.theme.SpeedGreen
import com.edson.carlauncher.ui.theme.TextMuted
import com.edson.carlauncher.ui.theme.TextPrimary
import com.edson.carlauncher.ui.theme.TextSecondary
import com.edson.carlauncher.viewmodel.SettingsViewModel
import com.edson.carlauncher.viewmodel.WazeViewModel

private class Choice(val title: String, val options: List<String>, val selected: Int, val onSelect: (Int) -> Unit)

@Composable
fun SettingsScreen(
    vm: SettingsViewModel,
    media: MediaInfo,
    onBack: () -> Unit,
    onRequestLocation: () -> Unit
) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val tick = rememberResumeTick()
    val status = remember(tick) { PermissionStatus.read(ctx) }
    var choice by remember { mutableStateOf<Choice?>(null) }

    fun set(transform: (DriveSettings) -> DriveSettings) = vm.update(transform)

    Column(
        Modifier
            .fillMaxSize()
            .driveBackground()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = Space.outer, vertical = Space.LG)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DriveIconButton(onClick = onBack, size = 52.dp, background = SidebarIconSurface, contentDescription = "Voltar") {
                Icon(painterResource(R.drawable.ic_back), null, tint = TextPrimary, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(Space.LG))
            Text("Ajustes", style = DriveType.settingsTitle.copy(fontSize = DriveType.settingsTitle.fontSize * 1.2f))
        }
        Spacer(Modifier.height(Space.LG))

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(Space.LG),
            contentPadding = PaddingValues(bottom = Space.XXL)
        ) {
            item {
                Section("Velocímetro") {
                    SwitchRow("Modo demonstração", "Mostra dados de exemplo, sempre identificados como demonstração", s.demoMode) { v -> set { it.copy(demoMode = v) } }
                    ActionRow("Permissão de GPS", if (status.location) "Liberada" else "Necessária para o velocímetro", status.location, "Permitir", onRequestLocation)
                    SwitchRow("Exibir limite de velocidade", "Limite da via pelo OpenStreetMap; sem dado, mostra \"--\"", s.showSpeedLimit) { v -> set { it.copy(showSpeedLimit = v) } }
                    ValueRow("Unidade", if (s.useMph) "mph" else "km/h") {
                        choice = Choice("Unidade", listOf("km/h", "mph"), if (s.useMph) 1 else 0) { i -> set { it.copy(useMph = i == 1) } }
                    }
                    val smoothing = listOf("Baixa (responde rápido)", "Média", "Alta (mais estável)")
                    ValueRow("Suavização do GPS", smoothing[s.smoothing]) {
                        choice = Choice("Suavização do GPS", smoothing, s.smoothing) { i -> set { it.copy(smoothing = i) } }
                    }
                }
            }
            item {
                Section("Música") {
                    val players = listOf("YouTube Music", "Qualquer player tocando")
                    ValueRow("Player padrão", players[if (s.preferYouTubeMusic) 0 else 1]) {
                        choice = Choice("Player padrão", players, if (s.preferYouTubeMusic) 0 else 1) { i -> set { it.copy(preferYouTubeMusic = i == 0) } }
                    }
                    val ytState = when {
                        !status.ytMusicInstalled -> "Não instalado"
                        !status.notificationAccess -> "Instalado · sem acesso às notificações"
                        media.title != null && media.packageName == Launch.YT_MUSIC -> "Tocando: ${media.title}"
                        else -> "Instalado · pronto"
                    }
                    ActionRow(
                        "YouTube Music",
                        ytState,
                        status.ytMusicInstalled && status.notificationAccess,
                        if (!status.ytMusicInstalled) "Instalar" else "Abrir"
                    ) {
                        if (!status.ytMusicInstalled) Launch.openStore(ctx, Launch.YT_MUSIC) else Launch.openYtMusic(ctx)
                    }
                    ActionRow(
                        "Acesso às notificações",
                        "Necessário para ler e controlar a música (MediaSession)",
                        status.notificationAccess,
                        "Permitir"
                    ) { Launch.openNotificationAccess(ctx) }
                }
            }
            item {
                Section("Waze") {
                    val modes = WazeOpenMode.entries
                    ValueRow("Como abrir o Waze", s.wazeMode.label) {
                        choice = Choice("Como abrir o Waze", modes.map { "${it.label} — ${it.description}" }, s.wazeMode.ordinal) { i ->
                            set { it.copy(wazeMode = modes[i]) }
                        }
                    }
                    ActionRow(
                        "Detectar quando o Waze fecha",
                        "Acesso ao uso: volta o painel para tela cheia sozinho",
                        status.usageAccess,
                        "Permitir"
                    ) { Launch.safeStart(ctx, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
                    ActionRow(
                        "Aparecer sobre outros apps",
                        "Para o modo \"Tela cheia + painel\" e para acender a tela sozinho",
                        status.overlay,
                        "Permitir"
                    ) { Launch.openOverlaySettings(ctx) }
                    SwitchRow("Abrir o Waze ao acender a tela", "Quando a tela liga porque o carro andou", s.openWazeOnWake) { v -> set { it.copy(openWazeOnWake = v) } }
                }
            }
            item {
                Section("Tela") {
                    SwitchRow("Manter a tela ligada", "Durante o uso e enquanto o carro anda ou carrega", s.keepScreenOn) { v -> set { it.copy(keepScreenOn = v) } }
                    SwitchRow("Modo imersivo", "Esconde as barras do Android", s.immersive) { v -> set { it.copy(immersive = v) } }
                    SwitchRow("Acender quando o carro andar", "Acima de ~12 km/h", s.wakeOnMove) { v -> set { it.copy(wakeOnMove = v) } }
                    SwitchRow("Acender ao ligar no carregador", null, s.wakeOnPower) { v -> set { it.copy(wakeOnPower = v) } }
                    ActionRow("Tela inicial do celular", if (status.isHome) "DriveOS é a tela inicial" else "Defina o DriveOS como tela inicial", status.isHome, "Definir") {
                        if (!Launch.safeStart(ctx, Intent(Settings.ACTION_HOME_SETTINGS))) Launch.safeStart(ctx, Intent(Settings.ACTION_SETTINGS))
                    }
                    ActionRow("Configurações restritas (Android 13+)", "Se o acesso às notificações aparecer bloqueado: ⋮ → Permitir configurações restritas", null, "Abrir") {
                        Launch.openAppDetails(ctx, ctx.packageName)
                    }
                }
            }
            item {
                Section("Sobre") {
                    InfoRow("Limites", "O Android não permite colocar a tela do Waze dentro de outro app. O DriveOS abre o Waze em janela ou na tela dividida do sistema.")
                    InfoRow("Limite de velocidade", "Dados do OpenStreetMap (colaborativos). Nem todas as vias têm limite cadastrado.")
                    InfoRow("Fonte", "Inter — SIL Open Font License 1.1")
                }
            }
        }
    }

    choice?.let { c ->
        AlertDialog(
            onDismissRequest = { choice = null },
            containerColor = CardSurface,
            title = { Text(c.title, style = DriveType.settingsTitle) },
            text = {
                Column {
                    c.options.forEachIndexed { i, label ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    c.onSelect(i)
                                    choice = null
                                }
                                .padding(vertical = Space.SM),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = i == c.selected,
                                onClick = null,
                                colors = RadioButtonDefaults.colors(selectedColor = AccentBlue, unselectedColor = TextSecondary)
                            )
                            Spacer(Modifier.width(Space.MD))
                            Text(label, style = DriveType.settingsText)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { choice = null }) { Text("Fechar", color = AccentBlue) }
            }
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .driveCard()
            .padding(vertical = Space.MD)
    ) {
        Text(
            title.uppercase(),
            style = DriveType.caption.copy(color = AccentBlue),
            modifier = Modifier.padding(horizontal = Space.XXL, vertical = Space.SM)
        )
        content()
    }
}

@Composable
private fun RowBase(title: String, subtitle: String?, onClick: (() -> Unit)?, trailing: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = Space.XXL, vertical = Space.MD),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = DriveType.settingsText)
            if (subtitle != null) Text(subtitle, style = DriveType.settingsText.copy(fontSize = DriveType.settingsText.fontSize * 0.85f, color = TextSecondary))
        }
        Spacer(Modifier.width(Space.LG))
        trailing()
    }
    HorizontalDivider(color = CardBorder.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = Space.XXL))
}

@Composable
private fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    RowBase(title, subtitle, onClick = { onChange(!checked) }) {
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = TextPrimary,
                checkedTrackColor = AccentBlue,
                uncheckedThumbColor = TextSecondary,
                uncheckedTrackColor = SidebarIconSurface,
                uncheckedBorderColor = CardBorder
            )
        )
    }
}

@Composable
private fun ValueRow(title: String, value: String, onClick: () -> Unit) {
    RowBase(title, null, onClick) {
        Text(value, style = DriveType.settingsText.copy(color = AccentBlue))
    }
}

@Composable
private fun ActionRow(title: String, subtitle: String, ok: Boolean?, action: String, onClick: () -> Unit) {
    RowBase(title, subtitle, onClick) {
        when (ok) {
            true -> Text("✓ Ok", style = DriveType.settingsText.copy(color = SpeedGreen))
            else -> Text(
                action,
                style = DriveType.settingsText.copy(color = if (ok == false) AlertRed.copy(alpha = 0.9f) else AccentBlue),
                modifier = Modifier
                    .padding(start = Space.SM)
            )
        }
    }
}

@Composable
private fun InfoRow(title: String, text: String) {
    Column(Modifier.padding(horizontal = Space.XXL, vertical = Space.SM)) {
        Text(title, style = DriveType.settingsText.copy(color = TextPrimary))
        Text(text, style = DriveType.settingsText.copy(fontSize = DriveType.settingsText.fontSize * 0.85f, color = TextMuted))
    }
}

/** Situação das permissões, relida sempre que a tela volta ao primeiro plano. */
private data class PermissionStatus(
    val location: Boolean,
    val notificationAccess: Boolean,
    val overlay: Boolean,
    val usageAccess: Boolean,
    val ytMusicInstalled: Boolean,
    val isHome: Boolean
) {
    companion object {
        fun read(ctx: Context): PermissionStatus {
            val pm = ctx.packageManager
            val home = try {
                pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
                    ?.activityInfo?.packageName == ctx.packageName
            } catch (_: Exception) {
                false
            }
            return PermissionStatus(
                location = CarService.hasLocationPermission(ctx),
                notificationAccess = MediaHub.hasAccess(ctx),
                overlay = Launch.canOverlay(ctx),
                usageAccess = WazeViewModel.hasUsageAccess(ctx),
                ytMusicInstalled = pm.getLaunchIntentForPackage(Launch.YT_MUSIC) != null,
                isHome = home
            )
        }
    }
}

@Composable
fun rememberResumeTick(): Int {
    val owner = LocalLifecycleOwner.current
    var tick by remember { mutableIntStateOf(0) }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) tick++
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return tick
}
