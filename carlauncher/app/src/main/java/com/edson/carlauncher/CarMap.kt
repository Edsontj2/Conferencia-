package com.edson.carlauncher

import android.content.Context
import android.view.ViewGroup
import android.widget.FrameLayout
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import java.io.File

/**
 * Mapa escuro (OpenStreetMap / CARTO) que acompanha a posição do GPS.
 * A seta da posição é desenhada por cima, no centro (o mapa anda, a seta fica parada).
 */
class CarMap(context: Context, host: FrameLayout) {

    private val map: MapView
    private var zoom = 17.0
    private var centered = false

    /** true: o mapa gira para a direção do carro; false: norte sempre para cima. */
    var headingUp = true
        set(value) {
            field = value
            if (!value) map.mapOrientation = 0f
            update()
        }

    init {
        val cfg = Configuration.getInstance()
        cfg.setUserAgentValue(context.packageName)
        val base = File(context.cacheDir, "osmdroid")
        cfg.setOsmdroidBasePath(base)
        cfg.setOsmdroidTileCache(File(base, "tiles"))

        map = MapView(context)
        map.setTileSource(DARK_TILES)
        map.setMultiTouchControls(true)
        map.zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
        map.setTilesScaledToDpi(true)
        map.controller.setZoom(zoom)
        // Começa no Brasil até chegar o primeiro sinal de GPS
        map.controller.setCenter(GeoPoint(-15.78, -47.93))
        host.addView(
            map,
            0,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
    }

    fun onResume() = map.onResume()
    fun onPause() = map.onPause()

    fun zoomIn() {
        zoom = (zoom + 1).coerceAtMost(19.0)
        map.controller.zoomTo(zoom)
    }

    fun zoomOut() {
        zoom = (zoom - 1).coerceAtLeast(5.0)
        map.controller.zoomTo(zoom)
    }

    /** Recentraliza no GPS (chamado a cada nova posição). */
    fun update() {
        if (!SpeedState.hasLocation) return
        val p = GeoPoint(SpeedState.lat, SpeedState.lon)
        if (!centered) {
            map.controller.setZoom(zoom)
            map.controller.setCenter(p)
            centered = true
        } else {
            map.controller.animateTo(p)
        }
        if (headingUp) map.mapOrientation = -SpeedState.bearing
    }

    /** Rotação da seta da posição na tela. */
    fun arrowRotation(): Float = if (headingUp) 0f else SpeedState.bearing

    companion object {
        private val DARK_TILES = XYTileSource(
            "CartoDark", 3, 19, 256, ".png",
            arrayOf(
                "https://a.basemaps.cartocdn.com/dark_all/",
                "https://b.basemaps.cartocdn.com/dark_all/",
                "https://c.basemaps.cartocdn.com/dark_all/"
            )
        )
    }
}
