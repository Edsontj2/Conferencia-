package com.edson.carlauncher

import android.Manifest
import android.app.ActivityOptions
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.edson.carlauncher.data.media.MediaRepository
import com.edson.carlauncher.data.preferences.SettingsRepository
import com.edson.carlauncher.domain.model.DriveSettings
import com.edson.carlauncher.domain.model.WazeOpenMode
import com.edson.carlauncher.ui.screens.AppsScreen
import com.edson.carlauncher.ui.screens.DashboardScreen
import com.edson.carlauncher.ui.screens.SettingsScreen
import com.edson.carlauncher.ui.screens.WAZE_FRACTION
import com.edson.carlauncher.ui.theme.DriveTheme
import com.edson.carlauncher.viewmodel.AppEntry
import com.edson.carlauncher.viewmodel.AppsViewModel
import com.edson.carlauncher.viewmodel.MusicViewModel
import com.edson.carlauncher.viewmodel.SettingsViewModel
import com.edson.carlauncher.viewmodel.SpeedViewModel
import com.edson.carlauncher.viewmodel.WazeViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * DriveOS: tela inicial do carro (launcher). Barra lateral + velocímetro + YouTube Music,
 * e o Waze aberto ao lado (janela pop-up nos 40% da direita ou tela dividida do Android).
 */
class MainActivity : ComponentActivity() {

    private val wazeVm: WazeViewModel by viewModels()

    /** Incrementado quando o botão "home" é apertado com o app aberto: volta ao painel. */
    private val homePressed = MutableStateFlow(0)

    private val locationPermission =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { CarService.start(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SettingsRepository.init(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        allowOverLockScreen()

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                SettingsRepository.settings.collect { applyWindowSettings(it) }
            }
        }

        setContent { DriveTheme { DriveApp() } }

        if (!CarService.hasLocationPermission(this)) requestLocation()
        CarService.start(this)
        wazeVm.setNativeSplit(Build.VERSION.SDK_INT >= 24 && isInMultiWindowMode)
        handleWake(intent)
    }

    override fun onResume() {
        super.onResume()
        // Voltou para o painel: tira o painel flutuante de cima do Waze (modo tela cheia)
        CarService.instance?.hidePanel()
        MediaRepository.refresh()
        CarService.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        homePressed.value++
        handleWake(intent)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyWindowSettings(SettingsRepository.current)
    }

    /** Tela dividida nativa: o Compose se reorganiza sozinho pelo tamanho da janela. */
    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        wazeVm.setNativeSplit(isInMultiWindowMode)
    }

    // ------------------------------------------------------------------ interface

    @Composable
    private fun DriveApp() {
        val nav = rememberNavController()
        val speedVm: SpeedViewModel = viewModel()
        val musicVm: MusicViewModel = viewModel()
        val settingsVm: SettingsViewModel = viewModel()
        val appsVm: AppsViewModel = viewModel()

        val speed by speedVm.speed.collectAsStateWithLifecycle()
        val media by musicVm.media.collectAsStateWithLifecycle()
        val popupOpen by wazeVm.popupOpen.collectAsStateWithLifecycle()
        val nativeSplit by wazeVm.nativeSplit.collectAsStateWithLifecycle()
        val home by homePressed.collectAsStateWithLifecycle()

        LaunchedEffect(home) {
            if (home > 0) nav.popBackStack(ROUTE_DASHBOARD, inclusive = false)
        }

        NavHost(
            navController = nav,
            startDestination = ROUTE_DASHBOARD,
            enterTransition = { fadeIn(tween(250)) },
            exitTransition = { fadeOut(tween(250)) },
            popEnterTransition = { fadeIn(tween(250)) },
            popExitTransition = { fadeOut(tween(250)) }
        ) {
            composable(ROUTE_DASHBOARD) {
                // Somos a tela inicial: o "voltar" só fecha o espaço do Waze
                BackHandler { wazeVm.setPopupOpen(false) }
                DashboardScreen(
                    speed = speed,
                    media = media,
                    wazePopupOpen = popupOpen,
                    nativeSplit = nativeSplit,
                    onOpenWaze = { openWaze(null) },
                    onCloseWazePane = { wazeVm.setPopupOpen(false) },
                    onMusicApp = { musicVm.openPlayer() },
                    onPhone = { openPhone() },
                    onApps = { nav.navigate(ROUTE_APPS) },
                    onPlayPause = { musicVm.playPause() },
                    onPrevious = { musicVm.previous() },
                    onNext = { musicVm.next() },
                    onGrantMediaAccess = { Launch.openNotificationAccess(this@MainActivity) }
                )
            }
            composable(ROUTE_APPS) {
                AppsScreen(
                    vm = appsVm,
                    onBack = { nav.popBackStack() },
                    onSettings = { nav.navigate(ROUTE_SETTINGS) },
                    onLaunch = { launchApp(it) },
                    onDetails = { Launch.openAppDetails(this@MainActivity, it.packageName) }
                )
            }
            composable(ROUTE_SETTINGS) {
                SettingsScreen(
                    vm = settingsVm,
                    media = media,
                    onBack = { nav.popBackStack() },
                    onRequestLocation = { requestLocation() }
                )
            }
        }
    }

    // ------------------------------------------------------------------ Waze

    /**
     * Abre o Waze ao lado do painel, conforme o ajuste "Como abrir o Waze".
     * Um app comum não consegue colocar a interface do Waze dentro da própria tela; por isso o
     * Waze abre na janela pop-up do sistema (exatamente nos 40% da direita) ou na tela dividida.
     */
    private fun openWaze(deepLink: String?) {
        if (Build.VERSION.SDK_INT >= 24 && isInMultiWindowMode) {
            launchWaze(deepLink, adjacent = true)
            return
        }
        val mode = when (SettingsRepository.current.wazeMode) {
            WazeOpenMode.AUTO -> if (freeformSupported()) WazeOpenMode.POPUP else WazeOpenMode.NATIVE_SPLIT
            else -> SettingsRepository.current.wazeMode
        }
        when (mode) {
            WazeOpenMode.POPUP -> {
                // Primeiro o painel se comprime (300 ms), depois o Waze abre no espaço livre
                wazeVm.setPopupOpen(true)
                window.decorView.postDelayed({ launchWaze(deepLink, bounds = wazeBounds()) }, 320)
            }
            WazeOpenMode.NATIVE_SPLIT -> launchWaze(deepLink, adjacent = true)
            WazeOpenMode.FULLSCREEN_PANEL -> startFullscreenWithPanel(deepLink)
            WazeOpenMode.AUTO -> Unit
        }
    }

    private fun launchWaze(deepLink: String?, bounds: Rect? = null, adjacent: Boolean = false) {
        val intent = if (deepLink != null) {
            Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
        } else {
            packageManager.getLaunchIntentForPackage(Launch.WAZE)
        }
        if (intent == null) {
            wazeVm.setPopupOpen(false)
            Launch.openWaze(this, null) // avisa e abre a loja
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (adjacent && Build.VERSION.SDK_INT >= 24) intent.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
        try {
            if (bounds != null && Build.VERSION.SDK_INT >= 24) {
                startActivity(intent, ActivityOptions.makeBasic().setLaunchBounds(bounds).toBundle())
            } else {
                startActivity(intent)
            }
            wazeVm.markLaunched()
        } catch (e: Exception) {
            wazeVm.setPopupOpen(false)
            Launch.openWaze(this, deepLink)
        }
    }

    /** Retângulo (em pixels da tela) do espaço do Waze — o mesmo cálculo do DashboardScreen. */
    private fun wazeBounds(): Rect {
        val decor = window.decorView
        val loc = IntArray(2)
        decor.getLocationOnScreen(loc)
        val insets = ViewCompat.getRootWindowInsets(decor)
            ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val outer = (20 * resources.displayMetrics.density).toInt()
        val left = loc[0] + (insets?.left ?: 0) + outer
        val right = loc[0] + decor.width - (insets?.right ?: 0) - outer
        val top = loc[1] + (insets?.top ?: 0) + outer
        val bottom = loc[1] + decor.height - (insets?.bottom ?: 0) - outer
        val wazeWidth = ((right - left) * WAZE_FRACTION).toInt()
        return Rect(right - wazeWidth, top, right, bottom)
    }

    private fun freeformSupported(): Boolean {
        if (Build.VERSION.SDK_INT < 24) return false
        return packageManager.hasSystemFeature(PackageManager.FEATURE_FREEFORM_WINDOW_MANAGEMENT) ||
                Settings.Global.getInt(contentResolver, "enable_freeform_support", 0) != 0
    }

    /** Waze em tela cheia com o painel de música flutuando à direita (precisa "aparecer sobre apps"). */
    private fun startFullscreenWithPanel(deepLink: String?) {
        if (!Launch.canOverlay(this)) {
            Toast.makeText(this, "Permita \"aparecer sobre outros apps\" para o painel ao lado do Waze", Toast.LENGTH_LONG).show()
            Launch.openOverlaySettings(this)
            return
        }
        if (Launch.openWaze(this, deepLink)) CarService.start(this, CarService.ACTION_SHOW_PANEL)
    }

    // ------------------------------------------------------------------ outros

    private fun openPhone() {
        if (!Launch.safeStart(this, Intent(Intent.ACTION_DIAL))) {
            Toast.makeText(this, "Telefone não encontrado", Toast.LENGTH_SHORT).show()
        }
    }

    private fun launchApp(app: AppEntry) {
        try {
            startActivity(
                Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_LAUNCHER)
                    .setClassName(app.packageName, app.activity)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir", Toast.LENGTH_SHORT).show()
        }
    }

    private fun requestLocation() {
        if (CarService.hasLocationPermission(this)) {
            Toast.makeText(this, "GPS já permitido", Toast.LENGTH_SHORT).show()
            return
        }
        locationPermission.launch(
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        )
    }

    /** Aberto pelo serviço porque o carro começou a andar / ligou no carregador. */
    private fun handleWake(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_WAKE, false) != true) return
        intent.removeExtra(EXTRA_WAKE)
        if (Build.VERSION.SDK_INT >= 26) {
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).requestDismissKeyguard(this, null)
        }
        if (SettingsRepository.current.openWazeOnWake) {
            window.decorView.postDelayed({ openWaze(null) }, 900)
        }
    }

    private fun applyWindowSettings(s: DriveSettings) {
        if (s.keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (s.immersive) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    @Suppress("DEPRECATION")
    private fun allowOverLockScreen() {
        // Deixa o painel aparecer quando a tela acende sozinha
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
    }

    companion object {
        const val EXTRA_WAKE = "wake"
        private const val ROUTE_DASHBOARD = "dashboard"
        private const val ROUTE_APPS = "apps"
        private const val ROUTE_SETTINGS = "settings"
    }
}
