// Real-time swing detector: an explicit phase machine that follows the
// player's swing step by step.
//
//   idle        not armed
//   countdown   grace period after pressing the button (grip the phone)
//   waitStill   ADDRESS: the phone must point obliquely down (its top 15-88°
//               below horizontal) and stay still for `stillSeconds` (3 s)
//   ready       address confirmed; waiting for the takeaway
//   backswing   the phone turns toward its BACK (rotation about its width
//               axis, x) - the takeaway has started
//   top         the backswing rotation has slowed / paused at the top
//   downswing   the rotation reversed (toward the screen side) and is
//               coming down
//   follow      impact passed (phone back at the address angle); waiting
//               for the follow-through to settle
//   cooldown    result delivered; short pause before re-arming
//
// Grip convention (phone held like a club grip): the SCREEN is the club face
// and looks at the target, the top of the phone points down toward the ball,
// the swing turns about the phone's x axis; backswing = negative gx (the
// phone moves toward its back, away from the target). `direction: -1` flips this for
// players who hold the phone the other way round.
//
// The phases decide WHEN a swing happened; the offline analysis
// (analyze.js) of the recorded window then provides the features and the
// final validity check (clipping, shocks, data gaps).

import { analyzeSwing } from './analyze.js';

const G = 9.80665;
const DEG = 180 / Math.PI;

export const DEFAULT_DETECTOR = Object.freeze({
  direction: 1,
  // Address
  stillSeconds: 3.0,
  stillOmega: 0.35, // rad/s
  stillAccelDev: 1.2, // m/s^2
  minPitchDownDeg: 15,
  maxPitchDownDeg: 88,
  maxFaceTiltDeg: 35, // screen (club face) must stand up, not lie flat
  // Backswing start: rotation toward the back, dominated by the x axis
  backswingOmega: 0.8, // rad/s
  backswingConfirmSeconds: 0.04,
  axisDominance: 0.5, // |gx| >= 0.5 |omega|
  // Top: rotation slows down after a real backswing
  topOmega: 0.4,
  minBackswingDeg: 30,
  maxBackswingSeconds: 3.0,
  maxTopSeconds: 2.0,
  // Downswing: reversed rotation
  downswingOmega: 1.0,
  impactReturnFraction: 0.95, // impact when the phone is back at 95% of the backswing angle
  minPeakOmega: 2.5, // rad/s, slower "downswings" are not shots
  maxDownswingSeconds: 1.5,
  // Follow-through
  followQuietOmega: 1.0,
  followQuietSeconds: 0.35,
  maxFollowSeconds: 1.5,
  // Bookkeeping
  readyTimeoutSeconds: 25,
  preRollSeconds: 0.5,
  bufferSeconds: 12,
  cooldownSeconds: 1.2,
  autoRearm: true,
});

/** Detector settings for putting strokes (small pendulum motion). */
export const PUTT_PHASES = Object.freeze({
  backswingOmega: 0.25,
  topOmega: 0.12,
  minBackswingDeg: 4,
  downswingOmega: 0.25,
  minPeakOmega: 0.35,
  followQuietOmega: 0.3,
  maxBackswingSeconds: 4,
  maxDownswingSeconds: 2.5,
  maxTopSeconds: 3,
});

export const HINTS = Object.freeze({
  tilt: '휴대폰 끝을 비스듬히 아래(공 쪽)로 향하세요',
  face: '화면(페이스)이 목표를 향하도록 세워 주세요',
  moving: '움직이지 말고 그대로 계세요',
  wrongDirection: '백스윙은 휴대폰 뒷면 쪽으로 올리세요',
  smallBackswing: '백스윙이 너무 작습니다 — 다시 어드레스하세요',
  longTop: '탑에서 너무 오래 멈췄습니다 — 다시 어드레스하세요',
  incomplete: '다운스윙이 끝까지 내려오지 않았습니다',
  slow: '다운스윙이 너무 느립니다',
});

export class SwingDetector {
  constructor({ config = {}, analysis = {}, onState = () => {}, onSwing = () => {}, onImpact = () => {}, onHint = () => {} } = {}) {
    this.cfg = { ...DEFAULT_DETECTOR, ...config };
    this.analysis = analysis;
    this.onState = onState;
    this.onSwing = onSwing;
    this.onImpact = onImpact;
    this.onHint = onHint;
    this.buf = [];
    this.state = 'idle';
    this.stateSince = 0;
    this.lastT = 0;
    this.hint = null;
    this.resetPhase();
  }

  resetPhase() {
    this.stillSince = null;
    this.addressStart = null;
    this.bsStart = null;
    this.bsAngle = 0;
    this.dsAngle = 0;
    this.peak = 0;
    this.candidateSince = null;
    this.quietSince = null;
    this.impactT = null;
    this.phaseTimes = {};
  }

  setState(s, t, info) {
    this.state = s;
    this.stateSince = t;
    if (s in { backswing: 1, top: 1, downswing: 1, follow: 1 }) this.phaseTimes[s] = t;
    this.onState(s, info);
  }

  setHint(h) {
    if (h !== this.hint) {
      this.hint = h;
      this.onHint(h);
    }
  }

  /** @param {{delaySeconds?: number}} [opts] */
  arm({ delaySeconds = 0 } = {}) {
    this.resetPhase();
    this.setHint(null);
    if (delaySeconds > 0) {
      this.countdownSeconds = delaySeconds;
      this.countdownEnd = null;
      this.setState('countdown', this.lastT);
      return;
    }
    this.setState('waitStill', this.lastT);
  }

  disarm() {
    this.resetPhase();
    this.setState('idle', this.lastT);
  }

  /** 0..1 progress of the address hold. */
  get stillProgress() {
    if (this.state !== 'waitStill' || this.stillSince === null) return 0;
    return Math.min(1, (this.lastT - this.stillSince) / this.cfg.stillSeconds);
  }

  get countdownLeft() {
    if (this.state !== 'countdown') return null;
    return this.countdownEnd === null ? this.countdownSeconds : Math.max(0, this.countdownEnd - this.lastT);
  }

  /** Live backswing angle (deg) for the UI. */
  get backswingDeg() {
    return this.bsAngle * DEG;
  }

  /** Phone pitch: degrees the top of the phone points below the horizon. */
  static pitchDownDeg(s) {
    const a = Math.hypot(s.ax, s.ay, s.az) || 1;
    return Math.asin(Math.max(-1, Math.min(1, -s.ay / a))) * DEG;
  }

  /** How far the screen is tipped toward the sky (+) or ground (-), deg. */
  static faceTiltDeg(s) {
    const a = Math.hypot(s.ax, s.ay, s.az) || 1;
    return Math.asin(Math.max(-1, Math.min(1, s.az / a))) * DEG;
  }

  rejectAndReAddress(t, hint) {
    this.setHint(hint);
    this.resetPhase();
    this.setState('waitStill', t);
  }

  push(s) {
    if (this.buf.length && s.t < this.buf[this.buf.length - 1].t) {
      // Clock restarted (new sensor session): start over.
      this.buf = [];
      if (this.state !== 'idle') this.arm();
    }
    const dt = this.buf.length ? Math.min(0.05, s.t - this.buf[this.buf.length - 1].t) : 0;
    this.lastT = s.t;
    this.buf.push(s);
    const minT = s.t - this.cfg.bufferSeconds;
    while (this.buf.length && this.buf[0].t < minT) this.buf.shift();

    const c = this.cfg;
    const w = Math.hypot(s.gx, s.gy, s.gz);
    const aDev = Math.abs(Math.hypot(s.ax, s.ay, s.az) - G);
    // Rotation toward the back of the phone is positive "b".
    const b = -c.direction * s.gx;
    const dominant = Math.abs(s.gx) >= c.axisDominance * w;

    switch (this.state) {
      case 'countdown': {
        if (this.countdownEnd === null) this.countdownEnd = s.t + this.countdownSeconds;
        if (s.t >= this.countdownEnd) this.arm();
        break;
      }
      case 'waitStill': {
        const pitch = SwingDetector.pitchDownDeg(s);
        const pitchOk = pitch >= c.minPitchDownDeg && pitch <= c.maxPitchDownDeg;
        const faceOk = Math.abs(SwingDetector.faceTiltDeg(s)) <= c.maxFaceTiltDeg;
        const tilted = pitchOk && faceOk;
        const still = w < c.stillOmega && aDev < c.stillAccelDev;
        const postureHint = pitchOk ? HINTS.face : HINTS.tilt;
        if (still && tilted) {
          if (this.stillSince === null) this.stillSince = s.t;
          if (this.hint === HINTS.tilt || this.hint === HINTS.face || this.hint === HINTS.moving) this.setHint(null);
          if (s.t - this.stillSince >= c.stillSeconds) {
            this.addressStart = this.stillSince;
            this.setHint(null);
            this.setState('ready', s.t);
          }
        } else {
          if (this.stillSince !== null && s.t - this.stillSince > 0.3) this.setHint(tilted ? HINTS.moving : postureHint);
          else if (!tilted && still) this.setHint(postureHint);
          this.stillSince = null;
        }
        break;
      }
      case 'ready': {
        if (b > c.backswingOmega && dominant) {
          if (this.candidateSince === null) this.candidateSince = s.t;
          if (s.t - this.candidateSince >= c.backswingConfirmSeconds) {
            // Count the rotation from the moment the takeaway began.
            this.bsStart = this.candidateSince;
            this.bsAngle = 0;
            for (let i = 1; i < this.buf.length; i++) {
              const q = this.buf[i];
              if (q.t < this.candidateSince - 0.1) continue;
              this.bsAngle += Math.max(0, -c.direction * q.gx) * (q.t - this.buf[i - 1].t);
            }
            this.candidateSince = null;
            this.setHint(null);
            this.setState('backswing', s.t);
          }
        } else {
          this.candidateSince = null;
          if (-b > c.backswingOmega && dominant) {
            // Moving toward the screen first: not a takeaway.
            this.rejectAndReAddress(s.t, HINTS.wrongDirection);
          } else if (w > c.stillOmega * 3 && !(b > 0 && dominant)) {
            // Fidgeting: require a fresh address.
            this.rejectAndReAddress(s.t, HINTS.moving);
          } else if (s.t - this.stateSince > c.readyTimeoutSeconds) {
            this.rejectAndReAddress(s.t, null);
          }
        }
        break;
      }
      case 'backswing': {
        if (b > 0) this.bsAngle += b * dt;
        const tooLong = s.t - this.bsStart > c.maxBackswingSeconds;
        if (b < c.topOmega || tooLong) {
          if (this.bsAngle * DEG >= c.minBackswingDeg && !tooLong) {
            this.setState('top', s.t);
          } else {
            this.rejectAndReAddress(s.t, HINTS.smallBackswing);
          }
        }
        break;
      }
      case 'top': {
        if (b > 0) this.bsAngle += b * dt; // a little more turn while pausing
        if (-b > c.downswingOmega) {
          this.dsAngle = 0;
          this.peak = 0;
          this.setState('downswing', s.t);
        } else if (b > c.backswingOmega) {
          this.setState('backswing', s.t); // kept turning back
        } else if (s.t - this.stateSince > c.maxTopSeconds) {
          this.rejectAndReAddress(s.t, HINTS.longTop);
        }
        break;
      }
      case 'downswing': {
        if (-b > 0) this.dsAngle += -b * dt;
        this.peak = Math.max(this.peak, w);
        if (this.dsAngle >= this.bsAngle * c.impactReturnFraction) {
          if (this.peak >= c.minPeakOmega) {
            this.impactT = s.t;
            this.onImpact({ t: s.t, peakOmega: this.peak, backswingDeg: this.bsAngle * DEG });
            this.quietSince = null;
            this.setState('follow', s.t);
          } else {
            this.setHint(HINTS.slow);
            this.finish(s.t);
          }
        } else if ((-b < c.topOmega && s.t - this.stateSince > 0.25) || s.t - this.stateSince > c.maxDownswingSeconds) {
          this.setHint(HINTS.incomplete);
          this.finish(s.t);
        }
        break;
      }
      case 'follow': {
        if (w < c.followQuietOmega) {
          if (this.quietSince === null) this.quietSince = s.t;
        } else {
          this.quietSince = null;
        }
        const settled = this.quietSince !== null && s.t - this.quietSince >= c.followQuietSeconds;
        if (settled || s.t - this.stateSince >= c.maxFollowSeconds) this.finish(s.t);
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
    const from = (this.addressStart ?? (this.bsStart ?? t) - 1) - this.cfg.preRollSeconds;
    const window = this.buf.filter((x) => x.t >= from);
    let result = analyzeSwing(window, this.analysis);
    if (this.impactT === null && result.valid) {
      // The live phases did not see a complete downswing: do not launch.
      result = { ...result, valid: false, reason: 'incomplete_swing' };
    }
    result.livePhases = {
      addressStart: this.addressStart,
      backswingStart: this.bsStart,
      top: this.phaseTimes.top ?? null,
      downswingStart: this.phaseTimes.downswing ?? null,
      impact: this.impactT,
      backswingDeg: this.bsAngle * DEG,
    };
    this.setState('cooldown', t);
    this.onSwing(result, window);
  }
}
