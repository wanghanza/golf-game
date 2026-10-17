import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingToShot, deliveryToLaunch } from '../src/shot-model.js';
import { simulateShot } from '../src/flight.js';

// Wrist mapping is a game model (estimated), checked here for direction only.
const base = { peakOmega: 11, faceRollDeg: 0, planeShiftDeg: 0, qualityScore: 1 };
const fly = (extra) => {
  const shot = swingToShot({ ...base, ...extra }, 'driver');
  return { shot, flight: simulateShot(shot.launch) };
};

test('held lag vs early release (cast): cast is slower, higher, spinnier, shorter', () => {
  const held = fly({ lagRetention: 0.96 });
  const cast = fly({ lagRetention: 0.85 });
  assert.equal(held.shot.delivery.wrist.release, 1);
  assert.ok(cast.shot.delivery.wrist.release < 0.5);
  // Clubhead speed follows omega at impact: 0.85 / 0.96 of the held-lag speed.
  assert.ok(Math.abs(cast.shot.delivery.clubSpeed / held.shot.delivery.clubSpeed - 0.85 / 0.96) < 1e-9);
  assert.ok(cast.shot.launch.ballSpeed < held.shot.launch.ballSpeed);
  assert.ok(cast.shot.launch.launchAngle > held.shot.launch.launchAngle);
  // Less speed but more spin loft: spin per unit club speed goes up.
  const spinPerSpeed = (s) => s.launch.spinRate / s.delivery.clubSpeed;
  assert.ok(spinPerSpeed(cast.shot) > spinPerSpeed(held.shot) * 1.1);
  assert.ok(cast.flight.carry < held.flight.carry - 10);
});

test('extra dynamic loft follows impact geometry (spin ~ sin, speed ~ cos of spin loft)', () => {
  const d = { clubSpeed: 40, faceAngle: 0, clubPath: 0 };
  const a = deliveryToLaunch(d, 'iron7');
  const b = deliveryToLaunch({ ...d, dynamicLoftExtra: 4 }, 'iron7');
  const r = Math.PI / 180;
  assert.ok(Math.abs(b.spinRate / a.spinRate - Math.sin(32 * r) / Math.sin(28 * r)) < 1e-9);
  assert.ok(Math.abs(b.ballSpeed / a.ballSpeed - Math.cos(32 * r) / Math.cos(28 * r)) < 1e-9);
  assert.ok(Math.abs(b.launchAngle - a.launchAngle - 0.75 * 4) < 1e-9);
});

test('face direction comes from the face roll angle, wrist inputs absent or model off: unchanged shot', () => {
  const closed = swingToShot({ ...base, faceRollDeg: -6 }, 'iron7');
  const open = swingToShot({ ...base, faceRollDeg: 6 }, 'iron7');
  assert.ok(closed.delivery.faceAngle < 0 && open.delivery.faceAngle > 0);
  const a = swingToShot(base, 'iron7');
  const b = swingToShot({ ...base, lagRetention: 0.8 }, 'iron7', { wristModel: false });
  assert.deepEqual(a.launch, b.launch);
});
