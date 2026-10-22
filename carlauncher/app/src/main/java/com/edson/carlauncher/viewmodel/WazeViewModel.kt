package com.edson.carlauncher.viewmodel

import android.app.AppOpsManager
import android.app.Application
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.edson.carlauncher.Launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Estado da divisão de tela com o Waze.
 *  - [popupOpen]: o Waze foi aberto em janela pop-up nos 40% da direita (o painel se comprime);
 *  - [nativeSplit]: o próprio painel está no modo de tela dividida do Android.
 *
 * O Android não avisa outro app quando o pop-up do Waze fecha. Se o "acesso ao uso" estiver
 * liberado, o app consulta os eventos públicos de uso (UsageStatsManager) e volta à tela cheia
 * sozinho; senão, o usuário volta pelo botão "Tela cheia".
 */
class WazeViewModel(app: Application) : AndroidViewModel(app) {

    private val _popupOpen = MutableStateFlow(false)
    val popupOpen: StateFlow<Boolean> = _popupOpen.asStateFlow()

    private val _nativeSplit = MutableStateFlow(false)
    val nativeSplit: StateFlow<Boolean> = _nativeSplit.asStateFlow()

    private var launchedAt = 0L
    private var monitor: Job? = null

    fun setPopupOpen(open: Boolean) {
        _popupOpen.value = open
        monitor?.cancel()
        if (open) startMonitor()
    }

    fun markLaunched() {
        launchedAt = System.currentTimeMillis()
    }

    fun setNativeSplit(value: Boolean) {
        _nativeSplit.value = value
        if (value) setPopupOpen(false)
    }

    private fun startMonitor() {
        monitor = viewModelScope.launch {
            delay(4_000)
            while (isActive && _popupOpen.value) {
                if (wazeWasClosed()) {
                    _popupOpen.value = false
                    break
                }
                delay(2_000)
            }
        }
    }

    private fun wazeWasClosed(): Boolean {
        val ctx = getApplication<Application>()
        if (!hasUsageAccess(ctx) || launchedAt == 0L) return false
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = usm.queryEvents(launchedAt, System.currentTimeMillis())
        val e = UsageEvents.Event()
        var last = -1
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.packageName == Launch.WAZE) last = e.eventType
        }
        val closed = if (Build.VERSION.SDK_INT >= 29) UsageEvents.Event.ACTIVITY_STOPPED else UsageEvents.Event.MOVE_TO_BACKGROUND
        return last == closed
    }

    companion object {
        fun hasUsageAccess(ctx: Context): Boolean {
            val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= 29) {
                ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
            } else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
            }
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
