package com.edson.carlauncher

import android.content.Context
import android.util.AttributeSet
import android.widget.ImageView

/** ImageView sempre quadrada, do tamanho do menor lado disponível (capa do álbum). */
class SquareImageView(context: Context, attrs: AttributeSet?) : ImageView(context, attrs) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        val size = minOf(measuredWidth, measuredHeight)
        setMeasuredDimension(size, size)
    }
}
