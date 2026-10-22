package com.edson.carlauncher.viewmodel

import androidx.lifecycle.ViewModel
import com.edson.carlauncher.data.preferences.SettingsRepository
import com.edson.carlauncher.domain.model.DriveSettings
import kotlinx.coroutines.flow.StateFlow

class SettingsViewModel : ViewModel() {
    val settings: StateFlow<DriveSettings> = SettingsRepository.settings

    fun update(transform: (DriveSettings) -> DriveSettings) = SettingsRepository.update(transform)
}
