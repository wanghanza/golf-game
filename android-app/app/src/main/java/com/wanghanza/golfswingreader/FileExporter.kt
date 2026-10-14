package com.wanghanza.golfswingreader

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * Saves exported recordings.
 *
 * Every file is written to the app-specific external directory
 * (Android/data/<package>/files/recordings), which needs no permission.
 * On Android 10+ a copy also goes to Downloads/GolfSwingReader through
 * MediaStore so it is visible in the Files app and can be shared.
 */
class FileExporter(private val context: Context) {
    private val shareable = LinkedHashMap<String, Uri>()

    fun save(rawName: String, mime: String, content: String): String {
        val name = sanitize(rawName)
        val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "recordings")
        if (!dir.exists() && !dir.mkdirs()) return "ERROR: cannot create ${dir.absolutePath}"
        val file = File(dir, name)
        file.writeText(content, Charsets.UTF_8)
        var location = file.absolutePath
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val uri = saveToDownloads(name, mime, content)
            if (uri != null) {
                shareable[name] = uri
                location = "Download/$SUBDIR/$name"
            }
        }
        return location
    }

    private fun saveToDownloads(name: String, mime: String, content: String): Uri? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$SUBDIR")
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            uri
        } catch (e: Exception) {
            null
        }
    }

    /** Opens the system share sheet for previously saved files (Android 10+). */
    fun share(names: List<String>): Boolean {
        val uris = ArrayList(names.mapNotNull { shareable[sanitize(it)] })
        if (uris.isEmpty()) return false
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(intent, "스윙 기록 공유").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
        return true
    }

    companion object {
        const val SUBDIR = "GolfSwingReader"

        fun sanitize(name: String): String {
            val cleaned = name.replace(Regex("[^A-Za-z0-9._-]"), "_").trim('.', '_')
            return cleaned.ifEmpty { "recording.txt" }.take(120)
        }
    }
}
