package com.edson.carlauncher.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.edson.carlauncher.MediaHub
import com.edson.carlauncher.domain.model.DriveSettings
import com.edson.carlauncher.domain.model.WazeOpenMode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

private val Context.driveDataStore: DataStore<Preferences> by preferencesDataStore(name = "driveos_settings")

/** Configurações do app (DataStore), disponíveis como StateFlow para a tela e para o serviço. */
object SettingsRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _settings = MutableStateFlow(DriveSettings())
    val settings: StateFlow<DriveSettings> = _settings.asStateFlow()
    val current: DriveSettings get() = _settings.value

    private var store: DataStore<Preferences>? = null

    private object Keys {
        val demo = booleanPreferencesKey("demo_mode")
        val showLimit = booleanPreferencesKey("show_speed_limit")
        val mph = booleanPreferencesKey("use_mph")
        val smoothing = intPreferencesKey("smoothing")
        val preferYt = booleanPreferencesKey("prefer_youtube_music")
        val wazeMode = stringPreferencesKey("waze_mode")
        val keepOn = booleanPreferencesKey("keep_screen_on")
        val immersive = booleanPreferencesKey("immersive")
        val wakeMove = booleanPreferencesKey("wake_on_move")
        val wakePower = booleanPreferencesKey("wake_on_power")
        val wazeOnWake = booleanPreferencesKey("open_waze_on_wake")
    }

    fun init(context: Context) {
        if (store != null) return
        val ds = context.applicationContext.driveDataStore
        store = ds
        scope.launch {
            ds.data.catch { emit(emptyPreferences()) }.collect { p ->
                val d = DriveSettings()
                val s = DriveSettings(
                    demoMode = p[Keys.demo] ?: d.demoMode,
                    showSpeedLimit = p[Keys.showLimit] ?: d.showSpeedLimit,
                    useMph = p[Keys.mph] ?: d.useMph,
                    smoothing = (p[Keys.smoothing] ?: d.smoothing).coerceIn(0, 2),
                    preferYouTubeMusic = p[Keys.preferYt] ?: d.preferYouTubeMusic,
                    wazeMode = p[Keys.wazeMode]?.let { runCatching { WazeOpenMode.valueOf(it) }.getOrNull() } ?: d.wazeMode,
                    keepScreenOn = p[Keys.keepOn] ?: d.keepScreenOn,
                    immersive = p[Keys.immersive] ?: d.immersive,
                    wakeOnMove = p[Keys.wakeMove] ?: d.wakeOnMove,
                    wakeOnPower = p[Keys.wakePower] ?: d.wakeOnPower,
                    openWazeOnWake = p[Keys.wazeOnWake] ?: d.openWazeOnWake
                )
                _settings.value = s
                MediaHub.preferYouTubeMusic = s.preferYouTubeMusic
            }
        }
    }

    fun update(transform: (DriveSettings) -> DriveSettings) {
        val ds = store ?: return
        val s = transform(current)
        _settings.value = s
        MediaHub.preferYouTubeMusic = s.preferYouTubeMusic
        scope.launch {
            ds.edit { p ->
                p[Keys.demo] = s.demoMode
                p[Keys.showLimit] = s.showSpeedLimit
                p[Keys.mph] = s.useMph
                p[Keys.smoothing] = s.smoothing
                p[Keys.preferYt] = s.preferYouTubeMusic
                p[Keys.wazeMode] = s.wazeMode.name
                p[Keys.keepOn] = s.keepScreenOn
                p[Keys.immersive] = s.immersive
                p[Keys.wakeMove] = s.wakeOnMove
                p[Keys.wakePower] = s.wakeOnPower
                p[Keys.wazeOnWake] = s.openWazeOnWake
            }
        }
    }
}
