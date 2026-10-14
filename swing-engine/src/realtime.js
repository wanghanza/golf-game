// Real-time swing detector for game mode.
//
// States
//   idle       not armed
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
});

export class SwingDetector {
  constructor({ config = {}, analysis = {}, onState = () => {}, onSwing = () => {} } = {}) {
    this.cfg = { ...DEFAULT_DETECTOR, ...config };
    this.analysis = analysis;
    this.onState = onState;
    this.onSwing = onSwing;
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

  arm() {
    this.stillSince = null;
    this.setState('waitStill', this.lastT);
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
        if (w < c.endOmega) {
          if (this.quietSince === null) this.quietSince = s.t;
        } else {
          this.quietSince = null;
        }
        const elapsed = s.t - this.swingStart;
        const settled = this.quietSince !== null && s.t - this.quietSince >= c.endQuietSeconds && elapsed >= c.minSwingSeconds;
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

  finish(t) {
    const from = Math.min(this.readyAt ?? this.swingStart, this.swingStart - 1) - this.cfg.preRollSeconds;
    const window = this.buf.filter((x) => x.t >= from);
    const result = analyzeSwing(window, this.analysis);
    this.setState('cooldown', t);
    this.onSwing(result, window);
  }
}
