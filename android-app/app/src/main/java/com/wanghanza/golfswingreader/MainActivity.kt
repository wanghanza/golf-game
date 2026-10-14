package com.wanghanza.golfswingreader

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var sensors: SensorStreamer
    private lateinit var assetServer: AssetServer

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView = WebView(this)
        setContentView(webView)
        hideSystemBars()

        assetServer = AssetServer(assets)
        sensors = SensorStreamer(
            this,
            sink = { json -> webView.evaluateJavascript("window.__golfSensorBatch&&window.__golfSensorBatch($json)", null) },
            status = { s -> sendStatus(s) },
        )
        val exporter = FileExporter(this)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
        }
        webView.addJavascriptInterface(NativeBridge(this, sensors, exporter), "GolfNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetServer.handle(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != AssetServer.HOST
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("GolfWeb", "${m.messageLevel()} ${m.sourceId()}:${m.lineNumber()} ${m.message()}")
                return true
            }
        }
        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(AssetServer.START_URL)
    }

    private fun sendStatus(s: JSONObject) {
        webView.evaluateJavascript("window.__golfSensorStatus&&window.__golfSensorStatus(${JSONObject.quote(s.toString())})", null)
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        sensors.pauseForLifecycle()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        sensors.resumeFromLifecycle()
    }

    override fun onDestroy() {
        sensors.stop()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity back handling; the web app decides whether to go back a screen")
    override fun onBackPressed() {
        webView.evaluateJavascript("window.__golfBack ? window.__golfBack() : false") { result ->
            if (result != "true") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }
}
