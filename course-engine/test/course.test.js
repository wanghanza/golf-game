import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCourse, segDistance, headingTo } from '../src/index.js';

const course = createCourse();

test('18 holes, par 72, realistic total length', () => {
  assert.equal(course.holes.length, 18);
  assert.equal(course.par, 72);
  const total = course.holes.reduce((a, h) => a + h.yardage, 0);
  assert.ok(total > 5500 && total < 6600, `${total} m`);
  assert.equal(course.holes.filter((h) => h.par === 3).length, 4);
  assert.equal(course.holes.filter((h) => h.par === 5).length, 4);
});

test('fairways of non-consecutive holes stay at least 50 m apart', () => {
  const H = course.holes;
  for (let i = 0; i < 18; i++) {
    for (let j = i + 2; j < 18; j++) {
      let m = Infinity;
      for (let a = 0; a + 1 < H[i].path.length; a++) {
        for (let k = 0; k <= 30; k++) {
          const t = k / 30;
          const p = { x: H[i].path[a].x + (H[i].path[a + 1].x - H[i].path[a].x) * t, z: H[i].path[a].z + (H[i].path[a + 1].z - H[i].path[a].z) * t };
          for (let b = 0; b + 1 < H[j].path.length; b++) m = Math.min(m, segDistance(p.x, p.z, H[j].path[b], H[j].path[b + 1]).d);
        }
      }
      assert.ok(m >= 50, `holes ${i + 1} and ${j + 1} are ${m.toFixed(0)} m apart`);
    }
  }
});

test('every tee, green and pin is on land with the right surface', () => {
  for (const h of course.holes) {
    assert.equal(course.surfaceAt(h.tee.x, h.tee.z).name, 'tee', `hole ${h.number} tee`);
    assert.equal(course.surfaceAt(h.green.x, h.green.z).name, 'green', `hole ${h.number} green`);
    assert.equal(course.surfaceAt(h.pin.x, h.pin.z).name, 'green', `hole ${h.number} pin`);
    assert.ok(course.heightAt(h.tee.x, h.tee.z) > 5);
    assert.ok(course.heightAt(h.green.x, h.green.z) > 5);
  }
});

test('the whole playing corridor is above sea level', () => {
  for (const h of course.holes) {
    for (let s = 0; s <= 1; s += 0.05) {
      const i = Math.min(h.path.length - 2, Math.floor(s * (h.path.length - 1)));
      const t = s * (h.path.length - 1) - i;
      const x = h.path[i].x + (h.path[i + 1].x - h.path[i].x) * t;
      const z = h.path[i].z + (h.path[i + 1].z - h.path[i].z) * t;
      assert.ok(course.heightAt(x, z) > 3, `hole ${h.number} at ${s.toFixed(2)}`);
    }
  }
});

test('there is sea within view: the south coast is under water', () => {
  assert.equal(course.surfaceAt(0, -1150).name, 'water');
  assert.equal(course.surfaceAt(1250, 0).name, 'water');
});

test('greens are smooth and gently sloped (putting is possible)', () => {
  for (const h of course.holes) {
    for (const [dx, dz] of [[0, 0], [5, 0], [0, -6], [-4, 4]]) {
      const n = course.normalAt(h.green.x + dx, h.green.z + dz);
      const slope = Math.hypot(n.hx, n.hz);
      assert.ok(slope < 0.04, `hole ${h.number} green slope ${(slope * 100).toFixed(1)}%`);
    }
  }
});

test('terrain is deterministic', () => {
  const b = createCourse();
  for (const [x, z] of [[0, 0], [123.4, -456.7], [-800, 300]]) assert.equal(course.heightAt(x, z), b.heightAt(x, z));
});

test('headingTo uses compass degrees', () => {
  assert.equal(Math.round(headingTo({ x: 0, z: 0 }, { x: 0, z: 10 })), 0);
  assert.equal(Math.round(headingTo({ x: 0, z: 0 }, { x: 10, z: 0 })), 90);
});
