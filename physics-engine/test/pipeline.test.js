import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingToShot, simulateShot } from '../src/index.js';
import { analyzeSwing, featureValues } from '../../swing-engine/src/index.js';
import { generateSwing } from '../../data-tools/src/synth.js';

// End-to-end on SYNTHETIC sensor data: sensors -> analysis -> virtual club -> flight.
function play(type, seed, club = 'iron7') {
  const { samples } = generateSwing({ type, seed });
  const r = analyzeSwing(samples);
  assert.equal(r.valid, true, `${type}: ${r.reason}`);
  const f = featureValues(r);
  const shot = swingToShot({ peakOmega: f.peakOmegaInPlane, faceRollDeg: f.faceRollDeg, planeShiftDeg: f.planeShiftDeg, qualityScore: f.qualityScore }, club);
  return { shot, flight: simulateShot(shot.launch) };
}

test('synthetic draw / fade / normal swings produce matching shot shapes', () => {
  for (const seed of [1, 2, 3]) {
    assert.equal(play('draw', seed).shot.shape.label, '드로');
    assert.equal(play('fade', seed).shot.shape.label, '페이드');
    assert.equal(play('normal', seed).shot.shape.label, '스트레이트');
  }
});

test('draw curves left of its start line, fade curves right', () => {
  const d = play('draw', 1).flight;
  const f = play('fade', 1).flight;
  assert.ok(d.carryLateral < f.carryLateral);
});

test('slow swing flies shorter than normal, which flies no further than fast (power cap)', () => {
  const slow = play('slow', 1).flight.carry;
  const normal = play('normal', 1).flight.carry;
  const fast = play('fast', 1).flight.carry;
  assert.ok(slow < normal - 20, `slow ${slow} vs normal ${normal}`);
  // maxPowerRatio 1.05 -> at most ~5% more club speed, ~10% more carry.
  assert.ok(fast <= normal * 1.12, `fast ${fast} vs normal ${normal}`);
});

test('driver goes further than 7-iron for the same swing', () => {
  assert.ok(play('normal', 1, 'driver').flight.total > play('normal', 1, 'iron7').flight.total + 30);
});
