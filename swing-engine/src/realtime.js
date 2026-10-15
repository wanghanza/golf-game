// Real-time swing detector for game mode.
//
// States
//   idle       not armed
//   countdown  armed with a grace period so the player can grip the phone
//   waitStill  armed, waiting for the player to hold still (address)
//   ready      address detected; waiting for the swing to start
//   swinging   motion in progress, buffering
//   cooldown   result delivered; short pause before re-arming
//
// Accidental shakes do not launch: a launch requires an address, a swing
// and a passing offline analysis (see analyze.js validity rules).

import { analyzeSwing } from './analyze.js';

const G = 9.80665;

export const DEFAULT_DETECTOR = Object.freeze({
  stillSeconds: 0.4,
  stillOmega: 0.5,
  stillAccelDev: 1.5,
  startOmega: 2.0,
  endOmega: 1.0,
  endQuietSeconds: 0.45,
  minSwingSeconds: 0.4,
  maxSwingSeconds: 4.0,
  maxReadySeconds: 20,
  preRollSeconds: 0.6,
  bufferSeconds: 8,
  cooldownSeconds: 1.2,
  autoRearm: true,
  // Real-time impact estimate (sound cue)
  liveReverseOmega: 1.0,
  liveMinBackswingSeconds: 0.2,
  liveMinBackswingRad: 0.6, // ~35 deg, same as the offline rule
  liveMinPeakOmega: 3.0,
  liveReturnFraction: 0.95,
});

export class SwingDetector {
  constructor({ config = {}, analysis = {}, onState = () => {}, onSwing = () => {}, onImpact = () => {} } = {}) {
    this.cfg = { ...DEFAULT_DETECTOR, ...config };
    this.analysis = analysis;
    this.onState = onState;
    this.onSwing = onSwing;
    this.onImpact = onImpact;
    this.buf = [];
    this.state = 'idle';
    this.stateSince = 0;
    this.stillSince = null;
    this.readyAt = null;
    this.swingStart = null;
    this.quietSince = null;
    this.lastT = 0;
  }

  setState(s, t, info) {
    this.state = s;
    this.stateSince = t;
    this.onState(s, info);
  }

  /**
   * @param {Object} [opts]
   * @param {number} [opts.delaySeconds] grace period before the stillness check
   *   starts (pressing the on-screen button moves the phone).
   */
  arm({ delaySeconds = 0 } = {}) {
    this.stillSince = null;
    if (delaySeconds > 0) {
      this.countdownSeconds = delaySeconds;
      this.countdownEnd = null;
      this.setState('countdown', this.lastT);
      return;
    }
    this.setState('waitStill', this.lastT);
  }

  /** 0..1 progress of the stillness check while waiting for the address. */
  get stillProgress() {
    if (this.state !== 'waitStill' || this.stillSince === null) return 0;
    return Math.min(1, (this.lastT - this.stillSince) / this.cfg.stillSeconds);
  }

  /** Seconds left in the countdown (null when not counting down). */
  get countdownLeft() {
    if (this.state !== 'countdown') return null;
    return this.countdownEnd === null ? this.countdownSeconds : Math.max(0, this.countdownEnd - this.lastT);
  }

  disarm() {
    this.setState('idle', this.lastT);
  }

  push(s) {
    if (this.buf.length && s.t < this.buf[this.buf.length - 1].t) {
      // Clock restarted (new sensor session): start over.
      this.buf = [];
      if (this.state !== 'idle') this.arm();
    }
    this.lastT = s.t;
    this.buf.push(s);
    const minT = s.t - this.cfg.bufferSeconds;
    while (this.buf.length && this.buf[0].t < minT) this.buf.shift();
    const w = Math.hypot(s.gx, s.gy, s.gz);
    const aDev = Math.abs(Math.hypot(s.ax, s.ay, s.az) - G);
    const c = this.cfg;
    switch (this.state) {
      case 'countdown': {
        if (this.countdownEnd === null) this.countdownEnd = s.t + this.countdownSeconds;
        if (s.t >= this.countdownEnd) this.arm();
        break;
      }
      case 'waitStill': {
        if (w < c.stillOmega && aDev < c.stillAccelDev) {
          if (this.stillSince === null) this.stillSince = s.t;
          if (s.t - this.stillSince >= c.stillSeconds) {
            this.readyAt = this.stillSince;
            this.setState('ready', s.t);
          }
        } else {
          this.stillSince = null;
        }
        break;
      }
      case 'ready': {
        if (w > c.startOmega) {
          this.swingStart = s.t;
          this.quietSince = null;
          this.live = { ref: [s.gx / w, s.gy / w, s.gz / w], top: null, peak: 0, fired: false, angle: 0, lastT: s.t };
          this.setState('swinging', s.t);
        } else if (w < c.stillOmega && aDev < c.stillAccelDev) {
          // Keep the address window fresh while the player waits.
          if (s.t - this.readyAt > 3) this.readyAt = s.t - 1.5;
        } else if (s.t - this.stateSince > c.maxReadySeconds) {
          this.arm();
        }
        break;
      }
      case 'swinging': {
        this.trackLiveImpact(s, w);
        if (w < c.endOmega) {
          if (this.quietSince === null) this.quietSince = s.t;
        } else {
          this.quietSince = null;
        }
        const elapsed = s.t - this.swingStart;
        const settled = this.quietSince !== null && s.t - this.quietSince >= this.quietNeeded && elapsed >= c.minSwingSeconds;
        if (settled || elapsed >= c.maxSwingSeconds) this.finish(s.t);
        break;
      }
      case 'cooldown': {
        if (s.t - this.stateSince >= c.cooldownSeconds) {
          if (c.autoRearm) this.arm();
          else this.setState('idle', s.t);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Real-time impact estimate, used only for instant feedback (the impact
   * sound). Same principle as the offline analysis, approximated in the phone
   * frame: the rotation about the takeaway axis is integrated going back;
   * after the rotation reverses (top), the impact is when the phone has turned
   * back through the same angle, i.e. returned to the address orientation.
   * In the body frame a rotation about a near-fixed axis keeps its direction,
   * so projecting on the takeaway direction is a good approximation. The
   * authoritative impact time comes from analyzeSwing afterwards.
   */
  trackLiveImpact(s, w) {
    const L = this.live;
    if (!L || L.fired) return;
    const c = this.cfg;
    const proj = s.gx * L.ref[0] + s.gy * L.ref[1] + s.gz * L.ref[2];
    const dt = Math.max(0, Math.min(0.05, s.t - L.lastT));
    L.lastT = s.t;
    if (L.top === null) {
      if (proj > 0) L.angle += proj * dt;
      if (proj < -c.liveReverseOmega && s.t - this.swingStart >= c.liveMinBackswingSeconds) {
        // A real backswing turns the phone a long way before reversing; a
        // wrist shake does not.
        if (L.angle >= c.liveMinBackswingRad) {
          L.top = s.t;
          L.down = 0;
        } else {
          L.fired = true; // not a swing: stay silent
        }
      }
      return;
    }
    L.down += -proj * dt;
    L.peak = Math.max(L.peak, w);
    if (L.down >= L.angle * c.liveReturnFraction && L.peak >= c.liveMinPeakOmega) {
      L.fired = true;
      this.onImpact({ t: s.t, peakOmega: L.peak, sinceTop: s.t - L.top });
    }
  }

  /** Waiting at the top of a slow swing must not end the recording. */
  get quietNeeded() {
    const L = this.live;
    const atTop = L && !L.fired && L.angle >= this.cfg.liveMinBackswingRad;
    return atTop ? Math.max(this.cfg.endQuietSeconds, 1.5) : this.cfg.endQuietSeconds;
  }

  finish(t) {
    const from = Math.min(this.readyAt ?? this.swingStart, this.swingStart - 1) - this.cfg.preRollSeconds;
    const window = this.buf.filter((x) => x.t >= from);
    const result = analyzeSwing(window, this.analysis);
    this.setState('cooldown', t);
    this.onSwing(result, window);
  }
}
