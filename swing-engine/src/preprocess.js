// Sensor stream cleaning: ordering, sample-rate estimation, gap and
// saturation detection, uniform resampling and low-pass filtering.
//
// Input samples: { t (s), ax, ay, az (m/s^2, includes gravity), gx, gy, gz (rad/s) }
// in the Android sensor coordinate system (x right, y up along the long
// edge, z out of the screen).

import { butterLowpass, filtfilt } from './filters.js';

export const CHANNELS = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];

export const DEFAULT_PREPROCESS = Object.freeze({
  targetRate: 200, // Hz
  gapFactor: 3, // a dt larger than gapFactor * median dt is a gap
  minGapSeconds: 0.03,
  cutoffHz: 20, // low-pass cutoff; swing motion content is well below this
  saturationRun: 3, // identical extreme values in a row => clipped
  accelRange: null, // m/s^2, sensor max range if known (from metadata)
  gyroRange: null, // rad/s
  minAccelClip: 39, // m/s^2 (4 g): smallest full-scale range on phones in practice
  minGyroClip: 8.7, // rad/s (500 dps)
});

export function median(arr) {
  if (arr.length === 0) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Validate and sort, dropping non-finite and duplicate-time samples. */
export function cleanSamples(samples) {
  const out = [];
  let dropped = 0;
  for (const s of samples) {
    if (!s || !Number.isFinite(s.t) || CHANNELS.some((c) => !Number.isFinite(s[c]))) {
      dropped++;
      continue;
    }
    out.push(s);
  }
  out.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const s of out) {
    if (dedup.length && s.t <= dedup[dedup.length - 1].t) {
      dropped++;
      continue;
    }
    dedup.push(s);
  }
  return { samples: dedup, dropped };
}

export function estimateRate(samples) {
  if (samples.length < 2) return { rateHz: 0, medianDt: NaN };
  const dts = [];
  for (let i = 1; i < samples.length; i++) dts.push(samples[i].t - samples[i - 1].t);
  const medianDt = median(dts);
  return { rateHz: medianDt > 0 ? 1 / medianDt : 0, medianDt };
}

export function findGaps(samples, medianDt, opts) {
  const thr = Math.max(opts.gapFactor * medianDt, opts.minGapSeconds);
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt > thr) gaps.push({ start: samples[i - 1].t, end: samples[i].t, duration: dt });
  }
  return gaps;
}

/**
 * Clipped stretches: runs of identical values at the channel extreme, or
 * values at/over the declared sensor range. Returns runs with sample indices.
 */
export function findClipRuns(samples, opts) {
  const runs = [];
  for (const c of CHANNELS) {
    const range = c[0] === 'a' ? opts.accelRange : opts.gyroRange;
    let maxAbs = 0;
    for (const s of samples) maxAbs = Math.max(maxAbs, Math.abs(s[c]));
    // Only large values can be clipping; a phone at rest repeats small values.
    const minClip = c[0] === 'a' ? opts.minAccelClip : opts.minGyroClip;
    if (maxAbs < minClip && !range) continue;
    let start = -1;
    let byRange = false;
    const close = (end) => {
      const n = end - start + 1;
      if (start >= 0 && (byRange || n >= opts.saturationRun)) {
        runs.push({ channel: c, i0: start, i1: end, t0: samples[start].t, t1: samples[end].t, level: Math.abs(samples[start][c]) });
      }
      start = -1;
      byRange = false;
    };
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i][c]);
      const atRange = range ? v >= range * 0.995 : false;
      const atMax = v >= maxAbs * 0.9999 && (atRange || (i > 0 && samples[i][c] === samples[i - 1][c]) || (i + 1 < samples.length && samples[i + 1][c] === samples[i][c]));
      if (atRange || atMax) {
        if (start < 0) start = i;
        byRange = byRange || atRange;
      } else if (start >= 0) {
        close(i - 1);
      }
    }
    if (start >= 0) close(samples.length - 1);
  }
  return runs;
}

/** Saturation events (first clipped sample of each run), kept for reporting. */
export function findSaturation(samples, opts) {
  return findClipRuns(samples, opts).map((r) => ({ channel: r.channel, t: r.t0, t1: r.t1 }));
}

/**
 * Fill clipped gyro runs with a quadratic through the samples around them
 * (the true peak lies above the clip level). Returns repaired copies.
 */
export function repairClipped(samples, runs) {
  const out = samples.map((s) => ({ ...s }));
  for (const r of runs) {
    if (r.channel[0] !== 'g') continue;
    const idx = [r.i0 - 2, r.i0 - 1, r.i1 + 1, r.i1 + 2].filter((i) => i >= 0 && i < samples.length);
    if (idx.length < 3) continue;
    // Least-squares quadratic v(t) = a + b u + c u^2, u = t - tmid.
    const tm = (samples[r.i0].t + samples[r.i1].t) / 2;
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const B = [0, 0, 0];
    for (const i of idx) {
      const u = samples[i].t - tm;
      const row = [1, u, u * u];
      for (let j = 0; j < 3; j++) {
        B[j] += row[j] * samples[i][r.channel];
        for (let k = 0; k < 3; k++) S[j][k] += row[j] * row[k];
      }
    }
    const coef = solve3(S, B);
    if (!coef) continue;
    const sign = Math.sign(samples[r.i0][r.channel]) || 1;
    for (let i = r.i0; i <= r.i1; i++) {
      const u = samples[i].t - tm;
      const fit = coef[0] + coef[1] * u + coef[2] * u * u;
      // Never below the clip level, and at most 2x it.
      out[i][r.channel] = sign * Math.min(2 * r.level, Math.max(r.level, Math.abs(fit)));
    }
  }
  return out;
}

function solve3(A, b) {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Linear resampling onto a uniform grid. */
export function resample(samples, rate) {
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const n = Math.max(1, Math.floor((t1 - t0) * rate) + 1);
  const out = { t: new Float64Array(n) };
  for (const c of CHANNELS) out[c] = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / rate;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    out.t[i] = t;
    for (const c of CHANNELS) out[c][i] = a[c] + (b[c] - a[c]) * f;
  }
  out.length = n;
  return out;
}

export function preprocess(rawSamples, options = {}) {
  const opts = { ...DEFAULT_PREPROCESS, ...options };
  const { samples, dropped } = cleanSamples(rawSamples);
  if (samples.length < 10) {
    return { ok: false, reason: 'too_few_samples', dropped, sourceCount: rawSamples.length };
  }
  const { rateHz, medianDt } = estimateRate(samples);
  const gaps = findGaps(samples, medianDt, opts);
  const clipRuns = findClipRuns(samples, opts);
  const saturation = clipRuns.map((r) => ({ channel: r.channel, t: r.t0, t1: r.t1 }));
  const raw = resample(repairClipped(samples, clipRuns), opts.targetRate);
  const coeffs = butterLowpass(opts.cutoffHz, opts.targetRate);
  const filtered = { t: raw.t, length: raw.length };
  for (const c of CHANNELS) filtered[c] = filtfilt(raw[c], coeffs);
  return {
    ok: true,
    fs: opts.targetRate,
    sourceRateHz: rateHz,
    sourceCount: samples.length,
    dropped,
    gaps,
    saturation,
    clipRuns,
    accelRange: opts.accelRange,
    gyroRange: opts.gyroRange,
    raw,
    filtered,
  };
}
