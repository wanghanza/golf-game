import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCourse, Round, scoreName, COURSES } from '../src/index.js';
import { swingToShot } from '../../physics-engine/src/shot-model.js';
import { simulateShot } from '../../physics-engine/src/flight.js';

const course = createCourse();

function powerFor(club, dist) {
  let lo = 0.2;
  let hi = 1.05;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    const c = simulateShot(swingToShot({ peakOmega: 11 * m, qualityScore: 1 }, club).launch, { sampleEvery: 1000 }).carry;
    if (c > dist) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

for (const id of ['autumn', 'pinebeach']) {
test(`${id}: a straight-hitting bot can play all 18 holes to a sensible score`, () => {
  const round = new Round(createCourse(COURSES[id]));
  for (let h = 0; h < 18; h++) {
    if (h) round.nextHole();
    while (!round.holed) {
      if (round.onGreen) {
        round.playPutt((round.distanceToPin + 0.3) / 25, round.defaultAim());
      } else {
        const club = round.suggestClub();
        const d = round.distanceToPin;
        const p = round.carries[club] > d * 1.05 ? powerFor(club, d * 0.92) : 1;
        round.playShot(swingToShot({ peakOmega: 11 * p, qualityScore: 1 }, club).launch, round.defaultAim(club));
      }
    }
    assert.ok(round.scores[h] < 10, `hole ${h + 1} hit the stroke cap`);
  }
  assert.equal(round.finished, true);
  const t = round.totals();
  assert.equal(t.par, 72);
  assert.ok(t.strokes >= 66 && t.strokes <= 95, `bot scored ${t.strokes}`);
});

}

test('a ball hit into the sea costs a stroke and is replayed from the same spot', () => {
  const round = new Round(course, { startHole: 2 }); // hole 2 runs along the coast
  const start = { ...round.ball };
  // Aim straight out to sea (south) with a driver.
  const e = round.playShot(swingToShot({ peakOmega: 11, qualityScore: 1 }, 'driver').launch, 180);
  assert.equal(e.result.water, true);
  assert.equal(e.penalty, 1);
  assert.equal(round.strokes, 2);
  assert.deepEqual(round.ball, start);
});

test('score names', () => {
  assert.equal(scoreName(3, 4), '버디');
  assert.equal(scoreName(4, 4), '파');
  assert.equal(scoreName(1, 3), '홀인원');
  assert.equal(scoreName(3, 5), '이글');
});
