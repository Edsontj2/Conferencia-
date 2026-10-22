package com.edson.carlauncher

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.TextView

/**
 * Serviço que fica rodando enquanto o painel está em uso:
 *  - lê o GPS (velocímetro) mesmo com a tela apagada;
 *  - acende a tela quando o carro começa a andar ou quando liga no carregador;
 *  - mantém a tela acesa enquanto anda / carrega;
 *  - mostra o painel de música por cima do Waze ("modo carro", estilo Android Auto).
 */
class CarService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var prefs: SharedPreferences
    private lateinit var power: PowerManager

    private var gpsInterval = 0L
    private var lastFix: Location? = null
    private var movingFixes = 0
    private var lastMovingAt = 0L
    private var lastWakeAt = 0L
    private var charging = false
    private var keepAwakeLock: PowerManager.WakeLock? = null

    // ------------------------------------------------------------ ciclo de vida

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)
        power = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!goForeground()) {
            stopSelf()
            return
        }
        instance = this

        val filter = IntentFilter()
        filter.addAction(Intent.ACTION_POWER_CONNECTED)
        filter.addAction(Intent.ACTION_POWER_DISCONNECTED)
        filter.addAction(Intent.ACTION_SCREEN_ON)
        registerReceiver(receiver, filter)
        charging = readCharging()

        startGps(GPS_FAST)
        handler.post(ticker)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (instance !== this) return START_NOT_STICKY
        when (intent?.action) {
            ACTION_SHOW_PANEL -> showPanel()
            ACTION_HIDE_PANEL -> hidePanel()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        handler.removeCallbacksAndMessages(null)
        try {
            unregisterReceiver(receiver)
        } catch (_: Exception) {
        }
        stopGps()
        hidePanel()
        releaseKeepAwake()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (panel != null) applyPanelLayout()
    }

    private fun goForeground(): Boolean {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Painel do Carro", NotificationManager.IMPORTANCE_LOW)
            )
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val piFlags = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), piFlags)
        val notification = builder
            .setSmallIcon(R.drawable.ic_navigation)
            .setContentTitle("Painel do Carro ativo")
            .setContentText("Velocímetro e tela automática ligados")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIF_ID, notification)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    // ------------------------------------------------------------ tique de 1 s

    private var tickCount = 0
    private val ticker = object : Runnable {
        override fun run() {
            tickCount++
            panelMedia?.tick()
            if (tickCount % 5 == 0) {
                checkGpsTimeout()
                updateKeepAwake()
                // Parado e fora do carregador por muito tempo: GPS mais lento para poupar bateria
                val idle = SystemClock.elapsedRealtime() - lastMovingAt > IDLE_SLOW_MS
                startGps(if (!charging && idle && !power.isInteractive) GPS_SLOW else GPS_FAST)
            }
            handler.postDelayed(this, 1000)
        }
    }

    // ------------------------------------------------------------ GPS

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) = onFix(location)
        override fun onProviderEnabled(provider: String) {
            SpeedState.setStatus("Procurando GPS…")
        }
        override fun onProviderDisabled(provider: String) {
            SpeedState.setStatus("GPS desligado")
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        }
    }

    private fun startGps(interval: Long) {
        if (interval == gpsInterval) return
        if (!hasLocationPermission(this)) {
            SpeedState.setStatus("Sem permissão de GPS")
            return
        }
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            lm.removeUpdates(locationListener)
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) SpeedState.setStatus("GPS desligado")
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, locationListener, Looper.getMainLooper())
            gpsInterval = interval
        } catch (e: SecurityException) {
            SpeedState.setStatus("Sem permissão de GPS")
        } catch (e: Exception) {
            SpeedState.setStatus("GPS indisponível")
        }
    }

    private fun stopGps() {
        try {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(locationListener)
        } catch (_: Exception) {
        }
        gpsInterval = 0L
    }

    private fun onFix(loc: Location) {
        val prev = lastFix
        var mps = if (loc.hasSpeed()) {
            loc.speed
        } else if (prev != null && loc.time > prev.time) {
            loc.distanceTo(prev) / ((loc.time - prev.time) / 1000f)
        } else {
            0f
        }
        if (mps < 0.6f) mps = 0f // ignora a "tremedeira" do GPS parado
        lastFix = loc
        val kmh = Math.round(mps * 3.6f)
        SpeedState.setSpeed(kmh)
        SpeedState.setLocation(loc.latitude, loc.longitude, if (loc.hasBearing() && kmh >= 3) loc.bearing else null)

        if (kmh >= MOVING_KMH) {
            movingFixes++
            lastMovingAt = SystemClock.elapsedRealtime()
            // Duas leituras seguidas em movimento evitam acender a tela por erro do GPS
            if (movingFixes >= 2 && prefs.getBoolean(Prefs.WAKE_ON_MOVE, true)) wakeScreen()
        } else {
            movingFixes = 0
        }
        updateKeepAwake()
    }

    private fun checkGpsTimeout() {
        val fix = lastFix ?: return
        val age = SystemClock.elapsedRealtime() - fix.elapsedRealtimeNanos / 1_000_000
        if (age > gpsInterval + 8000) SpeedState.setStatus("Sem sinal de GPS")
    }

    // ------------------------------------------------------------ tela

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_POWER_CONNECTED -> {
                    charging = true
                    if (prefs.getBoolean(Prefs.WAKE_ON_POWER, true)) wakeScreen()
                }
                Intent.ACTION_POWER_DISCONNECTED -> charging = false
            }
            updateKeepAwake()
        }
    }

    private fun readCharging(): Boolean {
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        return (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
    }

    /** Acende a tela e abre o painel (ou o Waze + música, conforme os ajustes). */
    @Suppress("DEPRECATION")
    private fun wakeScreen() {
        if (power.isInteractive) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastWakeAt < 20_000) return
        lastWakeAt = now
        try {
            power.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "carlauncher:wake"
            ).acquire(10_000)
        } catch (_: Exception) {
        }
        val open = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_WAKE, true)
        Launch.safeStart(this, open)
        updateKeepAwake()
    }

    /** Segura a tela acesa enquanto o carro anda ou o celular está no carregador. */
    @Suppress("DEPRECATION")
    private fun updateKeepAwake() {
        val moving = lastMovingAt > 0 && SystemClock.elapsedRealtime() - lastMovingAt < KEEP_AFTER_MOVING_MS
        val want = (moving && prefs.getBoolean(Prefs.WAKE_ON_MOVE, true)) ||
                (charging && prefs.getBoolean(Prefs.KEEP_ON, true))
        if (want) {
            if (keepAwakeLock == null) {
                keepAwakeLock = power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK, "carlauncher:keep").apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } else {
            releaseKeepAwake()
        }
    }

    private fun releaseKeepAwake() {
        try {
            keepAwakeLock?.release()
        } catch (_: Exception) {
        }
        keepAwakeLock = null
    }

    // ------------------------------------------------------------ painel sobre o Waze

    private var panel: View? = null
    private var panelMedia: MediaViews? = null
    private var expanded = true
    private val mediaListener: () -> Unit = { panelMedia?.update() }
    private val speedListener: () -> Unit = { updatePanelSpeed() }

    private fun windowManager() = getSystemService(Context.WINDOW_SERVICE) as WindowManager

    fun showPanel() {
        if (!Launch.canOverlay(this)) return
        if (panel == null) {
            val ctx = ContextThemeWrapper(this, R.style.AppTheme)
            val v = LayoutInflater.from(ctx).inflate(R.layout.overlay_panel, null)
            panel = v
            panelMedia = MediaViews(v)
            v.findViewById<View>(R.id.panelHome).setOnClickListener { goHome() }
            v.findViewById<View>(R.id.miniHome).setOnClickListener { goHome() }
            v.findViewById<View>(R.id.panelCollapse).setOnClickListener { setExpanded(false) }
            v.findViewById<View>(R.id.miniExpand).setOnClickListener { setExpanded(true) }
            v.findViewById<View>(R.id.miniPlay).setOnClickListener { MediaHub.playPause(this) }
            try {
                windowManager().addView(v, panelParams())
            } catch (e: Exception) {
                panel = null
                panelMedia = null
                return
            }
            MediaHub.subscribe(this, mediaListener)
            MediaHub.connect()
            SpeedState.addListener(speedListener)
        }
        applyPanelLayout()
        updatePanelSpeed()
    }

    fun hidePanel() {
        val v = panel ?: return
        MediaHub.unsubscribe(mediaListener)
        SpeedState.removeListener(speedListener)
        try {
            windowManager().removeView(v)
        } catch (_: Exception) {
        }
        panel = null
        panelMedia = null
    }

    private fun goHome() {
        hidePanel()
        Launch.safeStart(this, Intent(this, MainActivity::class.java))
    }

    private fun setExpanded(value: Boolean) {
        expanded = value
        applyPanelLayout()
    }

    @Suppress("DEPRECATION")
    private fun panelParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val lp = WindowManager.LayoutParams(
            panelWidth(),
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )
        lp.gravity = Gravity.END or Gravity.TOP
        return lp
    }

    private fun panelWidth(): Int {
        val dm = resources.displayMetrics
        return if (expanded) (dm.widthPixels * 0.36f).toInt() else (dm.density * 84).toInt()
    }

    private fun applyPanelLayout() {
        val v = panel ?: return
        v.findViewById<View>(R.id.panelFull).visibility = if (expanded) View.VISIBLE else View.GONE
        v.findViewById<View>(R.id.panelMini).visibility = if (expanded) View.GONE else View.VISIBLE
        try {
            val lp = v.layoutParams as WindowManager.LayoutParams
            lp.width = panelWidth()
            windowManager().updateViewLayout(v, lp)
        } catch (_: Exception) {
        }
        panelMedia?.update()
        updateMiniPlay()
    }

    private fun updatePanelSpeed() {
        val v = panel ?: return
        val text = if (SpeedState.hasFix) SpeedState.kmh.toString() else "--"
        v.findViewById<TextView>(R.id.panelSpeed).text = text
        v.findViewById<TextView>(R.id.miniSpeed).text = text
        updateMiniPlay()
    }

    private fun updateMiniPlay() {
        val v = panel ?: return
        v.findViewById<ImageButton>(R.id.miniPlay)
            .setImageResource(if (MediaHub.isPlaying()) R.drawable.ic_pause else R.drawable.ic_play)
    }

    companion object {
        const val ACTION_SHOW_PANEL = "com.edson.carlauncher.SHOW_PANEL"
        const val ACTION_HIDE_PANEL = "com.edson.carlauncher.HIDE_PANEL"
        private const val CHANNEL = "painel"
        private const val NOTIF_ID = 1
        private const val MOVING_KMH = 12
        private const val GPS_FAST = 1000L
        private const val GPS_SLOW = 10_000L
        private const val IDLE_SLOW_MS = 10 * 60_000L
        private const val KEEP_AFTER_MOVING_MS = 3 * 60_000L

        var instance: CarService? = null
            private set

        fun hasLocationPermission(ctx: Context) = Build.VERSION.SDK_INT < 23 ||
                ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        /** Inicia o serviço (só a partir da tela, que está em primeiro plano). */
        fun start(ctx: Context, action: String? = null) {
            if (!hasLocationPermission(ctx)) return
            val i = Intent(ctx, CarService::class.java)
            if (action != null) i.action = action
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (_: Exception) {
            }
        }
    }
}

/** Velocidade atual do GPS, compartilhada entre o serviço e as telas. */
object SpeedState {
    var kmh = 0
        private set
    var hasFix = false
        private set
    var status: String? = "Procurando GPS…"
        private set

    var lat = 0.0
        private set
    var lon = 0.0
        private set
    var hasLocation = false
        private set
    /** Direção do movimento em graus (0 = norte); mantém a última quando parado. */
    var bearing = 0f
        private set

    private val listeners = LinkedHashSet<() -> Unit>()

    fun setLocation(latitude: Double, longitude: Double, newBearing: Float?) {
        lat = latitude
        lon = longitude
        hasLocation = true
        if (newBearing != null) bearing = newBearing
        notifyListeners()
    }

    fun setSpeed(value: Int) {
        kmh = value
        hasFix = true
        status = null
        notifyListeners()
    }

    fun setStatus(text: String) {
        status = text
        notifyListeners()
    }

    fun addListener(l: () -> Unit) = listeners.add(l)
    fun removeListener(l: () -> Unit) = listeners.remove(l)

    private fun notifyListeners() = listeners.toList().forEach { it() }
}

/** Nomes das preferências. */
object Prefs {
    const val FILE = "config"
    const val IDLE = "idle_seconds"
    const val KEEP_ON = "keep_screen_on"
    const val NAME = "user_name"
    const val ASKED_NOTIF = "asked_notification_access"
    const val ASKED_OVERLAY = "asked_overlay"
    const val WAKE_ON_MOVE = "wake_on_move"
    const val WAKE_ON_POWER = "wake_on_power"
    const val CAR_MODE_ON_WAKE = "car_mode_on_wake"
    const val SPEED_LIMIT = "speed_limit"
    const val WAZE_WINDOW = "waze_window"
    const val HEADING_UP = "heading_up"
}
