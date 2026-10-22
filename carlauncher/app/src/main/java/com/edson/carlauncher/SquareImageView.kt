package com.edson.carlauncher

import android.content.Context
import android.util.AttributeSet
import android.view.View.MeasureSpec
import android.widget.ImageView

/** ImageView sempre quadrada, do tamanho do menor lado disponível (capa do álbum). */
class SquareImageView(context: Context, attrs: AttributeSet?) : ImageView(context, attrs) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = MeasureSpec.getSize(heightMeasureSpec)
        val wMode = MeasureSpec.getMode(widthMeasureSpec)
        val hMode = MeasureSpec.getMode(heightMeasureSpec)
        val size = when {
            wMode == MeasureSpec.UNSPECIFIED -> h
            hMode == MeasureSpec.UNSPECIFIED -> w
            else -> minOf(w, h)
        }
        setMeasuredDimension(size, size)
    }
}
