package com.edson.carlauncher

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast

/** Atalhos para abrir outros apps e telas do sistema (usados pela tela e pelo serviço). */
object Launch {
    const val WAZE = "com.waze"
    const val YT_MUSIC = "com.google.android.apps.youtube.music"

    fun safeStart(ctx: Context, intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
    } catch (e: Exception) {
        false
    }

    fun openWaze(ctx: Context, deepLink: String?): Boolean {
        try {
            val intent = if (deepLink != null) {
                Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
            } else {
                ctx.packageManager.getLaunchIntentForPackage(WAZE) ?: throw ActivityNotFoundException()
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            return true
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(ctx, "Waze não encontrado", Toast.LENGTH_SHORT).show()
            openStore(ctx, WAZE)
            return false
        }
    }

    fun openYtMusic(ctx: Context) {
        val intent = ctx.packageManager.getLaunchIntentForPackage(YT_MUSIC)
        if (intent == null) {
            Toast.makeText(ctx, "YouTube Music não encontrado", Toast.LENGTH_SHORT).show()
            openStore(ctx, YT_MUSIC)
            return
        }
        safeStart(ctx, intent)
    }

    fun openStore(ctx: Context, pkg: String) {
        if (!safeStart(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))) {
            safeStart(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")))
        }
    }

    fun openNotificationAccess(ctx: Context) {
        if (!safeStart(ctx, Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))) {
            safeStart(ctx, Intent(Settings.ACTION_SETTINGS))
        }
    }

    fun canOverlay(ctx: Context) = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)

    fun openOverlaySettings(ctx: Context) {
        if (Build.VERSION.SDK_INT < 23 ||
            !safeStart(ctx, Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName)))
        ) {
            openAppDetails(ctx, ctx.packageName)
        }
    }

    fun openAppDetails(ctx: Context, pkg: String) {
        safeStart(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
    }
}
