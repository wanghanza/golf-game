import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing, featureValues, SwingDetector, toCSV, fromCSV, makeMetadata, principalAxis, quat, preprocess } from '../src/index.js';
import { generateSwing } from '../../data-tools/src/synth.js';

// All data in this file is SYNTHETIC (data-tools/src/synth.js).

const VALID_TYPES = ['normal', 'draw', 'fade', 'fast', 'half'];

for (const type of VALID_TYPES) {
  test(`synthetic ${type} swing is accepted and phased correctly`, () => {
    for (const seed of [1, 2, 3]) {
      const { meta, samples } = generateSwing({ type, seed });
      const r = analyzeSwing(samples);
      assert.equal(r.valid, true, `${type}/${seed}: ${r.reason}`);
      const tr = meta.truth;
      assert.ok(Math.abs(r.phases.impact - tr.impact) < 0.015, `impact error ${(r.phases.impact - tr.impact) * 1000} ms`);
      assert.ok(Math.abs(r.phases.top - tr.top) < 0.05, 'top time (truth = start of the 40 ms pause at the top)');
      assert.ok(r.phases.address[1] <= r.phases.backswing[0] + 0.05, 'address before backswing');
      assert.ok(r.phases.backswing[1] <= r.phases.impact && r.phases.impact <= r.phases.finish[1], 'phase order');
      const f = featureValues(r);
      assert.ok(Math.abs(f.peakOmegaInPlane - tr.peakOmega) / tr.peakOmega < 0.08, 'peak omega');
      assert.ok(Math.abs(f.backswingAngle - tr.backswingDeg) < 10, 'backswing angle');
      assert.ok(Math.abs(f.faceRollDeg - tr.faceTwistDeg) < 1.5, `face twist ${f.faceRollDeg} vs ${tr.faceTwistDeg}`);
      assert.ok(Math.abs(f.planeShiftDeg - tr.planeShiftDeg) < 1.5, `plane shift ${f.planeShiftDeg} vs ${tr.planeShiftDeg}`);
    }
  });
}

test('slow swing is accepted with a looser impact tolerance', () => {
  const { meta, samples } = generateSwing({ type: 'slow', seed: 4 });
  const r = analyzeSwing(samples);
  assert.equal(r.valid, true, r.reason);
  assert.ok(Math.abs(r.phases.impact - meta.truth.impact) < 0.05);
});

const REJECT = { incomplete: 'incomplete_swing', shake: 'shake', shock: 'shock', saturated: 'sensor_saturated' };
for (const [type, reason] of Object.entries(REJECT)) {
  test(`synthetic ${type} motion is rejected (${reason})`, () => {
    for (const seed of [1, 2]) {
      const { samples } = generateSwing({ type, seed });
      const r = analyzeSwing(samples);
      assert.equal(r.valid, false);
      assert.equal(r.reason, reason);
    }
  });
}

test('phone at rest is rejected as no motion', () => {
  const samples = [];
  for (let i = 0; i < 400; i++) samples.push({ t: i / 200, ax: 0.01, ay: 9.8, az: 0.2, gx: 0.001, gy: -0.002, gz: 0 });
  const r = analyzeSwing(samples);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no_motion');
});

test('empty and garbage input does not throw', () => {
  assert.equal(analyzeSwing([]).valid, false);
  assert.equal(analyzeSwing([{ t: NaN }, null, { t: 1, ax: 'x' }]).valid, false);
});

test('analysis is deterministic', () => {
  const { samples } = generateSwing({ type: 'draw', seed: 9 });
  assert.deepEqual(analyzeSwing(samples), analyzeSwing(samples));
});

test('works at 100 Hz and 50 Hz input rates', () => {
  for (const rate of [100, 50]) {
    const { meta, samples } = generateSwing({ type: 'normal', seed: 5, rate });
    const r = analyzeSwing(samples);
    assert.equal(r.valid, true, `${rate} Hz: ${r.reason}`);
    assert.ok(Math.abs(r.features.sampleRateHz.value - rate) / rate < 0.05);
    assert.ok(Math.abs(r.phases.impact - meta.truth.impact) < 0.03);
  }
});

test('a data gap during the downswing invalidates the swing', () => {
  const { meta, samples } = generateSwing({ type: 'normal', seed: 6 });
  const t = meta.truth.impact;
  const cut = samples.filter((s) => s.t < t - 0.12 || s.t > t - 0.04);
  const r = analyzeSwing(cut);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'data_gap');
});

test('features carry provenance labels', () => {
  const { samples } = generateSwing({ type: 'normal', seed: 1 });
  const r = analyzeSwing(samples);
  assert.equal(r.features.peakOmega.source, 'measured');
  assert.equal(r.features.tempoRatio.source, 'derived');
  assert.equal(r.features.faceRollDeg.source, 'estimated');
  assert.equal(r.features.impactTime.source, 'estimated');
});

test('real-time detector launches once for a swing and never for a shake', () => {
  for (const [type, expectValid] of [['normal', true], ['shake', false]]) {
    const { samples } = generateSwing({ type, seed: 2 });
    const results = [];
    const det = new SwingDetector({ onSwing: (r) => results.push(r), config: { autoRearm: false } });
    det.arm();
    for (const s of samples) det.push(s);
    // Append quiet tail so the detector can finish.
    const last = samples.at(-1);
    for (let i = 1; i <= 200; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
    const launches = results.filter((r) => r.valid);
    assert.equal(launches.length, expectValid ? 1 : 0, `${type}: ${results.map((r) => r.reason).join(',')}`);
  }
});

test('CSV round trip keeps samples', () => {
  const { samples } = generateSwing({ type: 'normal', seed: 1 });
  const back = fromCSV(toCSV(samples));
  assert.equal(back.length, samples.length);
  for (const k of ['t', 'ax', 'gz']) assert.ok(Math.abs(back[100][k] - samples[100][k]) < 1e-4);
  const meta = makeMetadata({ id: 'x', samples, analysis: analyzeSwing(samples), swingType: 'normal' });
  assert.equal(meta.schema, 'golf-swing-reader/recording@1');
  assert.equal(meta.sampleCount, samples.length);
  assert.ok(meta.measuredRateHz > 190 && meta.measuredRateHz < 210);
});

test('principal axis of a symmetric matrix', () => {
  const r = principalAxis([[2, 1, 0], [1, 2, 0], [0, 0, 1]]);
  assert.ok(Math.abs(Math.abs(r.vector[0]) - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(Math.abs(r.vector[1]) - Math.SQRT1_2) < 1e-6);
});

test('quaternion integration of constant rate', () => {
  let q = quat.identity();
  for (let i = 0; i < 1000; i++) q = quat.integrateBody(q, [0, 0, Math.PI / 2], 0.001);
  const v = quat.rotate(q, [1, 0, 0]);
  assert.ok(Math.abs(v[0]) < 1e-6 && Math.abs(v[1] - 1) < 1e-6);
});

test('preprocess flags clipping at the declared range', () => {
  const s = [];
  for (let i = 0; i < 100; i++) s.push({ t: i / 100, ax: 0, ay: 9.8, az: 0, gx: i > 50 && i < 55 ? 34.9 : 0, gy: 0, gz: 0 });
  const p = preprocess(s, { gyroRange: 34.9 });
  assert.ok(p.saturation.length > 0);
});

test('countdown delays the address check, then the swing is detected', () => {
  const { samples } = generateSwing({ type: 'normal', seed: 3 });
  const states = [];
  const results = [];
  const det = new SwingDetector({ onState: (s) => states.push(s), onSwing: (r) => results.push(r), config: { autoRearm: false } });
  det.arm({ delaySeconds: 0.3 });
  assert.equal(det.state, 'countdown');
  for (const s of samples) det.push(s);
  const last = samples.at(-1);
  for (let i = 1; i <= 200; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
  assert.deepEqual(states.slice(0, 3), ['countdown', 'waitStill', 'ready']);
  assert.equal(results.filter((r) => r.valid).length, 1);
});

test('live impact cue fires once near the real impact, never for a shake or an aborted swing; slow swings complete', () => {
  for (const [type, expected] of [['normal', 1], ['draw', 1], ['half', 1], ['slow', 1], ['shake', 0], ['incomplete', 0]]) {
    const { samples, meta } = generateSwing({ type, seed: 5 });
    const hits = [];
    const det = new SwingDetector({ onImpact: (e) => hits.push(e), config: { autoRearm: false } });
    det.arm();
    const results = [];
    det.onSwing = (r) => results.push(r);
    for (const s of samples) det.push(s);
    const last = samples.at(-1);
    for (let i = 1; i <= 400; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
    assert.equal(hits.length, expected, type);
    assert.equal(results.length, 1, `${type}: one analysis per motion`);
    if (expected) assert.equal(results[0].valid, true, `${type}: ${results[0].reason}`);
    if (expected) {
      const err = hits[0].t - meta.truth.impact;
      // Slightly early on purpose (5% before full return) to offset audio output latency.
      assert.ok(err > -0.15 && err < 0.05, `${type}: live impact ${(err * 1000).toFixed(0)} ms from truth`);
    }
  }
});
