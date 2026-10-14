package com.wanghanza.golfswingreader

/**
 * Pairs accelerometer and gyroscope events into 6-axis samples.
 *
 * One sample is emitted per gyroscope event. The accelerometer value is
 * linearly interpolated to the gyroscope timestamp when the gyro event lies
 * between two accelerometer events, otherwise the latest accelerometer value
 * is used. Timestamps are converted from nanoseconds to seconds relative to
 * the first sample ever emitted, so time keeps increasing across stop/start.
 *
 * Pure Kotlin (no Android types) so it can be unit tested on the JVM.
 */
class SampleAssembler {
    private var prevAccT = Long.MIN_VALUE
    private val prevAcc = FloatArray(3)
    private var lastAccT = Long.MIN_VALUE
    private val lastAcc = FloatArray(3)
    private var t0 = Long.MIN_VALUE

    var emitted = 0L
        private set

    /** Forget the accelerometer state (e.g. after a restart). The time origin is kept. */
    fun reset() {
        prevAccT = Long.MIN_VALUE
        lastAccT = Long.MIN_VALUE
    }

    fun onAccel(timestampNs: Long, x: Float, y: Float, z: Float) {
        if (lastAccT != Long.MIN_VALUE) {
            prevAccT = lastAccT
            prevAcc[0] = lastAcc[0]; prevAcc[1] = lastAcc[1]; prevAcc[2] = lastAcc[2]
        }
        lastAccT = timestampNs
        lastAcc[0] = x; lastAcc[1] = y; lastAcc[2] = z
    }

    /**
     * @return [t, ax, ay, az, gx, gy, gz] or null if no accelerometer value is known yet.
     */
    fun onGyro(timestampNs: Long, x: Float, y: Float, z: Float): DoubleArray? {
        if (lastAccT == Long.MIN_VALUE) return null
        if (t0 == Long.MIN_VALUE) t0 = timestampNs
        val ax: Double
        val ay: Double
        val az: Double
        if (prevAccT != Long.MIN_VALUE && timestampNs in prevAccT..lastAccT && lastAccT > prevAccT) {
            val f = (timestampNs - prevAccT).toDouble() / (lastAccT - prevAccT).toDouble()
            ax = prevAcc[0] + (lastAcc[0] - prevAcc[0]) * f
            ay = prevAcc[1] + (lastAcc[1] - prevAcc[1]) * f
            az = prevAcc[2] + (lastAcc[2] - prevAcc[2]) * f
        } else {
            ax = lastAcc[0].toDouble()
            ay = lastAcc[1].toDouble()
            az = lastAcc[2].toDouble()
        }
        emitted++
        return doubleArrayOf((timestampNs - t0) / 1e9, ax, ay, az, x.toDouble(), y.toDouble(), z.toDouble())
    }

    companion object {
        /** Serialises samples as a flat JSON array [t, ax, ay, az, gx, gy, gz, t, ...]. */
        fun toJsonArray(samples: List<DoubleArray>): String {
            val sb = StringBuilder(samples.size * 70 + 2)
            sb.append('[')
            var first = true
            for (s in samples) {
                for (v in s) {
                    if (!first) sb.append(',')
                    first = false
                    if (v.isNaN() || v.isInfinite()) sb.append('0') else sb.append(String.format(java.util.Locale.US, "%.5f", v))
                }
            }
            sb.append(']')
            return sb.toString()
        }
    }
}
