package com.edson.carlauncher

import android.Manifest
import android.app.Activity
import android.app.ActivityOptions
import android.app.AlertDialog
import android.app.KeyguardManager
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.net.Uri
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
import android.widget.GridView
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import kotlin.random.Random

class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var prefs: SharedPreferences

    // Espaço do Waze
    private lateinit var wazeSlot: View
    private var autoOpenedWaze = false

    // Velocímetro
    private lateinit var speedo: SpeedometerView
    private lateinit var limitBadge: TextView
    private lateinit var limitLabel: TextView
    private lateinit var roadName: TextView

    // Música
    private lateinit var media: MediaViews
    private lateinit var musicAppIcon: ImageView
    private var musicIconPkg: String? = null

    // Status
    private lateinit var battery: TextView
    private lateinit var btIcon: ImageView

    // Camadas
    private lateinit var idleLayer: View
    private lateinit var idleContent: View
    private lateinit var idleInfo: TextView
    private lateinit var appsLayer: View
    private val appsAdapter = AppsAdapter()

    private var started = false
    private var askedSomething = false

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)

        wazeSlot = findViewById(R.id.wazeSlot)
        speedo = findViewById(R.id.speedo)
        limitBadge = findViewById(R.id.limitBadge)
        limitLabel = findViewById(R.id.limitLabel)
        roadName = findViewById(R.id.roadName)
        musicAppIcon = findViewById(R.id.musicAppIcon)
        battery = findViewById(R.id.battery)
        btIcon = findViewById(R.id.btIcon)
        idleLayer = findViewById(R.id.idleLayer)
        idleContent = findViewById(R.id.idleContent)
        idleInfo = findViewById(R.id.idleInfo)
        appsLayer = findViewById(R.id.appsLayer)

        media = MediaViews(findViewById(R.id.musicCard))

        // Barra lateral
        setRailIcon(findViewById(R.id.railWaze), appIcon(Launch.WAZE), R.drawable.ic_navigation)
        setRailIcon(findViewById(R.id.railMusic), appIcon(Launch.YT_MUSIC), R.drawable.ic_music)
        setRailIcon(findViewById(R.id.railPhone), dialerIcon(), R.drawable.ic_phone)
        findViewById<View>(R.id.railWaze).setOnClickListener { openWaze(null) }
        findViewById<View>(R.id.railWaze).setOnLongClickListener {
            showMore()
            true
        }
        findViewById<View>(R.id.railMusic).setOnClickListener { Launch.openYtMusic(this) }
        findViewById<View>(R.id.railPhone).setOnClickListener { openPhone() }
        findViewById<View>(R.id.railApps).setOnClickListener { showApps() }

        // Waze
        wazeSlot.setOnClickListener { openWaze(null) }
        findViewById<ImageView>(R.id.wazeSlotIcon).let { v -> appIcon(Launch.WAZE)?.let { v.setImageDrawable(it) } }

        // Velocímetro
        limitBadge.setOnClickListener { chooseLimit() }
        updateLimit()

        // Música
        musicAppIcon.setOnClickListener { Launch.openYtMusic(this) }

        // Gaveta de apps
        val grid = findViewById<GridView>(R.id.appsGrid)
        grid.adapter = appsAdapter
        grid.setOnItemClickListener { _, _, pos, _ -> launchApp(appsAdapter.items[pos]) }
        grid.setOnItemLongClickListener { _, _, pos, _ ->
            Launch.openAppDetails(this, appsAdapter.items[pos].pkg)
            true
        }
        findViewById<View>(R.id.appsClose).setOnClickListener { appsLayer.visibility = View.GONE }
        findViewById<View>(R.id.appsSettings).setOnClickListener { showSettings() }

        // Modo relógio: qualquer toque volta ao painel
        idleLayer.setOnClickListener { exitIdle() }

        applyKeepScreenOn()
        allowOverLockScreen()
        askPermissionsFirstRun()
        CarService.start(this)
        handleWake(intent)
        // Abre o Waze no espaço da direita assim que a tela estiver pronta
        // (não na primeira vez, para não cobrir os pedidos de permissão)
        if (prefs.getBoolean(Prefs.AUTO_WAZE, true) && !askedSomething) wazeSlot.post { autoOpenWaze() }
    }

    override fun onStart() {
        super.onStart()
        started = true
        SpeedLimit.addListener(limitListener)
        updateLimit()
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        registerReceiver(statusReceiver, filter)
        SpeedState.addListener(speedListener)
        updateSpeed()
        MediaHub.subscribe(this, mediaListener)
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
        SpeedLimit.removeListener(limitListener)
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
        // Botão "home" apertado com o launcher já aberto
        closeOverlays()
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
        val secs = prefs.getInt(Prefs.IDLE, 0)
        if (secs > 0 && started) handler.postDelayed(idleRunnable, secs * 1000L)
    }

    private fun enterIdle() {
        if (idleLayer.visibility == View.VISIBLE) return
        // Andando, o painel continua na tela
        if (SpeedState.hasFix && SpeedState.kmh >= 10) {
            scheduleIdle()
            return
        }
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
        idleInfo.text = parts.joinToString("   •   ")
    }

    private fun shiftIdleClock() {
        val range = resources.displayMetrics.density * 24
        idleContent.animate()
            .translationX(Random.nextFloat() * 2 * range - range)
            .translationY(Random.nextFloat() * 2 * range - range)
            .setDuration(2000).start()
    }

    // ---------------------------------------------------------------- velocímetro e limite da via

    private val speedListener: () -> Unit = { updateSpeed() }
    private val limitListener: () -> Unit = { updateLimit() }

    private fun updateSpeed() {
        val status = SpeedState.status
        if (status != null) speedo.setStatus(status) else speedo.setSpeed(SpeedState.kmh.toFloat())
    }

    /** Limite da via (OpenStreetMap); sem dado da via, usa o alerta escolhido nos ajustes. */
    private fun updateLimit() {
        val road = SpeedLimit.limit
        val fallback = prefs.getInt(Prefs.SPEED_LIMIT, 0)
        val limit = road ?: fallback
        speedo.limit = limit
        roadName.text = SpeedLimit.road ?: ""
        if (limit > 0) {
            limitBadge.visibility = View.VISIBLE
            limitLabel.visibility = View.VISIBLE
            limitBadge.text = limit.toString()
            limitLabel.text = if (road != null) "limite da via" else "seu alerta"
            limitBadge.alpha = if (road != null) 1f else 0.6f
        } else {
            limitBadge.visibility = View.INVISIBLE
            limitLabel.visibility = View.GONE
        }
    }

    private fun chooseLimit() {
        val options = intArrayOf(0, 40, 50, 60, 70, 80, 90, 100, 110, 120)
        val labels = options.map { if (it == 0) "Sem alerta" else "$it km/h" }.toTypedArray()
        val current = options.indexOf(prefs.getInt(Prefs.SPEED_LIMIT, 0)).coerceAtLeast(0)
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Alerta quando a via não tem limite cadastrado")
            .setSingleChoiceItems(labels, current) { d, which ->
                prefs.edit().putInt(Prefs.SPEED_LIMIT, options[which]).apply()
                updateLimit()
                d.dismiss()
            }
            .show()
    }

    private fun hasLocationPermission() = CarService.hasLocationPermission(this)

    // ---------------------------------------------------------------- Waze

    /** Abre o Waze no espaço da direita uma vez por abertura do painel (e quando a tela acende). */
    private fun autoOpenWaze() {
        if (autoOpenedWaze) return
        autoOpenedWaze = true
        openWaze(null)
    }

    private fun freeformSupported(): Boolean {
        if (Build.VERSION.SDK_INT < 24) return false
        return packageManager.hasSystemFeature(PackageManager.FEATURE_FREEFORM_WINDOW_MANAGEMENT) ||
                Settings.Global.getInt(contentResolver, "enable_freeform_support", 0) != 0
    }

    /**
     * Abre o Waze. Se o celular aceitar janelas (pop-up da Samsung / freeform), o Waze
     * abre numa janela exatamente no espaço da direita; senão abre em tela cheia
     * com o painel de música ao lado.
     */
    private fun openWaze(deepLink: String?) {
        val mode = prefs.getInt(Prefs.WAZE_WINDOW, WINDOW_AUTO)
        val useWindow = Build.VERSION.SDK_INT >= 24 &&
                (mode == WINDOW_ALWAYS || (mode == WINDOW_AUTO && freeformSupported()))
        if (!useWindow) {
            startCarMode(deepLink)
            return
        }
        val intent = if (deepLink != null) {
            Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
        } else {
            packageManager.getLaunchIntentForPackage(Launch.WAZE)
        }
        if (intent == null) {
            Launch.openWaze(this, null) // mostra o aviso e abre a loja
            return
        }
        val loc = IntArray(2)
        wazeSlot.getLocationOnScreen(loc)
        val bounds = Rect(loc[0], loc[1], loc[0] + wazeSlot.width, loc[1] + wazeSlot.height)
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent, ActivityOptions.makeBasic().setLaunchBounds(bounds).toBundle())
        } catch (e: Exception) {
            startCarMode(deepLink)
        }
    }

    /**
     * Modo carro: abre o Waze em tela cheia e coloca o painel de música à direita,
     * por cima dele.
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
        if (prefs.getBoolean(Prefs.AUTO_WAZE, true)) {
            autoOpenedWaze = true
            handler.postDelayed({ openWaze(null) }, 800)
        }
    }

    // ---------------------------------------------------------------- música

    private val mediaListener: () -> Unit = {
        media.update()
        updateMusicAppIcon()
    }

    private fun updateMusicAppIcon() {
        val pkg = MediaHub.controller?.packageName ?: Launch.YT_MUSIC
        if (pkg == musicIconPkg) return
        musicIconPkg = pkg
        val icon = appIcon(pkg)
        if (icon != null) musicAppIcon.setImageDrawable(icon) else musicAppIcon.setImageResource(R.drawable.ic_music)
    }

    private fun hasNotificationAccess() = MediaHub.hasAccess(this)

    // ---------------------------------------------------------------- ícones dos apps

    private fun appIcon(pkg: String): Drawable? = try {
        packageManager.getApplicationIcon(pkg)
    } catch (e: Exception) {
        null
    }

    private fun dialerIcon(): Drawable? = try {
        val info = packageManager.resolveActivity(Intent(Intent.ACTION_DIAL), PackageManager.MATCH_DEFAULT_ONLY)
        if (info == null || info.activityInfo.packageName == "android") null else info.loadIcon(packageManager)
    } catch (e: Exception) {
        null
    }

    private fun setRailIcon(view: ImageView, icon: Drawable?, fallback: Int) {
        if (icon != null) {
            view.setImageDrawable(icon)
        } else {
            view.setImageResource(fallback)
            view.setBackgroundResource(R.drawable.bg_tile_dark)
            val pad = (resources.displayMetrics.density * 12).toInt()
            view.setPadding(pad, pad, pad, pad)
        }
    }

    private fun openPhone() {
        if (!Launch.safeStart(this, Intent(Intent.ACTION_DIAL))) {
            Toast.makeText(this, "Telefone não encontrado", Toast.LENGTH_SHORT).show()
        }
    }

    /** Segurar o ícone do Waze: Casa, Trabalho, buscas rápidas e outras opções. */
    private fun showMore() {
        val items = listOf(
            item("Casa") { openWaze("waze://?favorite=home&navigate=yes") },
            item("Trabalho") { openWaze("waze://?favorite=work&navigate=yes") },
            item("Posto de gasolina") { openWaze("waze://?q=" + Uri.encode("posto de gasolina")) },
            item("Restaurante") { openWaze("waze://?q=" + Uri.encode("restaurante")) },
            item("Estacionamento") { openWaze("waze://?q=" + Uri.encode("estacionamento")) },
            item("Farmácia") { openWaze("waze://?q=" + Uri.encode("farmácia")) },
            item("Mercado") { openWaze("waze://?q=" + Uri.encode("supermercado")) },
            item("Waze em tela cheia + música") { startCarMode(null) },
            item("Abrir o Waze no espaço da direita") { openWaze(null) },
            item("Todos os aplicativos") { showApps() },
            item("Ajustes") { showSettings() }
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setItems(items.map { it.first }.toTypedArray()) { _, which -> items[which].second() }
            .show()
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
                    battery.text = if (plugged) "⚡$pct%" else "$pct%"
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

    // ---------------------------------------------------------------- ajustes

    private fun showSettings() {
        fun yn(key: String, default: Boolean) = if (prefs.getBoolean(key, default)) "Sim" else "Não"
        fun ok(v: Boolean) = if (v) "  ✓" else ""
        val windowLabels = arrayOf("Automático", "Sempre em janela", "Tela cheia + painel")
        val limit = prefs.getInt(Prefs.SPEED_LIMIT, 0)
        val actions = listOf(
            item("Permitir controle de música e Waze" + ok(hasNotificationAccess())) { Launch.openNotificationAccess(this) },
            item("Permitir GPS (velocímetro e mapa)" + ok(hasLocationPermission())) { requestLocation() },
            item("Permitir aparecer sobre outros apps" + ok(Launch.canOverlay(this))) { Launch.openOverlaySettings(this) },
            item("Como abrir o Waze: " + windowLabels[prefs.getInt(Prefs.WAZE_WINDOW, WINDOW_AUTO).coerceIn(0, 2)]) { chooseWazeWindow() },
            item("Abrir o Waze sozinho ao ligar o painel: " + yn(Prefs.AUTO_WAZE, true)) { toggle(Prefs.AUTO_WAZE, true) },
            item("Alerta quando a via não tem limite: " + if (limit > 0) "$limit km/h" else "Desligado") { chooseLimit() },
            item("Ligar a tela quando o carro andar: " + yn(Prefs.WAKE_ON_MOVE, true)) { toggle(Prefs.WAKE_ON_MOVE, true) },
            item("Ligar a tela ao conectar o carregador: " + yn(Prefs.WAKE_ON_POWER, true)) { toggle(Prefs.WAKE_ON_POWER, true) },
            item("Tela sempre ligada no carregador: " + yn(Prefs.KEEP_ON, true)) {
                toggle(Prefs.KEEP_ON, true)
                applyKeepScreenOn()
            },
            item("Modo relógio: " + idleLabel(prefs.getInt(Prefs.IDLE, 0))) { chooseIdle() },
            item("Usar como tela inicial do celular") {
                if (!Launch.safeStart(this, Intent(Settings.ACTION_HOME_SETTINGS))) {
                    Launch.safeStart(this, Intent(Settings.ACTION_SETTINGS))
                }
            },
            item("Liberar configurações restritas (Android 13+)") { Launch.openAppDetails(this, packageName) },
            item("Configurações do Android") { Launch.safeStart(this, Intent(Settings.ACTION_SETTINGS)) }
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Ajustes")
            .setItems(actions.map { it.first }.toTypedArray()) { _, which -> actions[which].second() }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun item(label: String, action: () -> Unit) = label to action

    private fun toggle(key: String, default: Boolean) {
        prefs.edit().putBoolean(key, !prefs.getBoolean(key, default)).apply()
    }

    private fun chooseWazeWindow() {
        val labels = arrayOf(
            "Automático (janela se o celular permitir)",
            "Sempre em janela sobre o mapa",
            "Tela cheia com painel de música"
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Como abrir o Waze")
            .setSingleChoiceItems(labels, prefs.getInt(Prefs.WAZE_WINDOW, WINDOW_AUTO).coerceIn(0, 2)) { d, which ->
                prefs.edit().putInt(Prefs.WAZE_WINDOW, which).apply()
                d.dismiss()
            }
            .show()
    }

    private fun idleLabel(secs: Int) = when {
        secs <= 0 -> "Nunca"
        secs < 60 -> "$secs s"
        else -> "${secs / 60} min"
    }

    private fun chooseIdle() {
        val options = intArrayOf(0, 30, 60, 120, 300)
        val labels = options.map { idleLabel(it) }.toTypedArray()
        val current = options.indexOf(prefs.getInt(Prefs.IDLE, 0)).coerceAtLeast(0)
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Mostrar relógio grande depois de")
            .setSingleChoiceItems(labels, current) { d, which ->
                prefs.edit().putInt(Prefs.IDLE, options[which]).apply()
                scheduleIdle()
                d.dismiss()
            }
            .show()
    }

    private fun askPermissionsFirstRun() {
        if (!hasLocationPermission()) {
            askedSomething = true
            requestLocation()
        }
        if (!hasNotificationAccess() && !prefs.getBoolean(Prefs.ASKED_NOTIF, false)) {
            prefs.edit().putBoolean(Prefs.ASKED_NOTIF, true).apply()
            askedSomething = true
            AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Controle de música")
                .setMessage(
                    "Para mostrar a música do YouTube Music (capa, nome, tempo), controlar " +
                            "play/pause e exibir as instruções do Waze, permita o acesso às " +
                            "notificações para o \"Painel do Carro\" na próxima tela.\n\n" +
                            "Se a opção estiver bloqueada (Android 13+/Samsung): toque em " +
                            "\"Liberar\", depois no menu ⋮ e em \"Permitir configurações restritas\"."
                )
                .setNeutralButton("Liberar") { _, _ -> Launch.openAppDetails(this, packageName) }
                .setPositiveButton("Permitir") { _, _ -> Launch.openNotificationAccess(this) }
                .setNegativeButton("Agora não", null)
                .show()
        }
        if (!Launch.canOverlay(this) && !prefs.getBoolean(Prefs.ASKED_OVERLAY, false)) {
            prefs.edit().putBoolean(Prefs.ASKED_OVERLAY, true).apply()
            askedSomething = true
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

    companion object {
        const val EXTRA_WAKE = "wake"
        const val REQ_LOCATION = 1
        const val WINDOW_AUTO = 0
        const val WINDOW_ALWAYS = 1
    }
}
