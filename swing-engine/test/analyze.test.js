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

test('phase detector: address 3 s -> backswing -> top -> downswing -> impact, for every real swing type', () => {
  for (const type of ['normal', 'draw', 'fade', 'half', 'fast', 'slow']) {
    for (const seed of [1, 5]) {
      const { samples, meta } = generateSwing({ type, seed });
      const hits = [];
      const states = [];
      const results = [];
      const det = new SwingDetector({ onImpact: (e) => hits.push(e), onState: (x) => states.push(x), onSwing: (r) => results.push(r), config: { autoRearm: false } });
      det.arm();
      for (const s of samples) det.push(s);
      const last = samples.at(-1);
      for (let i = 1; i <= 400; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
      assert.deepEqual(states.slice(0, 7), ['waitStill', 'ready', 'backswing', 'top', 'downswing', 'follow', 'cooldown'], `${type}/${seed}`);
      assert.equal(hits.length, 1, type);
      const err = hits[0].t - meta.truth.impact;
      assert.ok(Math.abs(err) < 0.05, `${type}: live impact ${(err * 1000).toFixed(0)} ms from truth`);
      assert.equal(results.length, 1);
      assert.equal(results[0].valid, true, `${type}: ${results[0].reason}`);
      // Live phase times line up with the generator's truth.
      assert.ok(Math.abs(results[0].livePhases.backswingStart - meta.truth.addressEnd) < 0.25, `${type} takeaway`);
      assert.ok(Math.abs(results[0].livePhases.top - meta.truth.top) < 0.15, `${type} top`);
    }
  }
});

test('phase detector never launches for a shake or an aborted downswing', () => {
  for (const type of ['shake', 'incomplete']) {
    const { samples } = generateSwing({ type, seed: 2 });
    const hits = [];
    const results = [];
    const det = new SwingDetector({ onImpact: (e) => hits.push(e), onSwing: (r) => results.push(r), config: { autoRearm: false } });
    det.arm();
    for (const s of samples) det.push(s);
    const last = samples.at(-1);
    for (let i = 1; i <= 400; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
    assert.equal(hits.length, 0, type);
    assert.equal(results.filter((r) => r.valid).length, 0, type);
  }
});

test('address needs 3 s of stillness with the phone tilted down', () => {
  // Screen standing up (gravity in the x-y plane), top pitched by ay.
  const still = (t, ay) => ({ t, ax: Math.sqrt(Math.max(0, 9.80665 ** 2 - ay * ay)), ay, az: 0, gx: 0.01, gy: 0, gz: 0 });
  // Flat phone (top level with the horizon): never ready.
  let det = new SwingDetector({ config: { autoRearm: false } });
  const hints = [];
  det.onHint = (h) => hints.push(h);
  det.arm();
  for (let i = 0; i < 1000; i++) det.push(still(i / 200, 0));
  assert.equal(det.state, 'waitStill');
  assert.ok(hints.some((h) => h && h.includes('아래')));
  // Tilted down: ready after 3 s, not before.
  det = new SwingDetector({ config: { autoRearm: false } });
  det.arm();
  for (let i = 0; i < 590; i++) det.push(still(i / 200, -8));
  assert.equal(det.state, 'waitStill');
  for (let i = 590; i < 640; i++) det.push(still(i / 200, -8));
  assert.equal(det.state, 'ready');
});

test('address needs the screen (club face) standing up toward the target', () => {
  // Top tilted down 50 deg but the screen lies facing the sky: no address.
  const g = 9.80665;
  const lying = (t) => ({ t, ax: 0, ay: -g * Math.sin(0.87), az: g * Math.cos(0.87), gx: 0, gy: 0, gz: 0 });
  const hints = [];
  const det = new SwingDetector({ onHint: (h) => h && hints.push(h), config: { autoRearm: false } });
  det.arm();
  for (let i = 0; i < 1000; i++) det.push(lying(i / 200));
  assert.equal(det.state, 'waitStill');
  assert.ok(hints.some((h) => h.includes('페이스')));
});

test('a takeaway toward the screen side is rejected (backswing goes toward the back)', () => {
  const { samples } = generateSwing({ type: 'normal', seed: 3 });
  // Mirror the rotation about x: the takeaway now turns toward the screen.
  const mirrored = samples.map((s) => ({ ...s, gx: -s.gx }));
  const hints = [];
  const results = [];
  const det = new SwingDetector({ onHint: (h) => h && hints.push(h), onSwing: (r) => results.push(r), config: { autoRearm: false } });
  det.arm();
  for (const s of mirrored) det.push(s);
  assert.equal(results.filter((r) => r.valid).length, 0);
  assert.ok(hints.some((h) => h.includes('뒷면')));
  // The same data is accepted with the direction setting flipped.
  const ok = [];
  const det2 = new SwingDetector({ onSwing: (r) => ok.push(r), config: { autoRearm: false, direction: -1 } });
  det2.arm();
  for (const s of mirrored) det2.push(s);
  const last = mirrored.at(-1);
  for (let i = 1; i <= 400; i++) det2.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
  assert.equal(ok.length, 1);
});

test('address checks the club-specific shaft lean (hands ahead for irons)', () => {
  const run = (leanDeg, cfg) => {
    const { samples } = generateSwing({ type: 'normal', seed: 4, addressLeanDeg: leanDeg });
    const hints = [];
    const ok = [];
    const det = new SwingDetector({ onHint: (h) => h && hints.push(h), onSwing: (r) => ok.push(r.valid), config: { autoRearm: false, ...cfg } });
    det.arm();
    for (const s of samples) det.push(s);
    const last = samples.at(-1);
    for (let i = 1; i <= 400; i++) det.push({ ...last, t: last.t + i / 200, gx: 0, gy: 0, gz: 0 });
    return { hints, ok };
  };
  // 7-iron posture (4 deg) with a 7-iron set-up: accepted.
  assert.deepEqual(run(4, { addressLeanDeg: 4 }).ok, [true]);
  // Wedge-like 14 deg lean while the driver (0 deg) is selected: no address, hint to stand the shaft up.
  const r = run(14, { addressLeanDeg: 0 });
  assert.deepEqual(r.ok, []);
  assert.ok(r.hints.some((h) => h.includes('세우세요')));
  // No lean while the wedge (7 deg) wants hands ahead... within tolerance (8 deg) it is still accepted.
  assert.deepEqual(run(0, { addressLeanDeg: 7 }).ok, [true]);
});

test('driver impact is just past the address angle (ascending), irons at the address angle', () => {
  const { samples, meta } = generateSwing({ type: 'normal', seed: 6 });
  const impactAt = (cfg) => {
    const hits = [];
    const det = new SwingDetector({ onImpact: (e) => hits.push(e.t), config: { autoRearm: false, ...cfg } });
    det.arm();
    for (const s of samples) det.push(s);
    return hits[0];
  };
  const iron = impactAt({ impactPastAddressDeg: 0 });
  const driver = impactAt({ impactPastAddressDeg: 4 });
  assert.ok(driver > iron, 'driver later');
  assert.ok(driver - iron < 0.03, 'only a few degrees later');
  // Offline analysis follows the same rule.
  const a0 = analyzeSwing(samples, { impactLeadDeg: 0 }).phases.impact;
  const a4 = analyzeSwing(samples, { impactLeadDeg: 4 }).phases.impact;
  assert.ok(a4 > a0 && Math.abs(a0 - meta.truth.impact) < 0.015);
});

test('wrist features: cast lowers lag retention, roll/hold change forearm roll rate (display only)', () => {
  const f = (type) => featureValues(analyzeSwing(generateSwing({ type, seed: 3 }).samples));
  const normal = f('normal');
  const cast = f('cast');
  const roll = f('roll');
  const hold = f('hold');
  for (const x of [normal, cast, roll, hold]) assert.ok(x.lagRetention > 0.5 && x.lagRetention <= 1.0001);
  assert.ok(cast.lagRetention < normal.lagRetention - 0.03);
  assert.ok(cast.releaseTimingMs < normal.releaseTimingMs);
  assert.ok(roll.forearmRollRate > normal.forearmRollRate + 1);
  assert.ok(hold.forearmRollRate < normal.forearmRollRate - 1);
});

test('transition and acceleration zone: drop, early/late acceleration, throw from the top', () => {
  const f = (type, extra = {}) => featureValues(analyzeSwing(generateSwing({ type, seed: 2, ...extra }).samples));
  const normal = f('normal');
  const noDrop = f('normal', { dropDepth: 0 });
  const early = f('early');
  const late = f('late');
  const cast = f('cast');
  // Hands dropping at the start of the downswing show as downward acceleration.
  assert.ok(normal.transitionDropAccel > noDrop.transitionDropAccel + 1);
  // Acceleration zone order and placement.
  assert.ok(normal.accelPeakPhase > 0.6 && normal.accelPeakPhase < 0.88, `normal ${normal.accelPeakPhase}`);
  assert.ok(early.accelPeakPhase < 0.55, `early ${early.accelPeakPhase}`);
  assert.ok(late.accelPeakPhase > 0.88, `late ${late.accelPeakPhase}`);
  assert.ok(cast.accelPeakPhase < 0.4);
  // Early slows before impact, late is still speeding up after it.
  assert.ok(early.releaseTimingMs < -100 && early.lagRetention < 0.9);
  assert.ok(late.releaseTimingMs > 30 && late.lagRetention < 0.95);
  assert.ok(normal.lagRetention > 0.95);
  // Throwing the club from the top unwinds more of the backswing early.
  assert.ok(cast.transitionRotation > normal.transitionRotation + 0.05);
});
