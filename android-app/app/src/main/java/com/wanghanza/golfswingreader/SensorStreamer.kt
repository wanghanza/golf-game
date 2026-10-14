package com.wanghanza.golfswingreader

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Streams accelerometer + gyroscope at the requested rate on a background
 * thread and delivers batches of samples to [sink] on the main thread.
 */
class SensorStreamer(
    context: Context,
    private val sink: (String) -> Unit,
    private val status: (JSONObject) -> Unit,
) : SensorEventListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accel: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyro: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val assembler = SampleAssembler()
    private val pending = ArrayList<DoubleArray>(64)
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private var thread: HandlerThread? = null
    private var periodUs = 5000
    private var accelEvents = 0L
    private var gyroEvents = 0L

    @Volatile
    var running = false
        private set

    /** True while sensors are paused because the activity is in the background. */
    private var pausedByLifecycle = false

    private val flushTask = object : Runnable {
        override fun run() {
            if (!running) return
            val batch: List<DoubleArray>
            synchronized(lock) {
                batch = ArrayList(pending)
                pending.clear()
            }
            if (batch.isNotEmpty()) sink(SampleAssembler.toJsonArray(batch))
            main.postDelayed(this, FLUSH_MS)
        }
    }

    fun hasRequiredSensors() = accel != null && gyro != null

    fun start(requestedPeriodUs: Int): Boolean {
        if (!hasRequiredSensors()) {
            status(JSONObject().put("error", "accelerometer or gyroscope missing"))
            return false
        }
        if (running) return true
        periodUs = requestedPeriodUs.coerceIn(2500, 20000)
        assembler.reset()
        synchronized(lock) { pending.clear() }
        val t = HandlerThread("sensor-stream").also { it.start() }
        thread = t
        val handler = Handler(t.looper)
        val okA = sensorManager.registerListener(this, accel, periodUs, handler)
        val okG = sensorManager.registerListener(this, gyro, periodUs, handler)
        if (!okA || !okG) {
            sensorManager.unregisterListener(this)
            t.quitSafely()
            thread = null
            status(JSONObject().put("error", "registerListener failed"))
            return false
        }
        running = true
        main.postDelayed(flushTask, FLUSH_MS)
        return true
    }

    fun stop() {
        if (!running) return
        running = false
        sensorManager.unregisterListener(this)
        thread?.quitSafely()
        thread = null
        main.removeCallbacks(flushTask)
    }

    fun pauseForLifecycle() {
        if (running) {
            stop()
            pausedByLifecycle = true
        }
    }

    fun resumeFromLifecycle() {
        if (pausedByLifecycle) {
            pausedByLifecycle = false
            start(periodUs)
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val v = event.values
        if (v.size < 3) return
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                accelEvents++
                assembler.onAccel(event.timestamp, v[0], v[1], v[2])
            }
            Sensor.TYPE_GYROSCOPE -> {
                gyroEvents++
                val s = assembler.onGyro(event.timestamp, v[0], v[1], v[2]) ?: return
                synchronized(lock) {
                    if (pending.size < MAX_PENDING) pending.add(s)
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        main.post {
            status(JSONObject().put("accuracy", accuracy).put("sensor", sensor.name))
        }
    }

    fun info(): JSONObject {
        val arr = JSONArray()
        fun add(type: String, s: Sensor?) {
            if (s == null) {
                arr.put(JSONObject().put("type", type).put("name", "없음").put("vendor", "-"))
                return
            }
            arr.put(
                JSONObject()
                    .put("type", type)
                    .put("name", s.name)
                    .put("vendor", s.vendor)
                    .put("maxRange", s.maximumRange.toDouble())
                    .put("resolution", s.resolution.toDouble())
                    .put("minDelayUs", s.minDelay)
                    .put("power_mA", s.power.toDouble()),
            )
        }
        add("accelerometer (m/s^2)", accel)
        add("gyroscope (rad/s)", gyro)
        return JSONObject()
            .put("source", "android.hardware.SensorManager")
            .put("sensors", arr)
            .put("requestedPeriodUs", periodUs)
            .put("running", running)
            .put("accelEvents", accelEvents)
            .put("gyroEvents", gyroEvents)
    }

    companion object {
        private const val FLUSH_MS = 40L
        private const val MAX_PENDING = 2000
    }
}
