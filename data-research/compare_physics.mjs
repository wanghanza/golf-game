// Compare the physics engine with CaddieSet launch-monitor shots.
//
// Input: data-research/results/caddieset_shots.json (from caddieset_analysis.py)
// Output: data-research/results/physics_vs_caddieset.json
//
// CaddieSet has ball speed, back/side spin, spin axis and start direction but
// NO vertical launch angle. For each club one launch angle is therefore fitted
// (grid search minimising carry MAE). That fitted angle is a free parameter,
// so the carry error below is an optimistic upper bound on accuracy.

import { readFileSync, writeFileSync } from 'node:fs';
import { simulateShot } from '../physics-engine/src/flight.js';

const here = new URL('.', import.meta.url).pathname;
const shots = JSON.parse(readFileSync(`${here}results/caddieset_shots.json`, 'utf8'));

function simulate(s, launchAngle) {
  return simulateShot(
    {
      ballSpeed: s.BallSpeed,
      launchAngle,
      launchDirection: s.DirectionAngle,
      spinRate: Math.hypot(s.SpinBack, s.SpinSide),
      spinAxis: s.SpinAxis,
    },
    { sampleEvery: 1000, dt: 1 / 250 },
  );
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const corr = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};

const out = { note: 'Launch angle is not in CaddieSet; one angle per club is fitted. Errors are therefore optimistic.', clubs: {} };
const byClub = {};
for (const s of shots) (byClub[s.ClubType] ??= []).push(s);

for (const [club, list] of Object.entries(byClub)) {
  if (list.length < 25) continue;
  // Subsample deterministically for the grid search to keep runtime low.
  const fitSet = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 120)) === 0);
  let best = null;
  for (let la = 6; la <= 30; la += 1) {
    const err = mean(fitSet.map((s) => Math.abs(simulate(s, la).carry - s.Carry)));
    if (!best || err < best.err) best = { la, err };
  }
  const sims = list.map((s) => simulate(s, best.la));
  const carryErr = sims.map((r, i) => r.carry - list[i].Carry);
  const latSim = sims.map((r) => r.carryLateral);
  const latData = list.map((s) => s.LrDistanceOut);
  const totalErr = sims.map((r, i) => r.total - list[i].Distance);
  out.clubs[club] = {
    n: list.length,
    fittedLaunchAngleDeg: best.la,
    carryMAE_m: mean(carryErr.map(Math.abs)),
    carryBias_m: mean(carryErr),
    carryCorrelation: corr(sims.map((r) => r.carry), list.map((s) => s.Carry)),
    meanCarryData_m: mean(list.map((s) => s.Carry)),
    totalMAE_m: mean(totalErr.map(Math.abs)),
    totalBias_m: mean(totalErr),
    lateralCorrelation_simCarryLateral_vs_LrDistanceOut: corr(latSim, latData),
    lateralMAE_m: mean(latSim.map((v, i) => Math.abs(v - latData[i]))),
  };
  console.log(club, JSON.stringify(out.clubs[club]));
}
writeFileSync(`${here}results/physics_vs_caddieset.json`, JSON.stringify(out, null, 2) + '\n');
