package com.edson.carlauncher

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.graphics.drawable.Drawable
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.GridView
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
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
    private lateinit var media: MediaViews

    // Status
    private lateinit var battery: TextView
    private lateinit var btIcon: ImageView

    // Telas
    private lateinit var homeScreen: View
    private lateinit var dashScreen: View
    private lateinit var railClock: View
    private lateinit var btnHome: View
    private lateinit var btnDash: View
    private lateinit var homeDate: TextView
    private lateinit var homeGreeting: TextView
    private lateinit var homeBattery: TextView
    private lateinit var homeBt: ImageView

    // Camadas
    private lateinit var idleLayer: View
    private lateinit var idleContent: View
    private lateinit var idleInfo: TextView
    private lateinit var appsLayer: View
    private val appsAdapter = AppsAdapter()

    private var started = false

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)
        audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager

        speedo = findViewById(R.id.speedo)
        navIcon = findViewById(R.id.navIcon)
        navTitle = findViewById(R.id.navTitle)
        navText = findViewById(R.id.navText)
        battery = findViewById(R.id.battery)
        btIcon = findViewById(R.id.btIcon)
        idleLayer = findViewById(R.id.idleLayer)
        idleContent = findViewById(R.id.idleContent)
        idleInfo = findViewById(R.id.idleInfo)
        appsLayer = findViewById(R.id.appsLayer)
        homeScreen = findViewById(R.id.homeScreen)
        dashScreen = findViewById(R.id.dashScreen)
        railClock = findViewById(R.id.railClock)
        btnHome = findViewById(R.id.btnHome)
        btnDash = findViewById(R.id.btnDash)
        homeDate = findViewById(R.id.homeDate)
        homeGreeting = findViewById(R.id.homeGreeting)
        homeBattery = findViewById(R.id.homeBattery)
        homeBt = findViewById(R.id.homeBt)

        media = MediaViews(findViewById(R.id.dashScreen))

        // Barra lateral
        btnHome.setOnClickListener { closeOverlays(); showScreen(false) }
        btnDash.setOnClickListener { closeOverlays(); showScreen(true) }
        findViewById<View>(R.id.btnSettings).setOnClickListener { showSettings() }

        // Tela inicial
        findViewById<View>(R.id.tileNav).setOnClickListener { startCarMode(null) }
        findViewById<View>(R.id.tileMusic).setOnClickListener { Launch.openYtMusic(this) }
        findViewById<View>(R.id.tilePhone).setOnClickListener { openPhone() }
        findViewById<View>(R.id.tileApps).setOnClickListener { showApps() }
        findViewById<View>(R.id.homeSettings).setOnClickListener { showSettings() }
        showScreen(false)

        // Navegação
        findViewById<View>(R.id.navCard).setOnClickListener { startCarMode(null) }
        findViewById<View>(R.id.btnOpenWaze).setOnClickListener { startCarMode(null) }
        findViewById<View>(R.id.btnGoHome).setOnClickListener { startCarMode("waze://?favorite=home&navigate=yes") }
        findViewById<View>(R.id.btnGoWork).setOnClickListener { startCarMode("waze://?favorite=work&navigate=yes") }

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
        allowOverLockScreen()
        askPermissionsFirstRun()
        CarService.start(this)
        handleWake(intent)
    }

    override fun onStart() {
        super.onStart()
        started = true
        NavState.addListener(navListener)
        updateNav()
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        registerReceiver(statusReceiver, filter)
        SpeedState.addListener(speedListener)
        updateSpeed()
        MediaHub.subscribe(this, mediaListener)
        updateHomeTexts()
        handler.post(ticker)
        scheduleIdle()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        // Voltou para a tela inicial: tira o painel de cima do Waze
        CarService.instance?.hidePanel()
        // Pode ter voltado da tela de permissões
        MediaHub.connect()
        CarService.start(this)
    }

    override fun onStop() {
        super.onStop()
        started = false
        NavState.removeListener(navListener)
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        SpeedState.removeListener(speedListener)
        MediaHub.unsubscribe(mediaListener)
        handler.removeCallbacks(ticker)
        handler.removeCallbacks(idleRunnable)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Botão "home" apertado com o launcher já aberto: volta à tela inicial
        closeOverlays()
        showScreen(false)
        handleWake(intent)
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
        if (prefs.getBoolean(Prefs.KEEP_ON, true)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun showScreen(dash: Boolean) {
        homeScreen.visibility = if (dash) View.GONE else View.VISIBLE
        dashScreen.visibility = if (dash) View.VISIBLE else View.GONE
        railClock.visibility = if (dash) View.VISIBLE else View.INVISIBLE
        btnHome.setBackgroundResource(if (dash) R.drawable.bg_btn else R.drawable.bg_btn_selected)
        btnDash.setBackgroundResource(if (dash) R.drawable.bg_btn_selected else R.drawable.bg_btn)
    }

    private fun updateHomeTexts() {
        val now = Calendar.getInstance()
        val ptBr = Locale("pt", "BR")
        val date = SimpleDateFormat("EEEE, d 'de' MMMM", ptBr).format(now.time)
        homeDate.text = date.replaceFirstChar { it.titlecase(ptBr) }
        val hour = now.get(Calendar.HOUR_OF_DAY)
        val hello = when {
            hour in 5..11 -> "Bom dia"
            hour in 12..17 -> "Boa tarde"
            else -> "Boa noite"
        }
        val name = prefs.getString(Prefs.NAME, "Edson").orEmpty().trim()
        homeGreeting.text = if (name.isEmpty()) "$hello." else "$hello, $name."
    }

    private fun closeOverlays() {
        appsLayer.visibility = View.GONE
        exitIdle()
    }

    // ---------------------------------------------------------------- tique de 1 s

    private var tickCount = 0
    private val ticker = object : Runnable {
        override fun run() {
            media.tick()
            tickCount++
            if (tickCount % 20 == 0) updateHomeTexts()
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
        val secs = prefs.getInt(Prefs.IDLE, 60)
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
        if (SpeedState.hasFix) parts.add("${SpeedState.kmh} km/h")
        val title = MediaHub.title()
        if (title != null) {
            val artist = MediaHub.artist()
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

    // ---------------------------------------------------------------- velocímetro

    private val speedListener: () -> Unit = { updateSpeed() }

    private fun updateSpeed() {
        val status = SpeedState.status
        if (status != null) speedo.setStatus(status) else speedo.setSpeed(SpeedState.kmh.toFloat())
    }

    private fun hasLocationPermission() = CarService.hasLocationPermission(this)

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

    /**
     * Modo carro: abre o Waze em tela cheia e coloca o painel de música à direita,
     * por cima dele (estilo Android Auto).
     */
    private fun startCarMode(deepLink: String?) {
        if (!Launch.canOverlay(this)) {
            AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Waze + música")
                .setMessage(
                    "Para mostrar a música ao lado do Waze, permita que o \"Painel do Carro\" " +
                            "apareça sobre outros apps na próxima tela."
                )
                .setPositiveButton("Permitir") { _, _ -> Launch.openOverlaySettings(this) }
                .setNegativeButton("Só o Waze") { _, _ -> Launch.openWaze(this, deepLink) }
                .show()
            return
        }
        if (Launch.openWaze(this, deepLink)) {
            CarService.start(this, CarService.ACTION_SHOW_PANEL)
        }
    }

    /** Aberto pelo serviço porque o carro começou a andar / ligou no carregador. */
    private fun handleWake(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_WAKE, false) != true) return
        intent.removeExtra(EXTRA_WAKE)
        if (Build.VERSION.SDK_INT >= 26) {
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(this, null)
        }
        if (prefs.getBoolean(Prefs.CAR_MODE_ON_WAKE, true)) {
            handler.postDelayed({ startCarMode(null) }, 600)
        }
    }

    @Suppress("DEPRECATION")
    private fun allowOverLockScreen() {
        // Deixa o painel aparecer quando a tela acende sozinha (sem precisar desbloquear)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
    }

    // ---------------------------------------------------------------- música (YouTube Music)

    private val mediaListener: () -> Unit = { media.update() }

    private fun hasNotificationAccess() = MediaHub.hasAccess(this)

    private fun openPhone() {
        if (!safeStart(Intent(Intent.ACTION_DIAL))) {
            Toast.makeText(this, "Telefone não encontrado", Toast.LENGTH_SHORT).show()
        }
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
                    homeBattery.text = battery.text
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
        homeBt.visibility = btIcon.visibility
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

    private fun openAppDetails(pkg: String) = Launch.openAppDetails(this, pkg)

    // ---------------------------------------------------------------- ajustes

    private fun showSettings() {
        val idleSecs = prefs.getInt(Prefs.IDLE, 60)
        fun yes(key: String) = prefs.getBoolean(key, true)
        fun yn(key: String) = if (yes(key)) "Sim" else "Não"
        fun ok(v: Boolean) = if (v) "  ✓" else ""
        val actions = listOf(
            item("Permitir controle de música e Waze" + ok(hasNotificationAccess())) { openNotificationAccess() },
            item("Permitir GPS (velocímetro)" + ok(hasLocationPermission())) { requestLocation() },
            item("Permitir aparecer sobre outros apps" + ok(Launch.canOverlay(this))) { Launch.openOverlaySettings(this) },
            item("Ligar a tela quando o carro andar: " + yn(Prefs.WAKE_ON_MOVE)) { toggle(Prefs.WAKE_ON_MOVE) },
            item("Ligar a tela ao conectar o carregador: " + yn(Prefs.WAKE_ON_POWER)) { toggle(Prefs.WAKE_ON_POWER) },
            item("Ao ligar a tela, abrir Waze + música: " + yn(Prefs.CAR_MODE_ON_WAKE)) { toggle(Prefs.CAR_MODE_ON_WAKE) },
            item("Tela sempre ligada no carregador: " + yn(Prefs.KEEP_ON)) {
                toggle(Prefs.KEEP_ON)
                applyKeepScreenOn()
            },
            item("Modo relógio: " + idleLabel(idleSecs)) { chooseIdle() },
            item("Seu nome (saudação): " + prefs.getString(Prefs.NAME, "Edson")) { editName() },
            item("Usar como tela inicial do celular") {
                if (!safeStart(Intent(Settings.ACTION_HOME_SETTINGS))) safeStart(Intent(Settings.ACTION_SETTINGS))
            },
            item("Liberar configurações restritas (Android 13+)") { openAppDetails(packageName) },
            item("Configurações do Android") { safeStart(Intent(Settings.ACTION_SETTINGS)) }
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Ajustes")
            .setItems(actions.map { it.first }.toTypedArray()) { _, which -> actions[which].second() }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun item(label: String, action: () -> Unit) = label to action

    private fun toggle(key: String) {
        prefs.edit().putBoolean(key, !prefs.getBoolean(key, true)).apply()
    }

    private fun editName() {
        val input = EditText(this)
        input.setText(prefs.getString(Prefs.NAME, "Edson"))
        input.setSingleLine()
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Seu nome")
            .setView(input)
            .setPositiveButton("Salvar") { _, _ ->
                prefs.edit().putString(Prefs.NAME, input.text.toString().trim()).apply()
                updateHomeTexts()
                hideSystemBars()
            }
            .setNegativeButton("Cancelar", null)
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
        val current = options.indexOf(prefs.getInt(Prefs.IDLE, 60)).coerceAtLeast(0)
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Mostrar relógio depois de")
            .setSingleChoiceItems(labels, current) { d, which ->
                prefs.edit().putInt(Prefs.IDLE, options[which]).apply()
                scheduleIdle()
                d.dismiss()
            }
            .show()
    }

    private fun askPermissionsFirstRun() {
        if (!hasLocationPermission()) requestLocation()
        if (!hasNotificationAccess() && !prefs.getBoolean(Prefs.ASKED_NOTIF, false)) {
            prefs.edit().putBoolean(Prefs.ASKED_NOTIF, true).apply()
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
        if (!Launch.canOverlay(this) && !prefs.getBoolean(Prefs.ASKED_OVERLAY, false)) {
            prefs.edit().putBoolean(Prefs.ASKED_OVERLAY, true).apply()
            AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Waze + música e tela automática")
                .setMessage(
                    "Para mostrar a música ao lado do Waze e para acender a tela sozinho quando " +
                            "o carro andar, permita que o \"Painel do Carro\" apareça sobre outros apps."
                )
                .setPositiveButton("Permitir") { _, _ -> Launch.openOverlaySettings(this) }
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
        if (requestCode == REQ_LOCATION) CarService.start(this)
    }

    private fun openNotificationAccess() = Launch.openNotificationAccess(this)

    private fun safeStart(intent: Intent) = Launch.safeStart(this, intent)

    @Suppress("DEPRECATION")
    private fun accentColor() = resources.getColor(R.color.accent)

    companion object {
        const val EXTRA_WAKE = "wake"
        const val REQ_LOCATION = 1
    }
}
