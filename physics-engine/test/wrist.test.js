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

test('lag: club speed follows omega at impact', () => {
  const held = fly({ lagRetention: 0.96 });
  const lost = fly({ lagRetention: 0.85 });
  assert.ok(Math.abs(lost.shot.delivery.clubSpeed / held.shot.delivery.clubSpeed - 0.85 / 0.96) < 1e-9);
  assert.ok(lost.flight.carry < held.flight.carry - 10);
});

test('acceleration zone: early adds loft and spin, late delofts and leaves the face open', () => {
  const good = fly({ accelPeakPhase: 0.75 });
  const early = fly({ accelPeakPhase: 0.3 });
  const late = fly({ accelPeakPhase: 0.98 });
  assert.equal(good.shot.delivery.wrist.early + good.shot.delivery.wrist.late, 0);
  assert.equal(early.shot.delivery.wrist.early, 1);
  assert.ok(late.shot.delivery.wrist.late > 0.99);
  assert.ok(early.shot.launch.launchAngle > good.shot.launch.launchAngle + 2);
  assert.ok(early.shot.launch.spinRate > good.shot.launch.spinRate);
  assert.ok(early.shot.delivery.faceAngle < good.shot.delivery.faceAngle);
  assert.ok(late.shot.launch.launchAngle < good.shot.launch.launchAngle - 1);
  assert.ok(late.shot.delivery.faceAngle > good.shot.delivery.faceAngle + 1);
  assert.ok(late.flight.totalLateral > good.flight.totalLateral + 3);
});

test('transition: throwing from the top steepens the downswing, a natural drop does not', () => {
  const drop = swingToShot({ ...base, transitionRotation: 0.08, transitionDropAccel: 2 }, 'iron7');
  const thrown = swingToShot({ ...base, transitionRotation: 0.3, transitionDropAccel: 2 }, 'iron7');
  const noDrop = swingToShot({ ...base, transitionRotation: 0.08, transitionDropAccel: -1 }, 'iron7');
  assert.equal(drop.delivery.wrist.steep, 0);
  assert.equal(thrown.delivery.wrist.steep, 1);
  assert.ok(Math.abs(noDrop.delivery.wrist.steep - 0.4) < 1e-9);
  assert.ok(thrown.delivery.clubPath < drop.delivery.clubPath - 1);
  assert.ok(thrown.delivery.attackAngle < drop.delivery.attackAngle - 1);
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
  const b = swingToShot({ ...base, lagRetention: 0.8, accelPeakPhase: 0.2, transitionRotation: 0.4 }, 'iron7', { wristModel: false });
  assert.deepEqual(a.launch, b.launch);
});
