package com.edson.carlauncher

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.GridView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import kotlin.random.Random

class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var prefs: SharedPreferences
    private lateinit var audio: AudioManager

    // Navegação / velocímetro
    private lateinit var speedo: SpeedometerView
    private lateinit var navIcon: ImageView
    private lateinit var navTitle: TextView
    private lateinit var navText: TextView

    // Música
    private lateinit var art: ImageView
    private lateinit var mediaHint: TextView
    private lateinit var trackTitle: TextView
    private lateinit var trackArtist: TextView
    private lateinit var btnPlay: ImageButton
    private lateinit var progress: ProgressBar
    private lateinit var timeCur: TextView
    private lateinit var timeTotal: TextView

    // Status
    private lateinit var battery: TextView
    private lateinit var btIcon: ImageView

    // Camadas
    private lateinit var idleLayer: View
    private lateinit var idleContent: View
    private lateinit var idleInfo: TextView
    private lateinit var appsLayer: View
    private val appsAdapter = AppsAdapter()

    private var controller: MediaController? = null
    private var shownArt: Bitmap? = null
    private var lastFix: Location? = null
    private var speedKmh = 0
    private var gpsRunning = false
    private var started = false

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("config", Context.MODE_PRIVATE)
        audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager

        speedo = findViewById(R.id.speedo)
        navIcon = findViewById(R.id.navIcon)
        navTitle = findViewById(R.id.navTitle)
        navText = findViewById(R.id.navText)
        art = findViewById(R.id.art)
        mediaHint = findViewById(R.id.mediaHint)
        trackTitle = findViewById(R.id.trackTitle)
        trackArtist = findViewById(R.id.trackArtist)
        btnPlay = findViewById(R.id.btnPlay)
        progress = findViewById(R.id.progress)
        timeCur = findViewById(R.id.timeCur)
        timeTotal = findViewById(R.id.timeTotal)
        battery = findViewById(R.id.battery)
        btIcon = findViewById(R.id.btIcon)
        idleLayer = findViewById(R.id.idleLayer)
        idleContent = findViewById(R.id.idleContent)
        idleInfo = findViewById(R.id.idleInfo)
        appsLayer = findViewById(R.id.appsLayer)

        art.clipToOutline = true
        trackTitle.isSelected = true // ativa o letreiro (marquee)

        // Barra lateral
        findViewById<View>(R.id.btnHome).setOnClickListener { closeOverlays() }
        findViewById<View>(R.id.btnNav).setOnClickListener { openWaze(null) }
        findViewById<View>(R.id.btnMusic).setOnClickListener { openYtMusic() }
        findViewById<View>(R.id.btnApps).setOnClickListener { showApps() }
        findViewById<View>(R.id.btnSettings).setOnClickListener { showSettings() }

        // Navegação
        findViewById<View>(R.id.navCard).setOnClickListener { openWaze(null) }
        findViewById<View>(R.id.btnOpenWaze).setOnClickListener { openWaze(null) }
        findViewById<View>(R.id.btnGoHome).setOnClickListener { openWaze("waze://?favorite=home&navigate=yes") }
        findViewById<View>(R.id.btnGoWork).setOnClickListener { openWaze("waze://?favorite=work&navigate=yes") }

        // Música
        art.setOnClickListener { openYtMusic() }
        mediaHint.setOnClickListener { openNotificationAccess() }
        btnPlay.setOnClickListener { playPause() }
        findViewById<View>(R.id.btnPrev).setOnClickListener {
            controller?.transportControls?.skipToPrevious() ?: mediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
        }
        findViewById<View>(R.id.btnNext).setOnClickListener {
            controller?.transportControls?.skipToNext() ?: mediaKey(KeyEvent.KEYCODE_MEDIA_NEXT)
        }
        findViewById<View>(R.id.btnVolDown).setOnClickListener { volume(AudioManager.ADJUST_LOWER) }
        findViewById<View>(R.id.btnVolUp).setOnClickListener { volume(AudioManager.ADJUST_RAISE) }
        findViewById<View>(R.id.btnVol).setOnClickListener { volume(AudioManager.ADJUST_SAME) }

        // Gaveta de apps
        val grid = findViewById<GridView>(R.id.appsGrid)
        grid.adapter = appsAdapter
        grid.setOnItemClickListener { _, _, pos, _ -> launchApp(appsAdapter.items[pos]) }
        grid.setOnItemLongClickListener { _, _, pos, _ ->
            openAppDetails(appsAdapter.items[pos].pkg)
            true
        }
        findViewById<View>(R.id.appsClose).setOnClickListener { appsLayer.visibility = View.GONE }

        // Modo relógio: qualquer toque volta ao painel
        idleLayer.setOnClickListener { exitIdle() }

        applyKeepScreenOn()
        askPermissionsFirstRun()
    }

    override fun onStart() {
        super.onStart()
        started = true
        NavState.addListener(navListener)
        updateNav()
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        registerReceiver(statusReceiver, filter)
        startGps()
        connectMedia()
        handler.post(ticker)
        scheduleIdle()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        // Pode ter voltado da tela de permissões
        if (controller == null) connectMedia()
        if (!gpsRunning) startGps()
    }

    override fun onStop() {
        super.onStop()
        started = false
        NavState.removeListener(navListener)
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        stopGps()
        disconnectMedia()
        handler.removeCallbacks(ticker)
        handler.removeCallbacks(idleRunnable)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Botão "home" apertado com o painel já aberto
        closeOverlays()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Somos a tela inicial: o "voltar" só fecha as camadas.
        closeOverlays()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) scheduleIdle()
        return super.dispatchTouchEvent(ev)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    private fun applyKeepScreenOn() {
        if (prefs.getBoolean(PREF_KEEP_ON, true)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun closeOverlays() {
        appsLayer.visibility = View.GONE
        exitIdle()
    }

    // ---------------------------------------------------------------- tique de 1 s

    private var tickCount = 0
    private val ticker = object : Runnable {
        override fun run() {
            updateProgress()
            tickCount++
            if (tickCount % 5 == 0) checkGpsTimeout()
            if (idleLayer.visibility == View.VISIBLE) {
                updateIdleInfo()
                // Move o relógio um pouco a cada minuto para não marcar a tela
                if (tickCount % 60 == 0) shiftIdleClock()
            }
            handler.postDelayed(this, 1000)
        }
    }

    // ---------------------------------------------------------------- modo relógio

    private val idleRunnable = Runnable { enterIdle() }

    private fun scheduleIdle() {
        handler.removeCallbacks(idleRunnable)
        val secs = prefs.getInt(PREF_IDLE, 60)
        if (secs > 0 && started) handler.postDelayed(idleRunnable, secs * 1000L)
    }

    private fun enterIdle() {
        if (idleLayer.visibility == View.VISIBLE) return
        appsLayer.visibility = View.GONE
        updateIdleInfo()
        idleLayer.alpha = 0f
        idleLayer.visibility = View.VISIBLE
        idleLayer.animate().alpha(1f).setDuration(600).start()
    }

    private fun exitIdle() {
        if (idleLayer.visibility != View.VISIBLE) return
        idleLayer.animate().alpha(0f).setDuration(250).withEndAction {
            idleLayer.visibility = View.GONE
            idleLayer.alpha = 1f
        }.start()
        scheduleIdle()
    }

    private fun updateIdleInfo() {
        val parts = mutableListOf<String>()
        if (lastFix != null) parts.add("$speedKmh km/h")
        val md = controller?.metadata
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
        if (!title.isNullOrBlank()) {
            val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
            parts.add("♪ " + if (artist.isNullOrBlank()) title else "$title — $artist")
        }
        if (NavState.active) NavState.title?.let { parts.add(it) }
        idleInfo.text = parts.joinToString("   •   ")
    }

    private fun shiftIdleClock() {
        val range = resources.displayMetrics.density * 24
        idleContent.animate()
            .translationX(Random.nextFloat() * 2 * range - range)
            .translationY(Random.nextFloat() * 2 * range - range)
            .setDuration(2000).start()
    }

    // ---------------------------------------------------------------- GPS / velocímetro

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) = onFix(location)
        override fun onProviderEnabled(provider: String) {
            speedo.setStatus("Procurando GPS…")
        }
        override fun onProviderDisabled(provider: String) {
            speedo.setStatus("GPS desligado")
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        }
    }

    private fun hasLocationPermission() = Build.VERSION.SDK_INT < 23 ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startGps() {
        if (gpsRunning || !started) return
        if (!hasLocationPermission()) {
            speedo.setStatus("Sem permissão de GPS")
            return
        }
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) speedo.setStatus("GPS desligado")
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, locationListener, Looper.getMainLooper())
            gpsRunning = true
        } catch (e: SecurityException) {
            speedo.setStatus("Sem permissão de GPS")
        } catch (e: Exception) {
            speedo.setStatus("GPS indisponível")
        }
    }

    private fun stopGps() {
        if (!gpsRunning) return
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            lm.removeUpdates(locationListener)
        } catch (_: Exception) {
        }
        gpsRunning = false
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
        speedKmh = Math.round(mps * 3.6f)
        speedo.setSpeed(speedKmh.toFloat())
    }

    private fun checkGpsTimeout() {
        val fix = lastFix ?: return
        if (SystemClock.elapsedRealtime() - fix.elapsedRealtimeNanos / 1_000_000 > 8000) {
            speedo.setStatus("Sem sinal de GPS")
        }
    }

    // ---------------------------------------------------------------- navegação (Waze)

    private val navListener: () -> Unit = { updateNav() }

    private fun updateNav() {
        if (NavState.active) {
            navTitle.text = NavState.title ?: "Navegando"
            navText.text = NavState.text ?: "Toque para ver o mapa"
            val icon: Drawable? = NavState.icon
            if (icon != null) {
                navIcon.clearColorFilter()
                navIcon.setImageDrawable(icon)
            } else {
                navIcon.setImageResource(R.drawable.ic_turn)
                navIcon.setColorFilter(accentColor())
            }
        } else {
            navTitle.text = "Waze"
            navText.text = "Toque para abrir a navegação"
            navIcon.setImageResource(R.drawable.ic_navigation)
            navIcon.setColorFilter(accentColor())
        }
    }

    private fun openWaze(deepLink: String?) {
        try {
            val intent = if (deepLink != null) {
                Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
            } else {
                packageManager.getLaunchIntentForPackage(WAZE) ?: throw ActivityNotFoundException()
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Waze não encontrado", Toast.LENGTH_SHORT).show()
            openStore(WAZE)
        }
    }

    // ---------------------------------------------------------------- música (YouTube Music)

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list ->
        pickController(list ?: emptyList())
    }

    private val mediaCallback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = updateMedia()
        override fun onMetadataChanged(metadata: MediaMetadata?) = updateMedia()
        override fun onSessionDestroyed() {
            setController(null)
        }
    }

    private fun listenerComponent() = ComponentName(this, MediaListenerService::class.java)

    private fun hasNotificationAccess(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.split(":").any { ComponentName.unflattenFromString(it)?.packageName == packageName }
    }

    private fun connectMedia() {
        if (!started) return
        if (!hasNotificationAccess()) {
            mediaHint.visibility = View.VISIBLE
            updateMedia()
            return
        }
        mediaHint.visibility = View.GONE
        val msm = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        try {
            msm.removeOnActiveSessionsChangedListener(sessionsListener)
            msm.addOnActiveSessionsChangedListener(sessionsListener, listenerComponent(), handler)
            pickController(msm.getActiveSessions(listenerComponent()))
        } catch (e: SecurityException) {
            mediaHint.visibility = View.VISIBLE
        }
    }

    private fun disconnectMedia() {
        try {
            val msm = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            msm.removeOnActiveSessionsChangedListener(sessionsListener)
        } catch (_: Exception) {
        }
        setController(null)
    }

    private fun isPlaying(c: MediaController?): Boolean {
        val s = c?.playbackState?.state ?: return false
        return s == PlaybackState.STATE_PLAYING || s == PlaybackState.STATE_BUFFERING
    }

    private fun pickController(list: List<MediaController>) {
        val best = list.firstOrNull { it.packageName == YT_MUSIC && isPlaying(it) }
            ?: list.firstOrNull { isPlaying(it) }
            ?: list.firstOrNull { it.packageName == YT_MUSIC }
            ?: list.firstOrNull()
        setController(best)
    }

    private fun setController(c: MediaController?) {
        val current = controller
        if (c != null && current != null && c.sessionToken == current.sessionToken) {
            updateMedia()
            return
        }
        current?.unregisterCallback(mediaCallback)
        controller = c
        c?.registerCallback(mediaCallback, handler)
        updateMedia()
    }

    private fun updateMedia() {
        val c = controller
        val md = c?.metadata
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
            ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
        val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
            ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
            ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)

        if (title.isNullOrBlank()) {
            trackTitle.text = "Nenhuma música"
            trackArtist.text = "Toque ▶ para abrir o YouTube Music"
        } else {
            if (trackTitle.text.toString() != title) trackTitle.text = title
            trackArtist.text = artist ?: ""
        }

        val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        if (bmp !== shownArt) {
            shownArt = bmp
            if (bmp != null) {
                art.setImageBitmap(bmp)
                art.scaleType = ImageView.ScaleType.CENTER_CROP
                art.clearColorFilter()
            } else {
                art.setImageResource(R.drawable.ic_music)
                art.scaleType = ImageView.ScaleType.CENTER
                art.setColorFilter(0x88FFFFFF.toInt())
            }
        }

        btnPlay.setImageResource(if (isPlaying(c)) R.drawable.ic_pause else R.drawable.ic_play)
        updateProgress()
    }

    private fun updateProgress() {
        val c = controller
        val state = c?.playbackState
        val duration = c?.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
        if (state == null || duration <= 0) {
            progress.progress = 0
            timeCur.text = if (state == null) "0:00" else formatTime(state.position)
            timeTotal.text = "0:00"
            return
        }
        var pos = state.position
        if (state.state == PlaybackState.STATE_PLAYING) {
            pos += ((SystemClock.elapsedRealtime() - state.lastPositionUpdateTime) * state.playbackSpeed).toLong()
        }
        pos = pos.coerceIn(0L, duration)
        progress.progress = (pos * 1000 / duration).toInt()
        timeCur.text = formatTime(pos)
        timeTotal.text = formatTime(duration)
    }

    private fun formatTime(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
    }

    private fun playPause() {
        val c = controller
        when {
            c == null -> {
                // Nada tocando: abre o YouTube Music e manda "play"
                openYtMusic()
                handler.postDelayed({ if (controller == null) mediaKey(KeyEvent.KEYCODE_MEDIA_PLAY) }, 2500)
            }
            isPlaying(c) -> c.transportControls.pause()
            else -> c.transportControls.play()
        }
    }

    private fun mediaKey(code: Int) {
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    private fun volume(direction: Int) {
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }

    private fun openYtMusic() {
        val intent = packageManager.getLaunchIntentForPackage(YT_MUSIC)
        if (intent == null) {
            Toast.makeText(this, "YouTube Music não encontrado", Toast.LENGTH_SHORT).show()
            openStore(YT_MUSIC)
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
    }

    // ---------------------------------------------------------------- bateria / bluetooth

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_BATTERY_CHANGED) {
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
                if (level >= 0 && scale > 0) {
                    val pct = level * 100 / scale
                    battery.text = if (plugged) "⚡ $pct%" else "$pct%"
                }
            }
            updateBluetooth()
        }
    }

    @Suppress("DEPRECATION")
    private fun updateBluetooth() {
        val on = try {
            BluetoothAdapter.getDefaultAdapter()?.isEnabled == true
        } catch (_: Exception) {
            false
        }
        btIcon.visibility = if (on) View.VISIBLE else View.GONE
    }

    // ---------------------------------------------------------------- gaveta de apps

    class AppEntry(val label: String, val pkg: String, val cls: String, val icon: Drawable)

    inner class AppsAdapter : BaseAdapter() {
        var items: List<AppEntry> = emptyList()

        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val v = convertView ?: LayoutInflater.from(parent.context).inflate(R.layout.item_app, parent, false)
            val item = items[position]
            v.findViewById<ImageView>(R.id.appIcon).setImageDrawable(item.icon)
            v.findViewById<TextView>(R.id.appLabel).text = item.label
            return v
        }
    }

    private fun showApps() {
        exitIdle()
        appsLayer.visibility = View.VISIBLE
        val pm = packageManager
        Thread {
            val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val list = pm.queryIntentActivities(query, 0)
                .filter { it.activityInfo.packageName != packageName }
                .map {
                    AppEntry(
                        it.loadLabel(pm).toString(),
                        it.activityInfo.packageName,
                        it.activityInfo.name,
                        it.loadIcon(pm)
                    )
                }
                .sortedBy { it.label.lowercase() }
            runOnUiThread {
                appsAdapter.items = list
                appsAdapter.notifyDataSetChanged()
            }
        }.start()
    }

    private fun launchApp(app: AppEntry) {
        try {
            val intent = Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClassName(app.pkg, app.cls)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            startActivity(intent)
            appsLayer.visibility = View.GONE
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openAppDetails(pkg: String) {
        safeStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
    }

    // ---------------------------------------------------------------- ajustes

    private fun showSettings() {
        val idleSecs = prefs.getInt(PREF_IDLE, 60)
        val keepOn = prefs.getBoolean(PREF_KEEP_ON, true)
        val items = arrayOf(
            "Permitir controle de música e Waze" + if (hasNotificationAccess()) "  ✓" else "",
            "Permitir GPS (velocímetro)" + if (hasLocationPermission()) "  ✓" else "",
            "Modo relógio: " + idleLabel(idleSecs),
            "Tela sempre ligada: " + if (keepOn) "Sim" else "Não",
            "Usar como tela inicial do celular",
            "Liberar configurações restritas (Android 13+)",
            "Configurações do Android"
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Ajustes")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> openNotificationAccess()
                    1 -> requestLocation()
                    2 -> chooseIdle()
                    3 -> {
                        prefs.edit().putBoolean(PREF_KEEP_ON, !keepOn).apply()
                        applyKeepScreenOn()
                    }
                    4 -> {
                        if (!safeStart(Intent(Settings.ACTION_HOME_SETTINGS))) safeStart(Intent(Settings.ACTION_SETTINGS))
                    }
                    5 -> openAppDetails(packageName)
                    6 -> safeStart(Intent(Settings.ACTION_SETTINGS))
                }
            }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun idleLabel(secs: Int) = when {
        secs <= 0 -> "Nunca"
        secs < 60 -> "$secs s"
        else -> "${secs / 60} min"
    }

    private fun chooseIdle() {
        val options = intArrayOf(30, 60, 120, 300, 0)
        val labels = options.map { idleLabel(it) }.toTypedArray()
        val current = options.indexOf(prefs.getInt(PREF_IDLE, 60)).coerceAtLeast(0)
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Mostrar relógio depois de")
            .setSingleChoiceItems(labels, current) { d, which ->
                prefs.edit().putInt(PREF_IDLE, options[which]).apply()
                scheduleIdle()
                d.dismiss()
            }
            .show()
    }

    private fun askPermissionsFirstRun() {
        if (!hasLocationPermission()) requestLocation()
        if (!hasNotificationAccess() && !prefs.getBoolean(PREF_ASKED_NOTIF, false)) {
            prefs.edit().putBoolean(PREF_ASKED_NOTIF, true).apply()
            AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Controle de música")
                .setMessage(
                    "Para mostrar a música do YouTube Music (capa, nome, tempo), controlar " +
                            "play/pause e exibir as instruções do Waze, permita o acesso às " +
                            "notificações para o \"Painel do Carro\" na próxima tela.\n\n" +
                            "Se a opção estiver bloqueada (Android 13+/Samsung): toque em " +
                            "\"Liberar\", depois no menu ⋮ e em \"Permitir configurações restritas\"."
                )
                .setNeutralButton("Liberar") { _, _ -> openAppDetails(packageName) }
                .setPositiveButton("Permitir") { _, _ -> openNotificationAccess() }
                .setNegativeButton("Agora não", null)
                .show()
        }
    }

    private fun requestLocation() {
        if (Build.VERSION.SDK_INT >= 23 && !hasLocationPermission()) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                REQ_LOCATION
            )
        } else if (hasLocationPermission()) {
            Toast.makeText(this, "GPS já permitido", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) startGps()
    }

    private fun openNotificationAccess() {
        if (!safeStart(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))) {
            safeStart(Intent(Settings.ACTION_SETTINGS))
        }
    }

    // ---------------------------------------------------------------- utilidades

    private fun openStore(pkg: String) {
        if (!safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))) {
            safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")))
        }
    }

    private fun safeStart(intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        true
    } catch (e: Exception) {
        false
    }

    @Suppress("DEPRECATION")
    private fun accentColor() = resources.getColor(R.color.accent)

    companion object {
        const val WAZE = "com.waze"
        const val YT_MUSIC = "com.google.android.apps.youtube.music"
        const val PREF_IDLE = "idle_seconds"
        const val PREF_KEEP_ON = "keep_screen_on"
        const val PREF_ASKED_NOTIF = "asked_notification_access"
        const val REQ_LOCATION = 1
    }
}
