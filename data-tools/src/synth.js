// Synthetic phone-swing generator.
//
// Produces physically consistent accelerometer + gyroscope streams for a
// phone held in both hands like a club grip, rotating rigidly about the lead
// shoulder. THESE ARE NOT REAL MEASUREMENTS. They exist so the analysis
// engine and the game can be developed and regression-tested without a person
// swinging a phone, and every generated record is labelled synthetic.
//
// Model
//   - world: z up, golfer faces +y, target is -x (right-handed golfer)
//   - hands move on a circle of radius r around the lead shoulder, in a
//     plane through the target line tilted by the plane angle
//   - in-plane angular velocity profile: sine backswing, short pause, gamma
//     shaped downswing burst whose integral passes the address angle (virtual
//     impact) shortly after peak angular velocity
//   - forearm roll (phone twist about its long axis) opens the face going
//     back and closes it through impact
//   - optional downswing-plane rotation about vertical (path proxy)

import { v3, quat } from '../../swing-engine/src/math3.js';

const G = 9.80665;
const DEG = Math.PI / 180;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function quatFromBasis(x, y, z) {
  // Columns x, y, z of a rotation matrix (body -> world).
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  return quat.normalize(q);
}

// Lanczos approximation of the gamma function (for the release profile area).
function gammaFn(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];

// Downswing angular-velocity profiles (tau = time since the top).
//
// timedDownswing: a slow transition (the club angle is held while the hands
// drop, omega ~ transitionOmega * peak) followed by a sigmoid acceleration
// whose steepest point sits at accelPhase of the downswing (0 = top,
// 1 = impact). Around 0.65 the club peaks just before impact; early phases
// release (cast) and slow down before impact; late phases are still
// accelerating at impact.
function timedDownswing(o, thTop, wpk) {
  const p = o.accelPhase ?? 0.65;
  // Transition speed (fraction of peak); keeps the motion continuous for slow swings.
  const b = o.transitionOmega ?? Math.max(0.15, 1.6 / wpk);
  const ramp = 0.15;
  const tauD = 0.12;
  // Acceleration width scales with the swing: at accelPhase 0.65 the
  // sigmoid saturates (omega peaks) right at impact.
  const widthOf = (tc) => (tc * (1 / 0.65 - 1)) / 3;
  const shape = (tau, tc) => {
    if (tau <= 0) return 0;
    const wr = widthOf(tc);
    const ti = tc / p;
    const sig = 1 / (1 + Math.exp(-(tau - tc) / wr));
    const r = Math.min(1, tau / ramp);
    const h = b * r * r * (3 - 2 * r) + (1 - b) * sig;
    // An early release peaks and then slows toward a plateau before impact;
    // after impact the follow-through dies out.
    const tpk = tc + 3 * wr;
    const slow = tau > tpk ? 0.7 + 0.3 * Math.exp(-(tau - tpk) / tauD) : 1;
    // A late acceleration is still building speed at impact.
    const tEnd = Math.max(ti, tpk);
    const fin = tau > tEnd ? Math.exp(-(tau - tEnd) / 0.2) : 1;
    return h * slow * fin;
  };
  // Normalise so that the peak equals wpk.
  const peakOf = (tc) => {
    let m = 0;
    for (let i = 1; i <= 300; i++) m = Math.max(m, shape((i / 300) * (Math.max(tc / p, tc + 3 * widthOf(tc)) + 0.2), tc));
    return m;
  };
  const integ = (tc, T) => {
    const m = 400;
    let a = 0;
    for (let i = 0; i < m; i++) a += shape(((i + 0.5) / m) * T, tc) * (T / m);
    return (wpk * a) / peakOf(tc);
  };
  let lo = 0.005;
  let hi = 4;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    if (integ(mid, mid / p) > thTop) hi = mid;
    else lo = mid;
  }
  const tc = 0.5 * (lo + hi);
  const norm = wpk / peakOf(tc);
  return { omega: (tau) => norm * shape(tau, tc), impact: tc / p, length: Math.max(tc / p, tc + 3 * widthOf(tc)) + 1.2 };
}

// Gamma-shaped burst (legacy release model): k = 3 peaks just before impact,
// a small k (casting) peaks early. Integral = wpk * tauP * e^k * Gamma(k+1) / k^(k+1).
function gammaDownswing(k, thTop, thFin, wpk) {
  const gammaArea = (Math.exp(k) * gammaFn(k + 1)) / Math.pow(k, k + 1);
  const tauP = (thTop + thFin) / (wpk * gammaArea);
  return {
    omega: (tau) => (tau <= 0 ? 0 : wpk * Math.pow(tau / tauP, k) * Math.exp(k * (1 - tau / tauP))),
    impact: 1.1 * tauP,
    length: (k < 2 ? 8 : 5) * tauP,
  };
}

export const SWING_TYPES = Object.freeze({
  normal: { label: '정상 스윙', peakOmega: 11, faceRollDeg: 0, planeShiftDeg: 0 },
  draw: { label: '드로 의도 스윙', peakOmega: 11, faceRollDeg: 9, planeShiftDeg: 4 },
  fade: { label: '페이드 의도 스윙', peakOmega: 11, faceRollDeg: -9, planeShiftDeg: -4 },
  slow: { label: '느린 스윙', peakOmega: 5.5, faceRollDeg: 0, planeShiftDeg: 0 },
  fast: { label: '빠른 스윙', peakOmega: 17, faceRollDeg: 0, planeShiftDeg: 0 },
  cast: { label: '얼리 릴리스 (탑에서 던짐)', peakOmega: 11, releaseK: 1.3, dropDepth: 0 },
  late: { label: '늦은 가속 (임팩트 직전에야 가속)', peakOmega: 11, accelPhase: 0.9 },
  early: { label: '이른 가속 (다운스윙 초반에 힘을 씀)', peakOmega: 11, accelPhase: 0.4 },
  roll: { label: '빠른 손목 로테이션', peakOmega: 11, rollClosure: 0.9 },
  hold: { label: '로테이션 억제 (홀딩)', peakOmega: 11, rollClosure: -0.15 },
  half: { label: '하프 스윙', peakOmega: 8, faceRollDeg: 0, planeShiftDeg: 0, topDeg: 110, finishDeg: 120 },
  incomplete: { label: '불완전한 스윙 (다운스윙 중단)', peakOmega: 6, incomplete: true },
  shake: { label: '스윙이 아닌 손동작 (흔들기)', shake: true },
  shock: { label: '충격 포함 스윙 (낙하 모사)', peakOmega: 11, shock: true },
  saturated: { label: '센서 포화 스윙', peakOmega: 40, gyroRange: 34.9, accelRange: 156.9 },
});

/**
 * @param {Object} p
 * @param {string} [p.type]     key of SWING_TYPES
 * @param {number} [p.seed]
 * @param {number} [p.rate]     output sample rate (Hz)
 * @param {number} [p.peakOmega] rad/s, peak in-plane angular velocity
 * @param {number} [p.tempo]    backswing : downswing duration ratio
 * @param {number} [p.topDeg]   backswing rotation (deg)
 * @param {number} [p.finishDeg] rotation past address after impact (deg)
 * @param {number} [p.faceRollDeg] forearm roll contribution at impact (deg, + = open);
 *   the geometric face twist (truth.faceTwistDeg) also includes the effect of
 *   a plane change
 * @param {number} [p.planeShiftDeg] downswing plane azimuth change (deg)
 * @param {number} [p.addressLeanDeg] shaft lean toward the target at address (deg)
 */
export function generateSwing(p = {}) {
  const type = p.type ?? 'normal';
  const preset = SWING_TYPES[type];
  if (!preset) throw new Error(`unknown swing type ${type}`);
  const o = { tempo: 3, topDeg: 200, finishDeg: 220, ...preset, ...p };
  const seed = o.seed ?? 1;
  const rand = mulberry32(seed);
  const rate = o.rate ?? 200;
  const simRate = 1000;
  const dt = 1 / simRate;

  // Geometry.
  const r = o.armRadius ?? 0.6;
  const center = [0, 0, 1.4];
  const d0 = v3.normalize([0, 0.35, -1]);
  const toTarget = [-1, 0, 0];
  let nBs = v3.normalize(v3.cross(d0, toTarget));
  if (v3.dot(v3.cross(nBs, d0), toTarget) < 0) nBs = v3.scale(nBs, -1);
  const nDs = rotZ(nBs, (o.planeShiftDeg ?? 0) * DEG);
  // Grip: the phone's top (+y) points obliquely down toward the ball and the
  // swing turns about the phone's width axis (+x = plane normal), so the
  // backswing (negative in-plane rotation) moves the top toward the phone's
  // back (-z) and the downswing toward its screen side.
  const yBody = d0;
  const xBody = nBs;
  const zBody = v3.cross(xBody, yBody);
  // Shaft lean at address: the phone is turned back (toward the backswing)
  // by the lean, so the hands are ahead of the club head.
  const lean = ((o.addressLeanDeg ?? 0) * Math.PI) / 180;
  const q0 = quat.mul(quatFromBasis(xBody, yBody, zBody), quat.fromAxisAngle([1, 0, 0], -lean));

  // In-plane angular velocity profile.
  // Address: the player holds still for >= 3 s before taking the club back.
  const tAddr = (o.addressSeconds ?? 3.4) + 0.3 * rand();
  const thTop = o.topDeg * DEG;
  const thFin = o.finishDeg * DEG;
  const wpk = o.peakOmega ?? 11;
  const ds = o.releaseK ? gammaDownswing(o.releaseK, thTop, thFin, wpk) : timedDownswing(o, thTop, wpk);
  const tdEst = ds.impact;
  const tb = o.backswingSeconds ?? Math.min(2.0, Math.max(0.35, o.tempo * tdEst));
  const tPause = 0.04;
  const tDs0 = tAddr + tb + tPause;
  const burstLen = ds.length;
  const total = tDs0 + burstLen + 0.8;

  const wpAt = (t) => {
    if (o.shake) {
      if (t < tAddr || t > tAddr + 1.6) return 0;
      return 4 * Math.sin(2 * Math.PI * 4 * (t - tAddr));
    }
    if (t < tAddr) return 0;
    if (t < tAddr + tb) return -((thTop * Math.PI) / (2 * tb)) * Math.sin((Math.PI * (t - tAddr)) / tb);
    if (t < tDs0) return 0;
    const tau = t - tDs0;
    if (o.incomplete) {
      // Comes down a little and stops well before the address angle.
      const a = 0.45 * thTop;
      const T = 0.6;
      return tau < T ? ((a * Math.PI) / (2 * T)) * Math.sin((Math.PI * tau) / T) : 0;
    }
    return ds.omega(tau);
  };

  // Transition drop: the hands fall a little at the start of the downswing
  // (arms and gravity) and come back up to address height by impact.
  const dropDepth = o.dropDepth ?? 0.12;
  const dropT = tdEst;
  const dropAt = (t) => {
    const u = (t - tDs0) / dropT;
    if (o.shake || u <= 0 || u >= 1) return 0;
    return -dropDepth * 0.5 * (1 - Math.cos(2 * Math.PI * u));
  };

  // Integrate orientation (world-frame angular velocity), plane rotation and twist.
  const steps = Math.ceil(total / dt);
  let qPlane = [1, 0, 0, 0];
  let q = q0;
  let theta = 0;
  let thetaMin = 0;
  let pastTop = false;
  let prevPhi = 0;
  const truth = { addressEnd: tAddr, top: null, impact: null, peakOmegaTime: null, forearmRollDeg: o.faceRollDeg ?? 0, faceTwistDeg: null, planeShiftDeg: o.planeShiftDeg ?? 0 };
  let peakW = 0;
  const fine = [];
  const phiTop = 40 * DEG;
  const faceT = (o.faceRollDeg ?? 0) * DEG;
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const wp = wpAt(t);
    // Plane normal: blend from backswing to downswing plane around the top.
    const blend = Math.min(1, Math.max(0, (t - (tAddr + tb - 0.05)) / 0.15));
    const n = v3.normalize(v3.add(v3.scale(nBs, 1 - blend), v3.scale(nDs, blend)));
    // Forearm roll as a function of swing progress.
    let phi;
    if (!pastTop) phi = thTop > 0 ? phiTop * Math.min(1, -theta / thTop) : 0;
    else if (theta <= 0) phi = faceT + (phiTop - faceT) * (-theta / thTop);
    else phi = faceT - (o.rollClosure ?? 0.3) * theta; // forearm rotation closing the face after impact
    if (o.shake) phi = 0;
    const phiRate = i === 0 ? 0 : (phi - prevPhi) / dt;
    prevPhi = phi;
    const yWorld = quat.rotate(q, [0, 1, 0]);
    const wPlane = v3.scale(n, wp);
    const wWorld = v3.add(wPlane, v3.scale(yWorld, phiRate));
    const pos = v3.add(v3.add(center, [0, 0, dropAt(t)]), quat.rotate(qPlane, v3.scale(d0, r)));
    fine.push({ t, q, wWorld, pos });

    if (wp > peakW && pastTop) {
      peakW = wp;
      truth.peakOmegaTime = t;
    }
    const thetaNext = theta + wp * dt;
    if (!pastTop && t > tAddr + 0.05 && wp >= 0 && theta < -0.1) {
      pastTop = true;
      truth.top = t;
    }
    if (pastTop && truth.impact === null && theta < 0 && thetaNext >= 0 && !o.incomplete) {
      truth.impact = t + (-theta / (thetaNext - theta)) * dt;
      // Geometric face rotation: phone twist about its long axis relative to
      // address, from the full orientation (forearm roll + plane change).
      truth.faceTwistDeg = (quat.twistAngle(quat.mul(quat.conj(q0), q), [0, 1, 0]) * 180) / Math.PI;
    }
    theta = thetaNext;
    thetaMin = Math.min(thetaMin, theta);
    const wAng = Math.hypot(wWorld[0], wWorld[1], wWorld[2]) * dt;
    if (wAng > 0) q = quat.normalize(quat.mul(quat.fromAxisAngle(wWorld, wAng), q));
    const pAng = Math.abs(wp) * dt;
    if (pAng > 0) qPlane = quat.normalize(quat.mul(quat.fromAxisAngle(v3.scale(n, Math.sign(wp)), pAng), qPlane));
  }
  truth.peakOmega = peakW;
  truth.backswingDeg = -thetaMin / DEG;

  // Sample at the output rate with timestamp jitter and sensor noise.
  const accNoise = o.accelNoise ?? 0.12;
  const gyroNoise = o.gyroNoise ?? 0.008;
  const gyroBias = [0.004, -0.003, 0.002];
  const samples = [];
  const n = Math.floor(total * rate);
  const h = 2; // finite-difference half-window in fine steps
  for (let j = 0; j < n; j++) {
    const tj = j / rate + (rand() - 0.5) * 0.0004;
    const i = Math.min(fine.length - 1 - h, Math.max(h, Math.round(tj * simRate)));
    const f = fine[i];
    const pm = fine[i - h].pos;
    const pp = fine[i + h].pos;
    const acc = v3.scale(v3.add(v3.sub(pp, f.pos), v3.sub(pm, f.pos)), 1 / Math.pow(h * dt, 2));
    const spec = v3.add(acc, [0, 0, G]);
    const qc = quat.conj(f.q);
    const aBody = quat.rotate(qc, spec);
    const wBody = quat.rotate(qc, f.wWorld);
    const s = {
      t: Number(tj.toFixed(5)),
      ax: aBody[0] + accNoise * gaussian(rand),
      ay: aBody[1] + accNoise * gaussian(rand),
      az: aBody[2] + accNoise * gaussian(rand),
      gx: wBody[0] + gyroBias[0] + gyroNoise * gaussian(rand),
      gy: wBody[1] + gyroBias[1] + gyroNoise * gaussian(rand),
      gz: wBody[2] + gyroBias[2] + gyroNoise * gaussian(rand),
    };
    if (o.gyroRange) {
      for (const c of ['gx', 'gy', 'gz']) s[c] = Math.max(-o.gyroRange, Math.min(o.gyroRange, s[c]));
    }
    if (o.accelRange) {
      for (const c of ['ax', 'ay', 'az']) s[c] = Math.max(-o.accelRange, Math.min(o.accelRange, s[c]));
    }
    samples.push(s);
  }
  if (o.shock && truth.impact) {
    const idx = samples.findIndex((s) => s.t > truth.impact + 0.25);
    if (idx > 0) {
      samples[idx].ax += 90;
      samples[idx].ay -= 60;
      if (samples[idx + 1]) samples[idx + 1].ax -= 40;
    }
  }
  for (const s of samples) {
    for (const c of ['ax', 'ay', 'az', 'gx', 'gy', 'gz']) s[c] = Number(s[c].toFixed(4));
  }

  return {
    meta: {
      synthetic: true,
      generator: 'data-tools/src/synth.js',
      swingType: type,
      swingTypeLabel: preset.label,
      seed,
      rateHz: rate,
      units: { t: 's', accel: 'm/s^2 (includes gravity)', gyro: 'rad/s' },
      coordinateSystem: 'Android device frame (x right, y up along long edge, z out of screen)',
      params: { peakOmega: wpk, tempo: o.tempo, topDeg: o.topDeg, finishDeg: o.finishDeg, faceRollDeg: o.faceRollDeg ?? 0, planeShiftDeg: o.planeShiftDeg ?? 0 },
      truth,
    },
    samples,
  };
}
