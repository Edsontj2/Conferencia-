package com.edson.carlauncher

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Limite de velocidade da via atual, consultado no OpenStreetMap (Overpass API, grátis e sem chave).
 * Pega a rua mais próxima do GPS e lê a etiqueta "maxspeed". Se a rua não tiver o limite
 * cadastrado, [limit] fica nulo (melhor não mostrar nada do que mostrar um número errado).
 */
object SpeedLimit {
    var limit: Int? = null
        private set
    var road: String? = null
        private set

    private val listeners = LinkedHashSet<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()

    private var busy = false
    private var lastQueryAt = 0L
    private var lastLat = 0.0
    private var lastLon = 0.0
    private var failures = 0

    fun addListener(l: () -> Unit) = listeners.add(l)
    fun removeListener(l: () -> Unit) = listeners.remove(l)

    /** Chamado a cada posição do GPS (na thread principal). */
    fun onLocation(lat: Double, lon: Double, kmh: Int) {
        if (busy) return
        val now = SystemClock.elapsedRealtime()
        val first = lastQueryAt == 0L
        val wait = if (failures > 0) 30_000L else MIN_INTERVAL_MS
        if (!first && now - lastQueryAt < wait) return
        // Parado no mesmo lugar não precisa perguntar de novo
        if (!first && distanceM(lat, lon, lastLat, lastLon) < MIN_MOVE_M) return
        if (!first && kmh < 3 && limit != null) return

        busy = true
        lastQueryAt = now
        lastLat = lat
        lastLon = lon
        worker.execute {
            val result = try {
                query(lat, lon)
            } catch (e: Exception) {
                null
            }
            main.post {
                busy = false
                if (result == null) {
                    failures++
                } else {
                    failures = 0
                    limit = result.first
                    road = result.second
                    listeners.toList().forEach { it() }
                }
            }
        }
    }

    /** Retorna (limite, nome da rua) da via mais próxima; limite nulo se não cadastrado. */
    private fun query(lat: Double, lon: Double): Pair<Int?, String?>? {
        val q = "[out:json][timeout:8];" +
                "way(around:$RADIUS_M,$lat,$lon)[highway]" +
                "[highway!~\"^(footway|cycleway|path|steps|pedestrian|track|bridleway|corridor|platform|proposed|construction)$\"];" +
                "out tags geom;"
        val body = "data=" + URLEncoder.encode(q, "UTF-8")
        var json: String? = null
        for (endpoint in ENDPOINTS) {
            json = post(endpoint, body)
            if (json != null) break
        }
        if (json == null) return null

        val elements = JSONObject(json).optJSONArray("elements") ?: return Pair(null, null)
        var bestDist = Double.MAX_VALUE
        var bestTags: JSONObject? = null
        for (i in 0 until elements.length()) {
            val el = elements.getJSONObject(i)
            val geom = el.optJSONArray("geometry") ?: continue
            var d = Double.MAX_VALUE
            for (j in 0 until geom.length() - 1) {
                val a = geom.getJSONObject(j)
                val b = geom.getJSONObject(j + 1)
                d = minOf(d, segmentDistanceM(lat, lon, a.getDouble("lat"), a.getDouble("lon"), b.getDouble("lat"), b.getDouble("lon")))
            }
            if (d < bestDist) {
                bestDist = d
                bestTags = el.optJSONObject("tags")
            }
        }
        val tags = bestTags ?: return Pair(null, null)
        val raw = tags.optString("maxspeed").ifEmpty { tags.optString("maxspeed:forward") }
        val name = tags.optString("name").ifEmpty { tags.optString("ref") }.ifEmpty { null }
        return Pair(parseMaxspeed(raw), name)
    }

    private fun post(endpoint: String, body: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(endpoint).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 10000
            conn.doOutput = true
            conn.setRequestProperty("User-Agent", "PainelDoCarro/1.0 (Android)")
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            conn.outputStream.use { it.write(body.toByteArray()) }
            if (conn.responseCode != 200) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    /** "60", "60 km/h", "40 mph" → km/h. Outros valores ("signals", "BR:urban"...) → nulo. */
    private fun parseMaxspeed(raw: String): Int? {
        val m = Regex("^\\s*(\\d+)\\s*(mph)?").find(raw) ?: return null
        val n = m.groupValues[1].toIntOrNull() ?: return null
        val kmh = if (m.groupValues[2].isNotEmpty()) Math.round(n * 1.609f) else n
        return kmh.takeIf { it in 5..200 }
    }

    // Distâncias aproximadas (projeção plana local, suficiente para poucos metros)
    private fun distanceM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val k = cos(Math.toRadians(lat1))
        val dx = (lon2 - lon1) * k * M_PER_DEG
        val dy = (lat2 - lat1) * M_PER_DEG
        return sqrt(dx * dx + dy * dy)
    }

    private fun segmentDistanceM(
        lat: Double, lon: Double,
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val k = cos(Math.toRadians(lat))
        val px = 0.0
        val py = 0.0
        val ax = (lon1 - lon) * k * M_PER_DEG
        val ay = (lat1 - lat) * M_PER_DEG
        val bx = (lon2 - lon) * k * M_PER_DEG
        val by = (lat2 - lat) * M_PER_DEG
        val dx = bx - ax
        val dy = by - ay
        val len2 = dx * dx + dy * dy
        val t = if (len2 == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / len2).coerceIn(0.0, 1.0)
        val cx = ax + t * dx
        val cy = ay + t * dy
        return sqrt(cx * cx + cy * cy)
    }

    private const val M_PER_DEG = 111_320.0
    private const val RADIUS_M = 30
    private const val MIN_INTERVAL_MS = 10_000L
    private const val MIN_MOVE_M = 60.0
    private val ENDPOINTS = listOf(
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    )
}
