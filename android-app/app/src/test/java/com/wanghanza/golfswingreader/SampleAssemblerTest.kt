package com.wanghanza.golfswingreader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SampleAssemblerTest {
    @Test
    fun noSampleBeforeFirstAccelerometerEvent() {
        val a = SampleAssembler()
        assertNull(a.onGyro(1_000_000L, 0f, 0f, 0f))
    }

    @Test
    fun interpolatesAccelerometerAtGyroTimestamp() {
        val a = SampleAssembler()
        a.onAccel(0L, 0f, 0f, 0f)
        a.onAccel(10_000_000L, 10f, 20f, 30f)
        val s = a.onGyro(5_000_000L, 1f, 2f, 3f)
        assertNotNull(s)
        s!!
        assertEquals(0.0, s[0], 1e-12)
        assertEquals(5.0, s[1], 1e-6)
        assertEquals(10.0, s[2], 1e-6)
        assertEquals(15.0, s[3], 1e-6)
        assertEquals(3.0, s[6], 1e-6)
    }

    @Test
    fun usesLatestAccelerometerWhenGyroIsNewer_andTimeIsRelative() {
        val a = SampleAssembler()
        a.onAccel(100L, 1f, 2f, 3f)
        val first = a.onGyro(1_000_000_000L, 0f, 0f, 0f)!!
        val second = a.onGyro(1_005_000_000L, 0f, 0f, 0f)!!
        assertEquals(0.0, first[0], 1e-12)
        assertEquals(0.005, second[0], 1e-9)
        assertEquals(1.0, second[1], 1e-6)
        assertEquals(2L, a.emitted)
    }

    @Test
    fun jsonArrayIsFlatAndFinite() {
        val json = SampleAssembler.toJsonArray(listOf(doubleArrayOf(0.0, 1.0, 2.0, 3.0, Double.NaN, 5.0, 6.0)))
        assertTrue(json.startsWith("[0.00000,1.00000"))
        assertTrue(!json.contains("NaN"))
        assertEquals(7, json.removePrefix("[").removeSuffix("]").split(",").size)
    }

    @Test
    fun sanitizesExportFileNames() {
        assertEquals("a_b.csv", FileExporter.sanitize("a/b.csv"))
        assertEquals("rec_1.json", FileExporter.sanitize("rec 1.json"))
        assertEquals("recording.txt", FileExporter.sanitize("..."))
    }
}
