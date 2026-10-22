package com.edson.carlauncher.data.media

import android.content.Context
import com.edson.carlauncher.Launch
import com.edson.carlauncher.MediaHub
import com.edson.carlauncher.domain.model.MediaInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sessão de mídia ativa (MediaSessionManager / MediaController), de preferência o YouTube Music.
 * Precisa do acesso às notificações liberado para o app.
 */
object MediaRepository {
    private val _media = MutableStateFlow(MediaInfo())
    val media: StateFlow<MediaInfo> = _media.asStateFlow()

    private var started = false
    private val listener: () -> Unit = { _media.value = snapshot() }

    fun start(context: Context) {
        if (!started) {
            started = true
            MediaHub.subscribe(context, listener)
        } else {
            refresh()
        }
    }

    /** Tenta conectar de novo (ex.: depois de liberar o acesso às notificações). */
    fun refresh() {
        MediaHub.connect()
        listener()
    }

    fun hasAccess(context: Context) = MediaHub.hasAccess(context)

    fun playPause(context: Context) = MediaHub.playPause(context)
    fun previous(context: Context) = MediaHub.previous(context)
    fun next(context: Context) = MediaHub.next(context)
    fun openPlayer(context: Context) = Launch.openYtMusic(context)

    private fun snapshot(): MediaInfo {
        val c = MediaHub.controller
        val state = c?.playbackState
        return MediaInfo(
            hasAccess = MediaHub.connected,
            title = MediaHub.title(),
            artist = MediaHub.artist(),
            art = MediaHub.art(),
            playing = MediaHub.isPlaying(),
            durationMs = MediaHub.durationMs(),
            positionMs = state?.position ?: 0L,
            positionUpdatedAt = state?.lastPositionUpdateTime ?: 0L,
            playbackSpeed = state?.playbackSpeed ?: 1f,
            packageName = c?.packageName
        )
    }
}
