import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateShot, simulateOnTerrain, simulatePutt, puttSpeedFor, flatTerrain, SURFACES, localToWorld } from '../src/index.js';

const fairway = SURFACES.fairway;
const MPH = 0.44704;
const driver = { ballSpeed: 167 * MPH, launchAngle: 10.9, launchDirection: 0, spinRate: 2686, spinAxis: 0 };

test('flat terrain carry matches the range simulator', () => {
  const a = simulateShot(driver);
  const b = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 0, terrain: flatTerrain(fairway) });
  assert.ok(Math.abs(a.carry - b.carry) < 1.5, `${a.carry} vs ${b.carry}`);
});

test('heading rotates the shot: east-aimed shot lands east', () => {
  const r = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 90, terrain: flatTerrain(fairway) });
  assert.ok(r.landing.x > 200 && Math.abs(r.landing.z) < 1);
  const v = localToWorld([1, 0, 0], 0);
  assert.deepEqual(v.map((x) => Math.round(x)), [1, 0, 0]);
});

test('uphill shortens and downhill lengthens carry', () => {
  const up = { heightAt: (x, z) => z * 0.15, surfaceAt: () => fairway };
  const down = { heightAt: (x, z) => -z * 0.15, surfaceAt: () => fairway };
  const flat = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 0, terrain: flatTerrain(fairway) }).carry;
  const u = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 0, terrain: up }).carry;
  const d = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 0, terrain: down }).carry;
  assert.ok(u < flat - 15 && d > flat + 15, `up ${u} flat ${flat} down ${d}`);
});

test('a ball rolls down a slope and stops on flat ground', () => {
  // Green-speed surface: 10% slope for z < 20, flat after.
  const green = { name: 'green', rollingResistance: 0.06 };
  const t = { heightAt: (x, z) => (z < 20 ? (20 - z) * 0.1 : 0), surfaceAt: () => green };
  const r = simulatePutt({ origin: [0, 2, 0], heading: 0, speed: 0.1, terrain: t });
  assert.ok(r.rest.z > 20, `rest ${r.rest.z}`);
});

test('water stops the shot and reports the entry point', () => {
  const t = { heightAt: () => 0, surfaceAt: (x, z) => (z > 150 ? { name: 'water', water: true } : fairway) };
  const r = simulateOnTerrain(driver, { origin: [0, 0, 0], heading: 0, terrain: t });
  assert.equal(r.water, true);
  assert.ok(r.waterEntry.z > 150);
});

test('putting: right speed holes out, too fast lips out, too slow stays short', () => {
  const green = { name: 'green', rollingResistance: 0.06 };
  const t = flatTerrain(green);
  const cup = { x: 0, z: 5 };
  const holed = simulatePutt({ origin: [0, 0, 0], heading: 0, speed: puttSpeedFor(5.3), terrain: t, cup });
  assert.equal(holed.holed, true);
  const fast = simulatePutt({ origin: [0, 0, 0], heading: 0, speed: 3.5, terrain: t, cup });
  assert.equal(fast.holed, false);
  const slow = simulatePutt({ origin: [0, 0, 0], heading: 0, speed: puttSpeedFor(3.5), terrain: t, cup });
  assert.equal(slow.holed, false);
  assert.ok(Math.abs(slow.rest.z - 3.5) < 0.3, `slow rest ${slow.rest.z}`);
});

test('putt breaks with the slope', () => {
  const green = { name: 'green', rollingResistance: 0.06 };
  const sideSlope = { heightAt: (x) => -x * 0.02, surfaceAt: () => green };
  const r = simulatePutt({ origin: [0, 0, 0], heading: 0, speed: puttSpeedFor(6), terrain: sideSlope });
  assert.ok(r.rest.x > 0.15, `break ${r.rest.x}`);
});
