package com.edson.carlauncher.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

object DriveShapes {
    val card = RoundedCornerShape(28.dp)
    val sidebar = RoundedCornerShape(28.dp)
    val bigButton = RoundedCornerShape(20.dp)
    val sidebarIcon = RoundedCornerShape(16.dp)
    val albumArt = RoundedCornerShape(20.dp)
}

/** Escala de espaçamento (base 4dp). */
object Space {
    val XS = 4.dp
    val SM = 8.dp
    val MD = 12.dp
    val LG = 16.dp
    val XL = 20.dp
    val XXL = 24.dp
    val XXXL = 32.dp

    val outer = XL
    val cardGap = LG
    val cardPadding = XXL
}
