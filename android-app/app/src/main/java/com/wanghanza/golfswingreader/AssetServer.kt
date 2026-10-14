package com.wanghanza.golfswingreader

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.IOException

/**
 * Serves files from the APK assets under https://appassets.androidplatform.net/
 * (the same scheme androidx.webkit's WebViewAssetLoader uses), so the web game
 * runs from a secure origin: ES modules, IndexedDB and localStorage all work,
 * and no file:// access is needed.
 */
class AssetServer(private val assets: AssetManager) {
    fun handle(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "https" || uri.host != HOST) return null
        val path = uri.path?.trimStart('/') ?: return null
        if (path.contains("..")) return null
        val assetPath = if (path.isEmpty() || path.endsWith("/")) "${path}index.html" else path
        return try {
            val stream = assets.open(assetPath)
            WebResourceResponse(mimeType(assetPath), if (isText(assetPath)) "utf-8" else null, stream)
        } catch (e: IOException) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
        }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$HOST/web/index.html"

        fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "wasm" -> "application/wasm"
            "csv" -> "text/csv"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }

        private fun isText(path: String) = mimeType(path).let { it.startsWith("text/") || it == "application/json" || it == "image/svg+xml" }
    }
}
