package com.edson.carlauncher.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.edson.carlauncher.R

/** Inter (SIL Open Font License, incluída em assets/licenses). */
val Inter = FontFamily(
    Font(R.font.inter_light, FontWeight.Light),
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold)
)

/** Inter Display: desenhada para números grandes (velocímetro). */
val InterDisplay = FontFamily(Font(R.font.inter_display_light, FontWeight.Light))

/** Tamanhos de referência (máximos); os componentes reduzem conforme o espaço. */
object DriveType {
    val speedNumber = TextStyle(fontFamily = InterDisplay, fontWeight = FontWeight.Light, fontSize = 112.sp)
    val speedUnit = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 26.sp, color = TextSecondary)
    val musicTitle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 28.sp, color = TextPrimary)
    val musicArtist = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 19.sp, color = TextSecondary)
    val musicTime = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = TextSecondary)
    val sidebarTime = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 24.sp, color = TextPrimary)
    val sidebarNetwork = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary)
    val settingsTitle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = TextPrimary)
    val settingsText = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 16.sp, color = TextPrimary)
    val caption = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextSecondary)
}

val DriveTypography = Typography(
    titleLarge = DriveType.settingsTitle,
    bodyLarge = DriveType.settingsText,
    bodyMedium = DriveType.settingsText.copy(fontSize = 14.sp),
    labelLarge = DriveType.settingsText.copy(fontWeight = FontWeight.Medium)
)
