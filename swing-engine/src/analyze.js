// Offline swing analysis: one recording window in, phases + features out.
//
// Pipeline
//   1. preprocess: clean, resample to 200 Hz, low-pass, flag gaps/clipping
//   2. activity: find the main motion burst (|gyro| above threshold)
//   3. address: quiet window just before the burst -> gravity direction and
//      gyro bias
//   4. orientation: gyro integration from the address attitude (accelerometer
//      is NOT used during the swing, it is dominated by centripetal force)
//   5. swing plane: principal axis of world-frame angular velocity
//   6. in-plane angle theta(t): 0 at address, negative going back
//   7. phases: top = most negative theta; virtual impact = theta returns to
//      the address angle (+ optional lead) during the downswing; finish = motion
//      settles
//   8. validity rules and features
//
// Coordinates: world frame z is up (from gravity at address), x/y horizontal
// with yaw fixed by the phone's address heading.

import { preprocess } from './preprocess.js';
import { v3, quat, principalAxis, scatter, wrapDeg } from './math3.js';

const G = 9.80665;
const RAD2DEG = 180 / Math.PI;

export const DEFAULT_ANALYSIS = Object.freeze({
  activeOmega: 1.2, // rad/s, motion threshold
  quietOmega: 0.5, // rad/s, "still" threshold
  quietAccelDev: 1.5, // m/s^2, allowed | |a| - g | while still
  biasOmega: 0.12, // rad/s, gyro-bias window must stay below this
  minAddressSeconds: 0.2,
  mergeGapSeconds: 0.6, // the transition at the top can be slow
  minBackswingDeg: 35,
  minBackswingSeconds: 0.2,
  maxBackswingSeconds: 2.5,
  minDownswingSeconds: 0.06,
  maxDownswingSeconds: 1.5,
  minPeakOmega: 3.0, // rad/s
  maxReversals: 4,
  impactLeadDeg: 0, // virtual impact when theta reaches address angle + lead
  shockJerk: 50, // m/s^2 change between consecutive 200 Hz samples
  maxGapInSwing: 0.03, // s
  armRadius: 0.6, // m, assumed lead-shoulder-to-hands distance (model assumption)
  longAxis: [0, 1, 0], // phone axis that runs along the "shaft" when gripped
  transitionWindow: 0.35, // first part of the downswing used for the transition features
});

/** A value together with where it came from. */
function feat(value, unit, source, note) {
  return note ? { value, unit, source, note } : { value, unit, source };
}

function segmentsAbove(arr, thr, fs, mergeGap) {
  const segs = [];
  let start = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > thr) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      segs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) segs.push([start, arr.length - 1]);
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && (s[0] - last[1]) / fs <= mergeGap) last[1] = s[1];
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

function invalid(reason, extra = {}) {
  return { valid: false, reason, ...extra };
}

export const REASON_TEXT = Object.freeze({
  too_few_samples: '센서 데이터가 너무 적습니다',
  no_motion: '움직임이 감지되지 않았습니다',
  no_backswing: '백스윙이 감지되지 않았습니다 (스윙이 아닌 동작)',
  incomplete_swing: '다운스윙이 임팩트 지점까지 이어지지 않았습니다',
  too_slow: '스윙 속도가 너무 느립니다',
  shake: '흔들기 동작으로 판단되어 발사하지 않습니다',
  irregular_tempo: '스윙 템포가 비정상적입니다',
  shock: '충격이 감지되어 발사를 중단했습니다',
  sensor_saturated: '센서 측정 범위를 넘었습니다. 더 천천히 스윙하세요',
  data_gap: '스윙 중 센서 데이터가 끊겼습니다',
});

export function analyzeSwing(samples, options = {}) {
  const cfg = { ...DEFAULT_ANALYSIS, ...options };
  const pre = preprocess(samples, options.preprocess);
  if (!pre.ok) return invalid(pre.reason, { reasonText: REASON_TEXT[pre.reason] });
  const { fs, filtered: F, raw: R } = pre;
  const n = F.length;
  const dt = 1 / fs;

  // --- 2. activity --------------------------------------------------------
  const wmag = new Float64Array(n);
  const amag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    wmag[i] = Math.hypot(F.gx[i], F.gy[i], F.gz[i]);
    amag[i] = Math.hypot(F.ax[i], F.ay[i], F.az[i]);
  }
  const segs = segmentsAbove(wmag, cfg.activeOmega, fs, cfg.mergeGapSeconds);
  const base = { fs, sourceRateHz: pre.sourceRateHz, sourceCount: pre.sourceCount, gaps: pre.gaps, saturation: pre.saturation };
  if (segs.length === 0) return invalid('no_motion', { ...base, reasonText: REASON_TEXT.no_motion });
  let best = segs[0];
  let bestEnergy = -1;
  for (const s of segs) {
    let e = 0;
    for (let i = s[0]; i <= s[1]; i++) e += wmag[i] * wmag[i];
    if (e > bestEnergy) {
      bestEnergy = e;
      best = s;
    }
  }
  const [actStart, actEnd] = best;

  // --- 3. address ----------------------------------------------------------
  let qEnd = actStart - 1;
  // Allow the quiet window to end shortly before the burst (slow takeaway).
  while (qEnd > 0 && !(wmag[qEnd] < cfg.quietOmega && Math.abs(amag[qEnd] - G) < cfg.quietAccelDev) && actStart - qEnd < fs * 0.4) qEnd--;
  let qStart = qEnd;
  while (qStart > 0 && wmag[qStart - 1] < cfg.quietOmega && Math.abs(amag[qStart - 1] - G) < cfg.quietAccelDev) qStart--;
  let hasAddress = qEnd > 0 && (qEnd - qStart + 1) / fs >= cfg.minAddressSeconds;
  let refStart, refEnd;
  if (hasAddress) {
    // A slow takeaway stays under quietOmega for a while; keep that start of
    // the motion out of the gyro-bias window or it is subtracted from the
    // whole swing.
    refEnd = qEnd;
    while (refEnd > qStart + Math.round(cfg.minAddressSeconds * fs) && wmag[refEnd] > cfg.biasOmega) refEnd--;
    refStart = Math.max(qStart, qEnd - Math.round(0.5 * fs));
  } else {
    refEnd = Math.max(0, actStart - 1);
    refStart = Math.max(0, refEnd - Math.round(0.1 * fs));
  }
  const cnt = refEnd - refStart + 1;
  let aRef = [0, 0, 0];
  let bias = [0, 0, 0];
  for (let i = refStart; i <= refEnd; i++) {
    aRef = v3.add(aRef, [F.ax[i], F.ay[i], F.az[i]]);
    bias = v3.add(bias, [F.gx[i], F.gy[i], F.gz[i]]);
  }
  aRef = v3.scale(aRef, 1 / cnt);
  bias = hasAddress ? v3.scale(bias, 1 / cnt) : [0, 0, 0];
  if (v3.norm(aRef) < 1) aRef = [0, 0, G];

  // --- 4. orientation ------------------------------------------------------
  const i0 = refEnd; // integration start (end of address)
  const q0 = quat.fromTwoVectors(aRef, [0, 0, 1]);
  const qs = new Array(n);
  const wWorld = new Array(n);
  const wPlaneWorld = new Array(n);
  let q = q0;
  for (let i = 0; i < n; i++) {
    if (i <= i0) {
      qs[i] = q0;
    } else {
      const w = [F.gx[i - 1] - bias[0], F.gy[i - 1] - bias[1], F.gz[i - 1] - bias[2]];
      q = quat.integrateBody(q, w, dt);
      qs[i] = q;
    }
    const wb = [F.gx[i] - bias[0], F.gy[i] - bias[1], F.gz[i] - bias[2]];
    wWorld[i] = quat.rotate(qs[i], wb);
    // Rotation about the phone's own long axis (forearm roll) is not swing-plane
    // rotation: the shaft lies in the plane. Remove it for plane/angle work.
    const wbPlane = v3.sub(wb, v3.scale(cfg.longAxis, v3.dot(wb, cfg.longAxis)));
    wPlaneWorld[i] = quat.rotate(qs[i], wbPlane);
  }

  // --- 5. swing plane ------------------------------------------------------
  const actVecs = [];
  const actW = [];
  for (let i = actStart; i <= actEnd; i++) {
    actVecs.push(wPlaneWorld[i]);
    actW.push(1);
  }
  let axis = principalAxis(scatter(actVecs, actW)).vector;

  // --- 6. in-plane angular velocity and angle -------------------------------
  let wp = new Float64Array(n);
  for (let i = 0; i < n; i++) wp[i] = v3.dot(wPlaneWorld[i], axis);
  let maxP = -Infinity, minP = Infinity;
  for (let i = actStart; i <= actEnd; i++) {
    if (wp[i] > maxP) maxP = wp[i];
    if (wp[i] < minP) minP = wp[i];
  }
  // The downswing is the fastest rotation: make it positive.
  if (-minP > maxP) {
    axis = v3.scale(axis, -1);
    for (let i = 0; i < n; i++) wp[i] = -wp[i];
    [maxP, minP] = [-minP, -maxP];
  }
  const theta = new Float64Array(n);
  for (let i = i0 + 1; i < n; i++) theta[i] = theta[i - 1] + 0.5 * (wp[i] + wp[i - 1]) * dt;

  // Reversal count with hysteresis.
  let reversals = 0;
  let sign = 0;
  for (let i = actStart; i <= actEnd; i++) {
    const s = wp[i] > 1 ? 1 : wp[i] < -1 ? -1 : 0;
    if (s !== 0 && s !== sign) {
      if (sign !== 0) reversals++;
      sign = s;
    }
  }

  // --- 7. phases -------------------------------------------------------------
  let peakIdx = actStart;
  for (let i = actStart; i <= actEnd; i++) if (wp[i] > wp[peakIdx]) peakIdx = i;
  let topIdx = i0;
  for (let i = i0; i <= peakIdx; i++) if (theta[i] < theta[topIdx]) topIdx = i;
  // Backswing starts where motion begins after the address.
  let bsStart = i0;
  while (bsStart < topIdx && Math.abs(wp[bsStart]) < cfg.activeOmega * 0.5) bsStart++;

  const signals = buildSignals(F, wmag, amag, wp, theta, pre, 4);
  const common = {
    ...base,
    hasAddress,
    reversals,
    signals,
    axisWorld: axis,
  };

  const backswingDeg = -theta[topIdx] * RAD2DEG;
  if (backswingDeg < cfg.minBackswingDeg || topIdx <= bsStart) {
    const reason = reversals > cfg.maxReversals ? 'shake' : 'no_backswing';
    return invalid(reason, { ...common, reasonText: REASON_TEXT[reason] });
  }

  const target = (cfg.impactLeadDeg * Math.PI) / 180;
  let impactIdx = -1;
  for (let i = topIdx + 1; i < n; i++) {
    if (theta[i] >= target) {
      impactIdx = i;
      break;
    }
  }
  if (impactIdx < 0) {
    return invalid('incomplete_swing', { ...common, reasonText: REASON_TEXT.incomplete_swing,
      phases: { address: [F.t[refStart], F.t[refEnd]], backswing: [F.t[bsStart], F.t[topIdx]], top: F.t[topIdx] } });
  }
  const f = (target - theta[impactIdx - 1]) / (theta[impactIdx] - theta[impactIdx - 1] || 1);
  const tImpact = F.t[impactIdx - 1] + f * dt;

  // Finish: rotation settles after impact.
  let finishIdx = n - 1;
  const settle = Math.round(0.15 * fs);
  for (let i = impactIdx; i < n - settle; i++) {
    let quiet = true;
    for (let k = 0; k < settle; k++) if (wmag[i + k] > cfg.activeOmega) { quiet = false; break; }
    if (quiet) { finishIdx = i; break; }
  }
  let thetaMaxAfter = theta[impactIdx];
  for (let i = impactIdx; i <= finishIdx; i++) thetaMaxAfter = Math.max(thetaMaxAfter, theta[i]);

  // Peak in-plane angular velocity within the downswing/early follow-through.
  let dsPeakIdx = topIdx;
  const dsSearchEnd = Math.min(n - 1, impactIdx + Math.round(0.1 * fs));
  for (let i = topIdx; i <= dsSearchEnd; i++) if (wp[i] > wp[dsPeakIdx]) dsPeakIdx = i;
  const peakOmegaInPlane = wp[dsPeakIdx];
  let peakOmegaMag = 0;
  let peakAccel = 0;
  for (let i = 0; i < n; i++) {
    peakOmegaMag = Math.max(peakOmegaMag, Math.hypot(R.gx[i], R.gy[i], R.gz[i]));
    peakAccel = Math.max(peakAccel, Math.hypot(R.ax[i], R.ay[i], R.az[i]));
  }
  const omegaAtImpact = wp[impactIdx - 1] + f * (wp[impactIdx] - wp[impactIdx - 1]);

  const tBs = F.t[bsStart];
  const tTop = F.t[topIdx];
  const backswingSec = tTop - tBs;
  const downswingSec = tImpact - tTop;
  const tempoRatio = downswingSec > 0 ? backswingSec / downswingSec : Infinity;

  // Phone roll about its long axis at impact, relative to address.
  const qImpact = qs[impactIdx];
  const qRel = quat.mul(quat.conj(q0), qImpact);
  const faceRollDeg = quat.twistAngle(qRel, cfg.longAxis) * RAD2DEG;

  // Wrist action through impact.
  //  - lag retention: angular velocity at impact / peak (an early release or
  //    "cast" has already slowed down by impact)
  //  - release timing: peak time relative to impact (negative = before)
  //  - forearm rotation rate about the phone's long axis at impact
  //    (+ = face closing, - = held open)
  const lagRetention = peakOmegaInPlane > 0 ? omegaAtImpact / peakOmegaInPlane : 0;
  const releaseTimingMs = (F.t[dsPeakIdx] - tImpact) * 1000;
  const L = cfg.longAxis;
  const avgRoll = (i0r, i1r) => {
    let sum = 0;
    let m = 0;
    for (let i = Math.max(0, i0r); i <= Math.min(n - 1, i1r); i++) {
      sum += (F.gx[i] - bias[0]) * L[0] + (F.gy[i] - bias[1]) * L[1] + (F.gz[i] - bias[2]) * L[2];
      m++;
    }
    return m ? sum / m : 0;
  };
  const rollWin = Math.round(0.02 * fs);
  const forearmRollRate = -avgRoll(impactIdx - rollWin, impactIdx + rollWin);

  // Transition and acceleration zone.
  //  - transition drop: from the top, the hands should first fall (gravity
  //    and arms) while the club angle is held, instead of the club being
  //    thrown from the top. Measured over the first part of the downswing as
  //    the mean downward linear acceleration (world frame, gravity removed)
  //    and the share of the backswing angle already unwound.
  //  - acceleration zone: when the club gains energy fastest (max of
  //    omega * angular acceleration, i.e. rotational power), as a fraction
  //    of the downswing (0 = top, 1 = impact).
  const dsN = Math.max(1, impactIdx - topIdx);
  const winEnd = topIdx + Math.max(1, Math.round(cfg.transitionWindow * dsN));
  let dropSum = 0;
  for (let i = topIdx; i < winEnd; i++) {
    const aw = quat.rotate(qs[i], [F.ax[i], F.ay[i], F.az[i]]);
    dropSum += G - aw[2];
  }
  const transitionDropAccel = dropSum / (winEnd - topIdx);
  const transitionRotation = theta[topIdx] < 0 ? (theta[winEnd] - theta[topIdx]) / -theta[topIdx] : 0;
  const alphaHalf = Math.max(1, Math.round(0.01 * fs));
  let alphaPeak = -Infinity;
  let alphaIdx = topIdx;
  for (let i = topIdx + alphaHalf; i <= impactIdx - alphaHalf; i++) {
    const a = (Math.max(0, wp[i]) * (wp[i + alphaHalf] - wp[i - alphaHalf])) / (2 * alphaHalf * dt);
    if (a > alphaPeak) {
      alphaPeak = a;
      alphaIdx = i;
    }
  }
  const accelPeakPhase = (F.t[alphaIdx] - F.t[topIdx]) / Math.max(1e-6, tImpact - F.t[topIdx]);
  const accelPeakMs = (tImpact - F.t[alphaIdx]) * 1000;

  // Swing-plane shift between backswing and downswing (horizontal azimuth of
  // the plane normal). Experimental proxy for club path.
  const planeOf = (a, b) => {
    const vs = [];
    for (let i = a; i <= b; i++) vs.push(wPlaneWorld[i]);
    let ax = principalAxis(scatter(vs)).vector;
    if (v3.dot(ax, axis) < 0) ax = v3.scale(ax, -1);
    return ax;
  };
  const nBs = planeOf(bsStart, topIdx);
  const nDs = planeOf(topIdx, impactIdx);
  const az = (v) => Math.atan2(v[1], v[0]) * RAD2DEG;
  const horizontal = (v) => Math.hypot(v[0], v[1]);
  const planeShiftDeg = horizontal(nBs) > 0.2 && horizontal(nDs) > 0.2 ? wrapDeg(az(nDs) - az(nBs)) : 0;
  const planeTiltDeg = Math.acos(Math.min(1, Math.abs(axis[2]))) * RAD2DEG;

  // Shock: abrupt acceleration jump (dropped phone, hit an object).
  let maxJerk = 0;
  let shockT = null;
  for (let i = Math.max(1, bsStart); i <= finishIdx; i++) {
    const d = Math.abs(Math.hypot(R.ax[i], R.ay[i], R.az[i]) - Math.hypot(R.ax[i - 1], R.ay[i - 1], R.az[i - 1]));
    if (d > maxJerk) {
      maxJerk = d;
      shockT = R.t[i];
    }
  }

  // Quality score (0..1): tempo, smooth acceleration into impact, alignment of
  // the angular-velocity peak with the virtual impact, presence of an address.
  const tempoScore = Math.exp(-Math.pow((tempoRatio - 3) / 1.5, 2));
  let rising = 0, total = 0;
  for (let i = topIdx + 1; i <= dsPeakIdx; i++) {
    total++;
    if (wp[i] >= wp[i - 1] - 0.05) rising++;
  }
  const smoothScore = total ? rising / total : 0;
  const alignScore = Math.exp(-Math.pow((F.t[dsPeakIdx] - tImpact) / 0.06, 2));
  const qualityScore = 0.35 * tempoScore + 0.3 * smoothScore + 0.25 * alignScore + 0.1 * (hasAddress ? 1 : 0);

  const phases = {
    address: [F.t[refStart], F.t[refEnd]],
    backswing: [tBs, tTop],
    top: tTop,
    downswing: [tTop, tImpact],
    impact: tImpact,
    finish: [tImpact, F.t[finishIdx]],
  };

  const features = {
    sampleRateHz: feat(pre.sourceRateHz, 'Hz', 'measured'),
    peakOmega: feat(peakOmegaMag, 'rad/s', 'measured', '자이로 크기 최댓값'),
    peakAccel: feat(peakAccel, 'm/s^2', 'measured', '가속도 크기 최댓값 (중력 포함)'),
    peakOmegaInPlane: feat(peakOmegaInPlane, 'rad/s', 'derived', '스윙 평면 각속도 최댓값'),
    omegaAtImpact: feat(omegaAtImpact, 'rad/s', 'derived'),
    backswingDuration: feat(backswingSec, 's', 'derived'),
    downswingDuration: feat(downswingSec, 's', 'derived'),
    tempoRatio: feat(tempoRatio, 'ratio', 'derived', '백스윙:다운스윙 시간 비'),
    backswingAngle: feat(backswingDeg, 'deg', 'derived', '스윙 평면 내 회전각'),
    followThroughAngle: feat((thetaMaxAfter - theta[impactIdx]) * RAD2DEG, 'deg', 'derived'),
    planeTilt: feat(planeTiltDeg, 'deg', 'derived', '스윙 평면 축과 수직선 사이 각'),
    impactTime: feat(tImpact, 's', 'estimated', '가상 임팩트: 어드레스 각도로 복귀한 시점'),
    handSpeed: feat(Math.max(0, omegaAtImpact) * cfg.armRadius, 'm/s', 'estimated', `팔 길이 ${cfg.armRadius} m 가정`),
    faceRollDeg: feat(faceRollDeg, 'deg', 'estimated', '임팩트 시 휴대폰 장축 회전 (페이스 추정용, 미검증)'),
    lagRetention: feat(lagRetention, 'ratio', 'derived', '임팩트 각속도 / 최대 각속도 (래그 유지율)'),
    releaseTimingMs: feat(releaseTimingMs, 'ms', 'derived', '최대 각속도 시점 - 임팩트 (음수 = 임팩트 전)'),
    forearmRollRate: feat(forearmRollRate, 'rad/s', 'derived', '임팩트 시 전완 회전 속도 (+ 페이스 닫힘)'),
    transitionDropAccel: feat(transitionDropAccel, 'm/s^2', 'derived', '다운스윙 초반 아래 방향 가속도 평균 (수직 낙하)'),
    transitionRotation: feat(transitionRotation, 'ratio', 'derived', '다운스윙 초반에 이미 풀린 백스윙 각 비율'),
    accelPeakPhase: feat(accelPeakPhase, 'ratio', 'derived', '가속 구간 중심: 회전 에너지가 가장 빨리 늘어난 시점 (0 = 탑, 1 = 임팩트)'),
    accelPeakMs: feat(accelPeakMs, 'ms', 'derived', '가속 구간 중심: 임팩트 몇 ms 전'),
    planeShiftDeg: feat(planeShiftDeg, 'deg', 'estimated', '백스윙 대비 다운스윙 평면 방위 변화 (경로 추정용, 미검증)'),
    qualityScore: feat(qualityScore, '0-1', 'estimated'),
  };

  const result = {
    ...common,
    valid: true,
    reason: null,
    phases,
    features,
    shock: { maxJerk, t: shockT },
  };

  // --- 8. validity rules -------------------------------------------------------
  const fail = (reason) => ({ ...result, valid: false, reason, reasonText: REASON_TEXT[reason] });
  const swingStart = tBs - 0.05;
  const swingEnd = F.t[finishIdx];
  if (pre.gaps.some((g) => g.end > swingStart && g.start < tImpact + 0.05 && g.duration > cfg.maxGapInSwing)) return fail('data_gap');
  if (pre.saturation.some((s) => s.t >= swingStart && s.t <= tImpact + 0.05)) return fail('sensor_saturated');
  if (maxJerk > cfg.shockJerk) return fail('shock');
  if (reversals > cfg.maxReversals) return fail('shake');
  if (peakOmegaInPlane < cfg.minPeakOmega) return fail('too_slow');
  if (backswingSec < cfg.minBackswingSeconds || backswingSec > cfg.maxBackswingSeconds) return fail('irregular_tempo');
  if (downswingSec < cfg.minDownswingSeconds || downswingSec > cfg.maxDownswingSeconds) return fail('irregular_tempo');
  if (!(tempoRatio > 0.8 && tempoRatio < 10)) return fail('irregular_tempo');
  void swingEnd;
  return result;
}

/** Downsampled signals for plotting (every `step` samples). */
function buildSignals(F, wmag, amag, wp, theta, pre, step) {
  const out = { t: [], wmag: [], amag: [], wp: [], thetaDeg: [] };
  for (let i = 0; i < F.length; i += step) {
    out.t.push(F.t[i]);
    out.wmag.push(wmag[i]);
    out.amag.push(amag[i]);
    out.wp.push(wp[i]);
    out.thetaDeg.push(theta[i] * RAD2DEG);
  }
  return out;
}

/** Flatten features into { name: value } for the shot model. */
export function featureValues(result) {
  const o = {};
  if (!result || !result.features) return o;
  for (const [k, v] of Object.entries(result.features)) o[k] = v.value;
  return o;
}
