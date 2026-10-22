package com.edson.carlauncher

import android.graphics.Bitmap
import android.media.AudioManager
import android.view.View
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView

/** Liga os controles de música de um layout (tela inicial ou painel sobre o Waze) ao MediaHub. */
class MediaViews(root: View) {
    private val ctx = root.context
    private val art: ImageView? = root.findViewById(R.id.art)
    private val hint: TextView? = root.findViewById(R.id.mediaHint)
    private val title: TextView? = root.findViewById(R.id.trackTitle)
    private val artist: TextView? = root.findViewById(R.id.trackArtist)
    private val play: ImageButton? = root.findViewById(R.id.btnPlay)
    private val progress: ProgressBar? = root.findViewById(R.id.progress)
    private val timeCur: TextView? = root.findViewById(R.id.timeCur)
    private val timeTotal: TextView? = root.findViewById(R.id.timeTotal)
    private var shownArt: Bitmap? = null
    private var artInitialized = false

    init {
        art?.clipToOutline = true
        title?.isSelected = true // ativa o letreiro (marquee)
        art?.setOnClickListener { Launch.openYtMusic(ctx) }
        hint?.setOnClickListener { Launch.openNotificationAccess(ctx) }
        play?.setOnClickListener { MediaHub.playPause(ctx) }
        root.findViewById<View>(R.id.btnPrev)?.setOnClickListener { MediaHub.previous(ctx) }
        root.findViewById<View>(R.id.btnNext)?.setOnClickListener { MediaHub.next(ctx) }
        root.findViewById<View>(R.id.btnVolDown)?.setOnClickListener { MediaHub.volume(ctx, AudioManager.ADJUST_LOWER) }
        root.findViewById<View>(R.id.btnVolUp)?.setOnClickListener { MediaHub.volume(ctx, AudioManager.ADJUST_RAISE) }
        root.findViewById<View>(R.id.btnVol)?.setOnClickListener { MediaHub.volume(ctx, AudioManager.ADJUST_SAME) }
    }

    fun update() {
        hint?.visibility = if (MediaHub.connected) View.GONE else View.VISIBLE

        val t = MediaHub.title()
        if (t == null) {
            title?.text = "Nenhuma música"
            artist?.text = "Toque ▶ para abrir o YouTube Music"
        } else {
            if (title?.text?.toString() != t) title?.text = t
            artist?.text = MediaHub.artist() ?: ""
        }

        val bmp = MediaHub.art()
        if (!artInitialized || bmp !== shownArt) {
            artInitialized = true
            shownArt = bmp
            if (bmp != null) {
                art?.setImageBitmap(bmp)
                art?.scaleType = ImageView.ScaleType.CENTER_CROP
                art?.clearColorFilter()
            } else {
                art?.setImageResource(R.drawable.ic_music)
                art?.scaleType = ImageView.ScaleType.CENTER
                art?.setColorFilter(0x88FFFFFF.toInt())
            }
        }

        play?.setImageResource(if (MediaHub.isPlaying()) R.drawable.ic_pause else R.drawable.ic_play)
        tick()
    }

    /** Atualiza a barra de progresso (chamar a cada segundo). */
    fun tick() {
        val duration = MediaHub.durationMs()
        val pos = MediaHub.positionMs()
        if (duration <= 0) {
            progress?.progress = 0
            timeCur?.text = MediaHub.formatTime(pos)
            timeTotal?.text = "0:00"
            return
        }
        progress?.progress = (pos * 1000 / duration).toInt()
        timeCur?.text = MediaHub.formatTime(pos)
        timeTotal?.text = MediaHub.formatTime(duration)
    }
}
