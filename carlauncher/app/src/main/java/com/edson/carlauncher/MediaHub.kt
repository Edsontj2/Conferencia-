package com.edson.carlauncher

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent

/**
 * Música tocando agora (de preferência o YouTube Music), compartilhada entre a tela
 * inicial e o painel que fica por cima do Waze.
 */
object MediaHub {
    var controller: MediaController? = null
        private set
    var connected = false
        private set

    private val handler = Handler(Looper.getMainLooper())
    private val listeners = LinkedHashSet<() -> Unit>()
    private var appCtx: Context? = null

    fun subscribe(ctx: Context, l: () -> Unit) {
        appCtx = ctx.applicationContext
        listeners.add(l)
        connect()
        l()
    }

    fun unsubscribe(l: () -> Unit) {
        listeners.remove(l)
        if (listeners.isEmpty()) disconnect()
    }

    fun hasAccess(ctx: Context): Boolean {
        val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return flat.split(":").any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
    }

    /** Conecta às sessões de mídia (pode ser chamado de novo depois de dar a permissão). */
    fun connect() {
        val ctx = appCtx ?: return
        if (connected) return
        if (!hasAccess(ctx)) {
            notifyListeners()
            return
        }
        val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        val cn = ComponentName(ctx, MediaListenerService::class.java)
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, cn, handler)
            connected = true
            pick(msm.getActiveSessions(cn))
        } catch (e: SecurityException) {
            connected = false
            notifyListeners()
        }
    }

    private fun disconnect() {
        val ctx = appCtx ?: return
        if (connected) {
            try {
                val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
                msm.removeOnActiveSessionsChangedListener(sessionsListener)
            } catch (_: Exception) {
            }
        }
        connected = false
        setController(null)
    }

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list ->
        pick(list ?: emptyList())
    }

    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = notifyListeners()
        override fun onMetadataChanged(metadata: MediaMetadata?) = notifyListeners()
        override fun onSessionDestroyed() {
            setController(null)
        }
    }

    private fun pick(list: List<MediaController>) {
        val best = list.firstOrNull { it.packageName == Launch.YT_MUSIC && isPlaying(it) }
            ?: list.firstOrNull { isPlaying(it) }
            ?: list.firstOrNull { it.packageName == Launch.YT_MUSIC }
            ?: list.firstOrNull()
        setController(best)
    }

    private fun setController(c: MediaController?) {
        val current = controller
        if (c == null || current == null || c.sessionToken != current.sessionToken) {
            current?.unregisterCallback(callback)
            controller = c
            c?.registerCallback(callback, handler)
        }
        notifyListeners()
    }

    private fun notifyListeners() = listeners.toList().forEach { it() }

    // ------------------------------------------------------------ leitura

    fun isPlaying(c: MediaController? = controller): Boolean {
        val s = c?.playbackState?.state ?: return false
        return s == PlaybackState.STATE_PLAYING || s == PlaybackState.STATE_BUFFERING
    }

    fun title(): String? {
        val md = controller?.metadata ?: return null
        return (md.getString(MediaMetadata.METADATA_KEY_TITLE)
            ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE))?.takeIf { it.isNotBlank() }
    }

    fun artist(): String? {
        val md = controller?.metadata ?: return null
        return md.getString(MediaMetadata.METADATA_KEY_ARTIST)
            ?: md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
            ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
    }

    fun art(): Bitmap? {
        val md = controller?.metadata ?: return null
        return md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
    }

    fun durationMs(): Long = controller?.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L

    fun positionMs(): Long {
        val state = controller?.playbackState ?: return 0L
        var pos = state.position
        if (state.state == PlaybackState.STATE_PLAYING) {
            pos += ((SystemClock.elapsedRealtime() - state.lastPositionUpdateTime) * state.playbackSpeed).toLong()
        }
        val d = durationMs()
        return if (d > 0) pos.coerceIn(0L, d) else pos.coerceAtLeast(0L)
    }

    // ------------------------------------------------------------ comandos

    fun playPause(ctx: Context) {
        val c = controller
        when {
            c == null -> {
                // Nada tocando: abre o YouTube Music e manda "play"
                Launch.openYtMusic(ctx)
                handler.postDelayed({ if (controller == null) mediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY) }, 2500)
            }
            isPlaying(c) -> c.transportControls.pause()
            else -> c.transportControls.play()
        }
    }

    fun previous(ctx: Context) {
        controller?.transportControls?.skipToPrevious() ?: mediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
    }

    fun next(ctx: Context) {
        controller?.transportControls?.skipToNext() ?: mediaKey(ctx, KeyEvent.KEYCODE_MEDIA_NEXT)
    }

    fun volume(ctx: Context, direction: Int) {
        val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }

    private fun mediaKey(ctx: Context, code: Int) {
        val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    fun formatTime(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
    }
}
