package com.edson.carlauncher.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.edson.carlauncher.data.location.GpsReading
import com.edson.carlauncher.data.location.LocationRepository
import com.edson.carlauncher.data.preferences.SettingsRepository
import com.edson.carlauncher.domain.model.DriveSettings
import com.edson.carlauncher.domain.model.SpeedInfo
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlin.math.roundToInt
import kotlin.math.sin

/** Velocidade do GPS (ou de demonstração, claramente marcada) no formato da tela. */
class SpeedViewModel : ViewModel() {

    init {
        LocationRepository.start()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    val speed: StateFlow<SpeedInfo> = SettingsRepository.settings
        .flatMapLatest { s -> if (s.demoMode) demo(s) else LocationRepository.reading.map { toInfo(it, s) } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SpeedInfo())

    private fun toInfo(r: GpsReading, s: DriveSettings): SpeedInfo = SpeedInfo(
        speed = r.kmh?.let { convert(it, s) },
        unit = if (s.useMph) "mph" else "km/h",
        maxScale = if (s.useMph) 100 else 160,
        limit = r.limitKmh?.let { convert(it, s) },
        showLimit = s.showSpeedLimit,
        status = if (r.kmh == null) (r.status ?: "Aguardando GPS") else null,
        isDemo = false
    )

    /** Modo demonstração: velocidade oscilando, sempre identificada na tela. */
    private fun demo(s: DriveSettings) = flow {
        var t = 0.0
        while (true) {
            val kmh = (52 + 34 * sin(t / 7.0)).roundToInt()
            emit(
                SpeedInfo(
                    speed = convert(kmh, s),
                    unit = if (s.useMph) "mph" else "km/h",
                    maxScale = if (s.useMph) 100 else 160,
                    limit = convert(80, s),
                    showLimit = s.showSpeedLimit,
                    status = null,
                    isDemo = true
                )
            )
            t += 1.0
            delay(1_000)
        }
    }

    private fun convert(kmh: Int, s: DriveSettings) = if (s.useMph) (kmh / 1.609f).roundToInt() else kmh
}
