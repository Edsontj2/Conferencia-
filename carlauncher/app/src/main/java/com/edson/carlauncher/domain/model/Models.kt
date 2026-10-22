package com.edson.carlauncher.domain.model

import android.graphics.Bitmap

/** Como abrir o Waze ao lado do painel. */
enum class WazeOpenMode(val label: String, val description: String) {
    AUTO("Automático", "Janela pop-up se o celular permitir; senão, tela dividida do Android"),
    POPUP("Janela pop-up à direita", "Waze numa janela encaixada nos 40% da direita (Samsung)"),
    NATIVE_SPLIT("Tela dividida do Android", "Usa o modo de tela dividida do sistema, quando disponível"),
    FULLSCREEN_PANEL("Tela cheia + painel", "Waze em tela cheia com o painel de música por cima")
}

data class DriveSettings(
    val demoMode: Boolean = false,
    val showSpeedLimit: Boolean = true,
    val useMph: Boolean = false,
    /** 0 = baixa, 1 = média, 2 = alta. */
    val smoothing: Int = 1,
    val preferYouTubeMusic: Boolean = true,
    val wazeMode: WazeOpenMode = WazeOpenMode.AUTO,
    val keepScreenOn: Boolean = true,
    val immersive: Boolean = true,
    val wakeOnMove: Boolean = true,
    val wakeOnPower: Boolean = true,
    val openWazeOnWake: Boolean = false
)

/** O que o velocímetro mostra. [speed] nulo = sem leitura de GPS. */
data class SpeedInfo(
    val speed: Int? = null,
    val unit: String = "km/h",
    val maxScale: Int = 160,
    val limit: Int? = null,
    val showLimit: Boolean = true,
    val status: String? = "Aguardando GPS",
    val isDemo: Boolean = false
)

data class MediaInfo(
    val hasAccess: Boolean = false,
    val title: String? = null,
    val artist: String? = null,
    val art: Bitmap? = null,
    val playing: Boolean = false,
    val durationMs: Long = 0L,
    /** Posição informada pela sessão e o instante (elapsedRealtime) em que foi informada. */
    val positionMs: Long = 0L,
    val positionUpdatedAt: Long = 0L,
    val playbackSpeed: Float = 1f,
    val packageName: String? = null,
    val isDemo: Boolean = false
) {
    fun positionAt(nowElapsed: Long): Long {
        var pos = positionMs
        if (playing && positionUpdatedAt > 0) pos += ((nowElapsed - positionUpdatedAt) * playbackSpeed).toLong()
        return if (durationMs > 0) pos.coerceIn(0L, durationMs) else pos.coerceAtLeast(0L)
    }
}
