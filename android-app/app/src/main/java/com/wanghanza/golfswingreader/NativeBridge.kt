package com.wanghanza.golfswingreader

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Methods exposed to the web game as `window.GolfNative`.
 * Called on a WebView binder thread: UI work is posted to the main thread.
 */
class NativeBridge(
    private val activity: Activity,
    private val sensors: SensorStreamer,
    private val exporter: FileExporter,
) {
    @JavascriptInterface
    fun getDeviceInfo(): String = JSONObject()
        .put("platform", "android")
        .put("manufacturer", Build.MANUFACTURER)
        .put("model", Build.MODEL)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("release", Build.VERSION.RELEASE)
        .put("app", BuildInfo.versionName(activity))
        .toString()

    @JavascriptInterface
    fun getSensorInfo(): String = sensors.info().toString()

    @JavascriptInterface
    fun startSensors(periodUs: Int): Boolean {
        var ok = false
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            ok = try {
                sensors.start(periodUs)
            } catch (e: Exception) {
                false
            }
            latch.countDown()
        }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return ok
    }

    @JavascriptInterface
    fun stopSensors() {
        activity.runOnUiThread { sensors.stop() }
    }

    @JavascriptInterface
    fun saveTextFile(name: String, mime: String, content: String): String = try {
        exporter.save(name, mime, content)
    } catch (e: Exception) {
        "ERROR: ${e.message}"
    }

    @JavascriptInterface
    fun shareFiles(namesJson: String) {
        val arr = try {
            JSONArray(namesJson)
        } catch (e: Exception) {
            return
        }
        val names = (0 until arr.length()).map { arr.optString(it) }
        activity.runOnUiThread {
            try {
                exporter.share(names)
            } catch (e: Exception) {
                // Sharing is optional; the files are already saved.
            }
        }
    }

    @JavascriptInterface
    fun vibrate(ms: Int) {
        val duration = ms.coerceIn(1, 500).toLong()
        try {
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            vibrator?.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (e: Exception) {
            // Vibration is cosmetic.
        }
    }

    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) {
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}

object BuildInfo {
    fun versionName(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }
}
