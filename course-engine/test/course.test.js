import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCourse, segDistance, headingTo, carryAmount, COURSES, COURSE_ORDER } from '../src/index.js';

// Points that must be open sea, per course.
const SEA_POINTS = { autumn: [[0, -1150], [1250, 0]], pinebeach: [[-800, -600], [750, -800], [115, -2140], [-260, -1775]] };

for (const id of COURSE_ORDER) {
const course = createCourse(COURSES[id]);
const name = (t) => `${course.name}: ${t}`;

test(name('18 holes, par 72, realistic total length'), () => {
  assert.equal(course.holes.length, 18);
  assert.equal(course.par, 72);
  const total = course.holes.reduce((a, h) => a + h.yardage, 0);
  assert.ok(total > 5500 && total < 6600, `${total} m`);
  assert.equal(course.holes.filter((h) => h.par === 3).length, 4);
  assert.equal(course.holes.filter((h) => h.par === 5).length, 4);
});

test(name('fairways of non-consecutive holes stay at least 50 m apart'), () => {
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

test(name('every tee, green and pin is on land with the right surface'), () => {
  for (const h of course.holes) {
    assert.equal(course.surfaceAt(h.tee.x, h.tee.z).name, 'tee', `hole ${h.number} tee`);
    assert.equal(course.surfaceAt(h.green.x, h.green.z).name, 'green', `hole ${h.number} green`);
    assert.equal(course.surfaceAt(h.pin.x, h.pin.z).name, 'green', `hole ${h.number} pin`);
    assert.ok(course.heightAt(h.tee.x, h.tee.z) > 5);
    assert.ok(course.heightAt(h.green.x, h.green.z) > 5);
  }
});

test(name('the whole playing corridor is above sea level'), () => {
  for (const h of course.holes) {
    for (let s = 0; s <= 1; s += 0.05) {
      const i = Math.min(h.path.length - 2, Math.floor(s * (h.path.length - 1)));
      const t = s * (h.path.length - 1) - i;
      const x = h.path[i].x + (h.path[i + 1].x - h.path[i].x) * t;
      const z = h.path[i].z + (h.path[i + 1].z - h.path[i].z) * t;
      if (carryAmount(h, s) > 0) continue; // forced carry over the sea
      assert.ok(course.heightAt(x, z) > 3, `hole ${h.number} at ${s.toFixed(2)}`);
    }
  }
});

test(name('there is sea within view: the south coast is under water'), () => {
  for (const [x, z] of SEA_POINTS[id]) assert.equal(course.surfaceAt(x, z).name, 'water', `${x},${z}`);
});

test(name('greens are smooth and gently sloped (putting is possible)'), () => {
  for (const h of course.holes) {
    for (const [dx, dz] of [[0, 0], [5, 0], [0, -6], [-4, 4]]) {
      const n = course.normalAt(h.green.x + dx, h.green.z + dz);
      const slope = Math.hypot(n.hx, n.hz);
      assert.ok(slope < 0.04, `hole ${h.number} green slope ${(slope * 100).toFixed(1)}%`);
    }
  }
});

test(name('terrain is deterministic'), () => {
  const b = createCourse(COURSES[id]);
  for (const [x, z] of [[0, 0], [123.4, -456.7], [-800, 300]]) assert.equal(course.heightAt(x, z), b.heightAt(x, z));
});

}

test('headingTo uses compass degrees', () => {
  assert.equal(Math.round(headingTo({ x: 0, z: 0 }, { x: 0, z: 10 })), 0);
  assert.equal(Math.round(headingTo({ x: 0, z: 0 }, { x: 10, z: 0 })), 90);
});

test('Pine Beach-style course: two par 3s carry over open sea, about ten holes on the coast', () => {
  const c = createCourse(COURSES.pinebeach);
  const carries = c.holes.filter((h) => h.carry);
  assert.deepEqual(carries.map((h) => h.number), [6, 15]);
  for (const h of carries) {
    assert.equal(h.par, 3);
    let water = 0;
    for (let k = 0; k <= 40; k++) {
      const s = k / 40;
      const i = Math.min(h.path.length - 2, Math.floor(s * (h.path.length - 1)));
      const t = s * (h.path.length - 1) - i;
      const x = h.path[i].x + (h.path[i + 1].x - h.path[i].x) * t;
      const z = h.path[i].z + (h.path[i + 1].z - h.path[i].z) * t;
      if (c.surfaceAt(x, z).name === 'water') water++;
    }
    assert.ok((water / 41) * h.yardage > 60, `hole ${h.number}: ${((water / 41) * h.yardage).toFixed(0)} m of sea`);
  }
  // Coastal: open sea within 120 m of the centreline on one side.
  let coastal = 0;
  for (const h of c.holes) {
    let near = false;
    for (let k = 0; k <= 10 && !near; k++) {
      const i = Math.min(h.path.length - 2, Math.floor((k / 10) * (h.path.length - 1)));
      const a = h.path[i];
      const b = h.path[i + 1];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = (b.z - a.z) / l;
      const nz = -(b.x - a.x) / l;
      const t = (k / 10) * (h.path.length - 1) - i;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      for (const side of [-1, 1]) if (c.surfaceAt(px + nx * side * 120, pz + nz * side * 120).name === 'water') near = true;
    }
    if (near) coastal++;
  }
  assert.ok(coastal >= 9, `${coastal} coastal holes`);
});
