import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateShot,
  deliveryToLaunch,
  swingToShot,
  classifyShot,
  CLUBS,
  CLUB_ORDER,
  spinAxisVector,
} from '../src/index.js';

const MPH = 0.44704;
const YD = 0.9144;

// Public TrackMan tour averages: [label, ballSpeed mph, launch deg, spin rpm, carry yd]
const TOUR = [
  ['PGA driver', 167, 10.9, 2686, 275],
  ['PGA 3-wood', 158, 9.2, 3655, 243],
  ['PGA 5-iron', 132, 12.1, 5361, 194],
  ['PGA 7-iron', 120, 16.3, 7097, 172],
  ['PGA PW', 102, 24.2, 9304, 136],
  ['LPGA driver', 140, 13.2, 2611, 218],
  ['LPGA 7-iron', 104, 19, 6699, 141],
];

for (const [label, bs, la, spin, carryYd] of TOUR) {
  test(`carry within 8% of tour average: ${label}`, () => {
    const r = simulateShot({ ballSpeed: bs * MPH, launchAngle: la, launchDirection: 0, spinRate: spin, spinAxis: 0 });
    const err = (r.carry / YD - carryYd) / carryYd;
    assert.ok(Math.abs(err) < 0.08, `${label}: carry ${(r.carry / YD).toFixed(1)} yd vs ${carryYd} yd`);
  });
}

test('simulation is deterministic', () => {
  const launch = { ballSpeed: 60, launchAngle: 12, launchDirection: 1.5, spinRate: 3000, spinAxis: -7 };
  const a = simulateShot(launch);
  const b = simulateShot(launch);
  assert.deepEqual(a, b);
});

test('positive spin axis curves right, negative curves left', () => {
  const base = { ballSpeed: 70, launchAngle: 11, launchDirection: 0, spinRate: 2800 };
  const fade = simulateShot({ ...base, spinAxis: 10 });
  const draw = simulateShot({ ...base, spinAxis: -10 });
  const straight = simulateShot({ ...base, spinAxis: 0 });
  assert.ok(fade.carryLateral > 5);
  assert.ok(draw.carryLateral < -5);
  assert.ok(Math.abs(straight.carryLateral) < 1e-6);
  assert.ok(Math.abs(fade.carryLateral + draw.carryLateral) < 1e-6, 'mirror symmetry');
});

test('start direction moves the ball right without curvature', () => {
  const r = simulateShot({ ballSpeed: 60, launchAngle: 15, launchDirection: 5, spinRate: 5000, spinAxis: 0 });
  const expected = Math.tan((5 * Math.PI) / 180) * r.carryDownrange;
  assert.ok(Math.abs(r.carryLateral - expected) < 0.5);
});

test('headwind shortens carry, tailwind lengthens it', () => {
  const launch = { ballSpeed: 65, launchAngle: 12, launchDirection: 0, spinRate: 3000, spinAxis: 0 };
  const calm = simulateShot(launch).carry;
  const head = simulateShot(launch, { wind: [0, 0, -5] }).carry;
  const tail = simulateShot(launch, { wind: [0, 0, 5] }).carry;
  assert.ok(head < calm - 5);
  assert.ok(tail > calm + 3);
});

test('ball rolls after landing and stops', () => {
  const r = simulateShot({ ballSpeed: 74.6, launchAngle: 10.9, launchDirection: 0, spinRate: 2686, spinAxis: 0 });
  const roll = r.total - r.carry;
  assert.ok(roll > 5 && roll < 45, `driver roll ${roll.toFixed(1)} m`);
  assert.equal(r.points.at(-1).phase, 'stopped');
  assert.ok(r.descentAngle > 25 && r.descentAngle < 50);
});

test('wedge stops much quicker than driver', () => {
  const pw = simulateShot({ ballSpeed: 102 * MPH, launchAngle: 24.2, launchDirection: 0, spinRate: 9304, spinAxis: 0 });
  assert.ok(pw.total - pw.carry < 8);
});

test('spin axis vector: pure backspin points left for a ball heading downrange', () => {
  const a = spinAxisVector(0, 0);
  assert.ok(Math.abs(a[0] + 1) < 1e-9 && Math.abs(a[1]) < 1e-9 && Math.abs(a[2]) < 1e-9);
});

test('reference delivery reproduces the reference launch for every club', () => {
  for (const key of CLUB_ORDER) {
    const c = CLUBS[key];
    const l = deliveryToLaunch({ clubSpeed: c.refClubSpeed, faceAngle: 0, clubPath: 0 }, key);
    assert.ok(Math.abs(l.ballSpeed - c.smash * c.refClubSpeed) < 1e-9);
    assert.ok(Math.abs(l.launchAngle - c.refLaunch) < 1e-9);
    assert.ok(Math.abs(l.spinRate - c.refSpin) < 1e-6);
    assert.equal(l.spinAxis, 0);
  }
});

test('D-plane: face closed to path gives draw spin axis; open gives fade', () => {
  const draw = deliveryToLaunch({ clubSpeed: 45, faceAngle: 1, clubPath: 4 }, 'driver');
  const fade = deliveryToLaunch({ clubSpeed: 45, faceAngle: -1, clubPath: -4 }, 'driver');
  assert.ok(draw.spinAxis < -3 && draw.launchDirection > 0);
  assert.ok(fade.spinAxis > 3 && fade.launchDirection < 0);
  assert.equal(classifyShot(0, -8).label, '드로');
  assert.equal(classifyShot(0, 8).label, '페이드');
  assert.equal(classifyShot(0, -25).label, '훅');
  assert.equal(classifyShot(0, 25).label, '슬라이스');
  assert.equal(classifyShot(5, 0).label, '푸시');
  assert.equal(classifyShot(-5, 0).label, '풀');
  assert.equal(classifyShot(0.5, 1).label, '스트레이트');
});

test('swing power maps monotonically to distance and is capped', () => {
  const carries = [4, 7, 10, 13, 20].map((w) => {
    const shot = swingToShot({ peakOmega: w, qualityScore: 1 }, 'iron7');
    return simulateShot(shot.launch).carry;
  });
  for (let i = 1; i < 4; i++) assert.ok(carries[i] > carries[i - 1]);
  // 20 rad/s is far above the reference: capped, so close to the 13 rad/s value.
  assert.ok(carries[4] - carries[3] < 8, 'over-swinging is not rewarded');
});
