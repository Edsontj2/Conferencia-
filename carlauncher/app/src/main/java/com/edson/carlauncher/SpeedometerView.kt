package com.edson.carlauncher

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Velocímetro em arco (270°) com o número grande no centro. */
class SpeedometerView(context: Context, attrs: AttributeSet?) : View(context, attrs) {

    private val maxSpeed = 160f
    private var shown = 0f
    private var status: String? = "Procurando GPS…"
    private var animator: ValueAnimator? = null

    private val accent = colorRes(R.color.accent)
    private val warn = Color.parseColor("#FFFFA726")

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = colorRes(R.color.track)
    }
    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = accent
    }
    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = colorRes(R.color.text_dim)
    }
    private val numberPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
    }
    private val unitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorRes(R.color.text_dim)
        textAlign = Paint.Align.CENTER
    }
    private val rect = RectF()

    @Suppress("DEPRECATION")
    private fun colorRes(id: Int): Int = resources.getColor(id)

    fun setSpeed(kmh: Float) {
        status = null
        animator?.cancel()
        animator = ValueAnimator.ofFloat(shown, kmh.coerceIn(0f, 300f)).apply {
            duration = 700
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                shown = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    fun setStatus(text: String) {
        status = text
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val w = width - paddingLeft - paddingRight
        val h = height - paddingTop - paddingBottom
        if (w <= 0 || h <= 0) return

        // O arco de 270° ocupa (1 + sen45°) do raio na vertical.
        val stroke = min(w, h) * 0.075f
        val radius = min(w / 2f, h / 1.72f) - stroke
        if (radius <= 0) return
        val cx = paddingLeft + w / 2f
        val usedH = radius * 1.707f + stroke
        val cy = paddingTop + (h - usedH) / 2f + stroke / 2f + radius

        trackPaint.strokeWidth = stroke
        arcPaint.strokeWidth = stroke
        rect.set(cx - radius, cy - radius, cx + radius, cy + radius)

        canvas.drawArc(rect, 135f, 270f, false, trackPaint)
        val fraction = (shown / maxSpeed).coerceIn(0f, 1f)
        if (fraction > 0.003f) {
            arcPaint.color = if (shown > 110f) warn else accent
            canvas.drawArc(rect, 135f, 270f * fraction, false, arcPaint)
        }

        // Marcas a cada 20 km/h
        tickPaint.strokeWidth = stroke * 0.12f
        val inner = radius - stroke * 1.1f
        val outer = radius - stroke * 0.75f
        for (i in 0..8) {
            val a = Math.toRadians(135.0 + 270.0 * i / 8.0)
            val c = cos(a).toFloat()
            val s = sin(a).toFloat()
            canvas.drawLine(cx + c * inner, cy + s * inner, cx + c * outer, cy + s * outer, tickPaint)
        }

        numberPaint.textSize = radius * 0.78f
        canvas.drawText(shown.roundToInt().toString(), cx, cy + numberPaint.textSize * 0.30f, numberPaint)

        unitPaint.textSize = radius * 0.17f
        canvas.drawText(status ?: "km/h", cx, cy + radius * 0.62f, unitPaint)
    }
}
