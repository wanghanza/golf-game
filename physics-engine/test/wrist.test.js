import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingToShot } from '../src/shot-model.js';
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
  assert.ok(cast.shot.delivery.clubSpeed < held.shot.delivery.clubSpeed);
  assert.ok(cast.shot.launch.ballSpeed < held.shot.launch.ballSpeed);
  assert.ok(cast.shot.launch.launchAngle > held.shot.launch.launchAngle);
  assert.ok(cast.shot.launch.spinRate > held.shot.launch.spinRate);
  assert.ok(cast.flight.carry < held.flight.carry - 5);
});

test('forearm roll: fast rotation closes the face (left), held rotation opens it (right)', () => {
  const neutral = fly({ rollRatio: 0.23 });
  const roll = fly({ rollRatio: 0.5 });
  const hold = fly({ rollRatio: 0.0 });
  assert.ok(Math.abs(neutral.shot.delivery.faceAngle) < 0.01);
  assert.ok(roll.shot.delivery.faceAngle < -1);
  assert.ok(hold.shot.delivery.faceAngle > 1);
  assert.ok(roll.flight.totalLateral < neutral.flight.totalLateral);
  assert.ok(hold.flight.totalLateral > neutral.flight.totalLateral);
});

test('wrist inputs absent or model off: unchanged shot', () => {
  const a = swingToShot(base, 'iron7');
  const b = swingToShot({ ...base, lagRetention: 0.8, rollRatio: 0.6 }, 'iron7', { wristModel: false });
  assert.deepEqual(a.launch, b.launch);
});
