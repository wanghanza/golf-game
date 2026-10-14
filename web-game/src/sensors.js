// Sensor sources. All emit samples { t (s), ax, ay, az (m/s^2 incl. gravity), gx, gy, gz (rad/s) }
// in the Android device frame.

import { isAndroidApp, nativeSensorInfo } from './platform.js';

const DEG2RAD = Math.PI / 180;

class RateMeter {
  constructor() {
    this.times = [];
  }
  tick(t) {
    if (this.times.length && t < this.times[this.times.length - 1]) this.times = [];
    this.times.push(t);
    while (this.times.length && this.times[0] < t - 2) this.times.shift();
  }
  get hz() {
    const n = this.times.length;
    if (n < 2) return 0;
    return (n - 1) / (this.times[n - 1] - this.times[0] || 1);
  }
}

export class SensorHub {
  constructor() {
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.running = false;
    this.kind = 'none';
    this.meter = new RateMeter();
    this.lastError = null;
    this.count = 0;
    this._onMotion = this._onMotion.bind(this);
    window.__golfSensorBatch = (flat) => this._onNativeBatch(flat);
    window.__golfSensorStatus = (s) => this._status(typeof s === 'string' ? JSON.parse(s) : s);
  }

  onSample(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  _status(s) {
    if (s.error) this.lastError = s.error;
    for (const fn of this.statusListeners) fn(s);
  }

  _emit(s) {
    // A new sensor session may restart the clock; drop samples that go back in time
    // only if they overlap, otherwise let listeners see a fresh timeline.
    if (this.lastT !== undefined && s.t < this.lastT - 0.5) {
      for (const fn of this.statusListeners) fn({ timeReset: true });
    } else if (this.lastT !== undefined && s.t <= this.lastT) {
      return;
    }
    this.lastT = s.t;
    this.count++;
    this.meter.tick(s.t);
    for (const fn of this.listeners) {
      try {
        fn(s);
      } catch (e) {
        console.error(e);
      }
    }
  }

  _onNativeBatch(flat) {
    const a = typeof flat === 'string' ? JSON.parse(flat) : flat;
    for (let i = 0; i + 6 < a.length; i += 7) {
      this._emit({ t: a[i], ax: a[i + 1], ay: a[i + 2], az: a[i + 3], gx: a[i + 4], gy: a[i + 5], gz: a[i + 6] });
    }
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    const r = e.rotationRate;
    if (!g || !r || g.x === null || r.alpha === null) return;
    this._emit({
      t: e.timeStamp / 1000,
      ax: g.x, ay: g.y, az: g.z,
      gx: (r.beta ?? 0) * DEG2RAD,
      gy: (r.gamma ?? 0) * DEG2RAD,
      gz: (r.alpha ?? 0) * DEG2RAD,
    });
  }

  info() {
    if (isAndroidApp()) return nativeSensorInfo();
    return { source: 'DeviceMotionEvent', note: '브라우저 센서 (약 60Hz, 정확도 제한)' };
  }

  /** Start streaming. Returns { ok, kind, error }. */
  async start(rateHz = 200) {
    if (this.running) return { ok: true, kind: this.kind };
    this.lastError = null;
    if (isAndroidApp()) {
      try {
        const ok = window.GolfNative.startSensors(Math.round(1e6 / rateHz));
        if (!ok) return { ok: false, kind: 'native', error: '이 기기에서 가속도계 또는 자이로스코프를 찾을 수 없습니다' };
        this.running = true;
        this.kind = 'native';
        return { ok: true, kind: 'native' };
      } catch (e) {
        return { ok: false, kind: 'native', error: String(e) };
      }
    }
    if (typeof DeviceMotionEvent === 'undefined') {
      return { ok: false, kind: 'none', error: '이 브라우저는 모션 센서를 지원하지 않습니다' };
    }
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const p = await DeviceMotionEvent.requestPermission();
        if (p !== 'granted') return { ok: false, kind: 'web', error: '모션 센서 권한이 거부되었습니다' };
      }
    } catch (e) {
      return { ok: false, kind: 'web', error: String(e) };
    }
    window.addEventListener('devicemotion', this._onMotion);
    this.running = true;
    this.kind = 'web';
    // Desktop browsers expose the API but never fire events.
    const before = this.count;
    await new Promise((r) => setTimeout(r, 700));
    if (this.count === before) {
      this.stop();
      return { ok: false, kind: 'web', error: '센서 데이터가 들어오지 않습니다 (PC 브라우저이거나 센서 없음)' };
    }
    return { ok: true, kind: 'web' };
  }

  stop() {
    if (!this.running) return;
    if (this.kind === 'native') {
      try {
        window.GolfNative.stopSensors();
      } catch (e) {
        /* ignore */
      }
    } else if (this.kind === 'web') {
      window.removeEventListener('devicemotion', this._onMotion);
    }
    this.running = false;
  }

  /** Options for analyzeSwing: declared sensor ranges improve clipping detection. */
  analysisOptions() {
    const info = this.kind === 'native' ? this.info() : null;
    const find = (prefix) => info?.sensors?.find((s) => String(s.type).startsWith(prefix))?.maxRange;
    const accelRange = find('accelerometer');
    const gyroRange = find('gyroscope');
    return { preprocess: { accelRange: accelRange > 0 ? accelRange : null, gyroRange: gyroRange > 0 ? gyroRange : null } };
  }

  get rateHz() {
    return this.meter.hz;
  }
}

export const sensors = new SensorHub();
