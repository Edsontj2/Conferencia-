package com.edson.carlauncher.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.edson.carlauncher.R
import com.edson.carlauncher.ui.components.DriveIconButton
import com.edson.carlauncher.ui.theme.DriveShapes
import com.edson.carlauncher.ui.theme.DriveType
import com.edson.carlauncher.ui.theme.SidebarIconSurface
import com.edson.carlauncher.ui.theme.Space
import com.edson.carlauncher.ui.theme.TextPrimary
import com.edson.carlauncher.viewmodel.AppEntry
import com.edson.carlauncher.viewmodel.AppsViewModel

/** Gaveta de aplicativos (toque abre, segurar abre os detalhes do app). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AppsScreen(
    vm: AppsViewModel,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onLaunch: (AppEntry) -> Unit,
    onDetails: (AppEntry) -> Unit
) {
    val apps by vm.apps.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }

    Column(
        Modifier
            .fillMaxSize()
            .driveBackground()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = Space.outer, vertical = Space.LG)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DriveIconButton(onClick = onBack, size = 52.dp, background = SidebarIconSurface, contentDescription = "Voltar") {
                Icon(painterResource(R.drawable.ic_back), null, tint = TextPrimary, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(Space.LG))
            Text("Aplicativos", style = DriveType.settingsTitle.copy(fontSize = DriveType.settingsTitle.fontSize * 1.2f), modifier = Modifier.weight(1f))
            DriveIconButton(onClick = onSettings, size = 52.dp, background = SidebarIconSurface, contentDescription = "Ajustes") {
                Icon(painterResource(R.drawable.ic_settings), null, tint = TextPrimary, modifier = Modifier.size(26.dp))
            }
        }
        Spacer(Modifier.height(Space.LG))
        LazyVerticalGrid(
            columns = GridCells.Adaptive(112.dp),
            verticalArrangement = Arrangement.spacedBy(Space.SM),
            horizontalArrangement = Arrangement.spacedBy(Space.SM),
            contentPadding = PaddingValues(bottom = Space.XXL)
        ) {
            items(apps, key = { it.packageName + "/" + it.activity }) { app ->
                Column(
                    Modifier
                        .clip(DriveShapes.bigButton)
                        .combinedClickable(onClick = { onLaunch(app) }, onLongClick = { onDetails(app) })
                        .padding(Space.SM),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Image(app.icon, app.label, Modifier.size(60.dp))
                    Spacer(Modifier.height(Space.SM))
                    Text(
                        app.label,
                        style = DriveType.caption.copy(color = TextPrimary, fontSize = 13.sp),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
    }
}
