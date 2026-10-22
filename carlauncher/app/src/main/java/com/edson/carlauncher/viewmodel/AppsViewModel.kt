package com.edson.carlauncher.viewmodel

import android.app.Application
import android.content.Intent
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AppEntry(val label: String, val packageName: String, val activity: String, val icon: ImageBitmap)

/** Lista de apps instalados para a gaveta de aplicativos. */
class AppsViewModel(app: Application) : AndroidViewModel(app) {
    private val _apps = MutableStateFlow<List<AppEntry>>(emptyList())
    val apps: StateFlow<List<AppEntry>> = _apps.asStateFlow()

    fun load() {
        viewModelScope.launch(Dispatchers.IO) {
            val ctx = getApplication<Application>()
            val pm = ctx.packageManager
            val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val list = pm.queryIntentActivities(query, 0)
                .filter { it.activityInfo.packageName != ctx.packageName }
                .mapNotNull {
                    try {
                        AppEntry(
                            it.loadLabel(pm).toString(),
                            it.activityInfo.packageName,
                            it.activityInfo.name,
                            it.loadIcon(pm).toBitmap(144, 144).asImageBitmap()
                        )
                    } catch (e: Exception) {
                        null
                    }
                }
                .sortedBy { it.label.lowercase() }
            _apps.value = list
        }
    }
}
