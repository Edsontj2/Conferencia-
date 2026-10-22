package com.edson.carlauncher.data.location

import com.edson.carlauncher.SpeedLimit
import com.edson.carlauncher.SpeedState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Leitura atual do GPS (vinda do CarService) e o limite da via (OpenStreetMap). */
data class GpsReading(
    val kmh: Int? = null,
    val status: String? = "Aguardando GPS",
    val limitKmh: Int? = null
)

object LocationRepository {
    private val _reading = MutableStateFlow(GpsReading())
    val reading: StateFlow<GpsReading> = _reading.asStateFlow()

    private val update: () -> Unit = {
        val status = SpeedState.status?.let { if (it.startsWith("Procurando")) "Aguardando GPS" else it }
        _reading.value = GpsReading(
            kmh = if (SpeedState.hasFix && status == null) SpeedState.kmh else null,
            status = status,
            limitKmh = SpeedLimit.limit
        )
    }

    init {
        SpeedState.addListener(update)
        SpeedLimit.addListener(update)
        update()
    }

    /** Garante que o objeto foi criado (e os ouvintes registrados). */
    fun start() = Unit
}
