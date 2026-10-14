import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSwing, SWING_TYPES } from '../src/synth.js';

const G = 9.80665;

test('generator is deterministic for a seed and labelled synthetic', () => {
  const a = generateSwing({ type: 'normal', seed: 3 });
  const b = generateSwing({ type: 'normal', seed: 3 });
  assert.deepEqual(a, b);
  assert.equal(a.meta.synthetic, true);
});

test('every swing type generates finite samples', () => {
  for (const type of Object.keys(SWING_TYPES)) {
    const { samples } = generateSwing({ type, seed: 1 });
    assert.ok(samples.length > 300);
    for (const s of samples) for (const k of ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz']) assert.ok(Number.isFinite(s[k]));
  }
});

test('phone at address reads gravity only', () => {
  const { samples } = generateSwing({ type: 'normal', seed: 1 });
  const early = samples.filter((s) => s.t < 0.5);
  const mean = early.reduce((m, s) => m + Math.hypot(s.ax, s.ay, s.az), 0) / early.length;
  assert.ok(Math.abs(mean - G) < 0.1);
  const w = early.reduce((m, s) => Math.max(m, Math.hypot(s.gx, s.gy, s.gz)), 0);
  assert.ok(w < 0.1);
});

test('gyro magnitude reflects the requested peak angular velocity', () => {
  const { meta, samples } = generateSwing({ type: 'normal', seed: 1, peakOmega: 9 });
  const peak = samples.reduce((m, s) => Math.max(m, Math.hypot(s.gx, s.gy, s.gz)), 0);
  assert.ok(Math.abs(meta.truth.peakOmega - 9) < 0.05);
  assert.ok(peak > 8.5 && peak < 11);
});
