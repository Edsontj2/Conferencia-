package com.edson.carlauncher.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.edson.carlauncher.data.media.MediaRepository
import com.edson.carlauncher.data.preferences.SettingsRepository
import com.edson.carlauncher.domain.model.MediaInfo
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/** Música tocando agora e os controles do player. */
class MusicViewModel(app: Application) : AndroidViewModel(app) {

    init {
        MediaRepository.start(app)
    }

    val media: StateFlow<MediaInfo> = combine(MediaRepository.media, SettingsRepository.settings) { m, s ->
        // No modo demonstração, se nada estiver tocando, mostra uma faixa de exemplo identificada
        if (s.demoMode && m.title == null) DEMO.copy(hasAccess = true) else m
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MediaRepository.media.value)

    fun playPause() = MediaRepository.playPause(getApplication())
    fun previous() = MediaRepository.previous(getApplication())
    fun next() = MediaRepository.next(getApplication())
    fun openPlayer() = MediaRepository.openPlayer(getApplication())
    fun refresh() = MediaRepository.refresh()

    private companion object {
        val DEMO = MediaInfo(
            title = "Faixa de demonstração",
            artist = "Modo demonstração",
            playing = false,
            durationMs = 232_000,
            positionMs = 84_000,
            isDemo = true
        )
    }
}
