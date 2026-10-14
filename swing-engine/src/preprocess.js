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
 * Flag clipped samples: runs of identical values at the channel extreme, or
 * values at/over the declared sensor range.
 */
export function findSaturation(samples, opts) {
  const events = [];
  for (const c of CHANNELS) {
    const range = c[0] === 'a' ? opts.accelRange : opts.gyroRange;
    let maxAbs = 0;
    for (const s of samples) maxAbs = Math.max(maxAbs, Math.abs(s[c]));
    // Only large values can be clipping; a phone at rest repeats small values.
    const minClip = c[0] === 'a' ? opts.minAccelClip : opts.minGyroClip;
    if (maxAbs < minClip && !range) continue;
    let run = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i][c]);
      const atRange = range ? v >= range * 0.995 : false;
      const atMax = v >= maxAbs * 0.9999 && i > 0 && samples[i][c] === samples[i - 1][c];
      if (atRange || atMax) {
        run++;
        if (run === (atRange ? 1 : opts.saturationRun - 1)) events.push({ channel: c, t: samples[i].t });
      } else {
        run = 0;
      }
    }
  }
  return events;
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
  const saturation = findSaturation(samples, opts);
  const raw = resample(samples, opts.targetRate);
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
    raw,
    filtered,
  };
}
