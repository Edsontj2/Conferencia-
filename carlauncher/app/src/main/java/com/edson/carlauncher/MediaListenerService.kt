package com.edson.carlauncher

import android.app.Notification
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Acesso às notificações. Serve para duas coisas:
 *  - liberar o MediaSessionManager (controlar o YouTube Music e ler a música/capa);
 *  - ler a notificação de navegação do Waze (próxima manobra) e mostrar no painel.
 */
class MediaListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        try {
            activeNotifications?.forEach { handle(it) }
        } catch (_: Exception) {
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        handle(sbn)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (sbn.key == NavState.key) NavState.clear()
    }

    private fun handle(sbn: StatusBarNotification) {
        if (sbn.packageName !in NAV_PACKAGES) return
        val n = sbn.notification ?: return
        // Só a notificação fixa (ongoing) é a da rota ativa.
        if (n.flags and Notification.FLAG_ONGOING_EVENT == 0) return

        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = ex.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
        val line2 = listOfNotNull(text, sub).filter { it.isNotBlank() }.joinToString(" • ")

        NavState.update(sbn.key, title, line2.ifBlank { null }, largeIcon(n))
    }

    @Suppress("DEPRECATION")
    private fun largeIcon(n: Notification): Drawable? = try {
        if (Build.VERSION.SDK_INT >= 23) {
            n.getLargeIcon()?.loadDrawable(this)
        } else {
            n.largeIcon?.let { BitmapDrawable(resources, it) }
        }
    } catch (_: Exception) {
        null
    }

    companion object {
        val NAV_PACKAGES = setOf("com.waze", "com.google.android.apps.maps")
    }
}

/** Estado atual da navegação, compartilhado entre o serviço e a tela. */
object NavState {
    var key: String? = null
        private set
    var title: String? = null
        private set
    var text: String? = null
        private set
    var icon: Drawable? = null
        private set
    val active get() = key != null

    private val listeners = mutableSetOf<() -> Unit>()

    fun update(key: String, title: String?, text: String?, icon: Drawable?) {
        this.key = key
        this.title = title
        this.text = text
        this.icon = icon
        notifyListeners()
    }

    fun clear() {
        key = null
        title = null
        text = null
        icon = null
        notifyListeners()
    }

    fun addListener(l: () -> Unit) = listeners.add(l)
    fun removeListener(l: () -> Unit) = listeners.remove(l)

    private fun notifyListeners() = listeners.toList().forEach { it() }
}
