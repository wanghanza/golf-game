// Ball flight and ground interaction on arbitrary terrain (the 18-hole course).
//
// World frame: x = east, y = up, z = north. The shot is aimed along a compass
// heading. Air physics is shared with flight.js; what changes is the ground:
//   - contact against heightAt(x, z) instead of y = 0
//   - bounces reflect about the local surface normal
//   - rolling follows the slope (rolling sphere: 5/7 of the gravity component)
//     against rolling resistance, and stops only where the slope cannot keep
//     the ball moving
//   - water ends the shot; an optional cup can capture a slow ball
// Deterministic, fixed-step.

import { add, scale, dot, norm, DEG, RPM_TO_RADS } from './vec.js';
import { GRAVITY, BALL, DEFAULT_AIR_DENSITY, AERO } from './constants.js';
import { launchVelocity, spinAxisVector, makeAccel, rk4Step, turfRestitution } from './flight.js';

export const CUP_RADIUS = 0.054; // m (108 mm cup)
const ROLL_GRAVITY = 5 / 7;

/** Rotate a shot-local vector (x right, z forward) to world for a compass heading. */
export function localToWorld(v, headingDeg) {
  const s = Math.sin(headingDeg * DEG);
  const c = Math.cos(headingDeg * DEG);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function normalAt(terrain, x, z) {
  if (terrain.normalAt) {
    const n = terrain.normalAt(x, z);
    return [n.x, n.y, n.z];
  }
  const e = 0.5;
  const hx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
  const hz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
  const l = Math.hypot(hx, 1, hz);
  return [-hx / l, 1 / l, -hz / l];
}

/** Flat ground helper (tests and the driving range). */
export function flatTerrain(surface) {
  return { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }), surfaceAt: () => surface };
}

function rollStep(state, terrain, dt) {
  const { p, v } = state;
  const n = normalAt(terrain, p[0], p[2]);
  const surface = terrain.surfaceAt(p[0], p[2]);
  // Gravity component along the surface.
  const gt = [GRAVITY * n[1] * n[0], GRAVITY * (n[1] * n[1] - 1), GRAVITY * n[1] * n[2]];
  const slopeAcc = scale(gt, ROLL_GRAVITY);
  const speed = norm(v);
  const resist = surface.rollingResistance * GRAVITY * n[1];
  if (speed < 0.03 && norm(slopeAcc) <= resist) {
    return { stopped: true, surface };
  }
  let vNew = add(v, scale(slopeAcc, dt));
  const sp = norm(vNew);
  const dec = resist * dt;
  vNew = sp > dec ? scale(vNew, (sp - dec) / sp) : [0, 0, 0];
  const pNew = add(p, scale(vNew, dt));
  pNew[1] = terrain.heightAt(pNew[0], pNew[2]);
  const n2 = normalAt(terrain, pNew[0], pNew[2]);
  const vn = dot(vNew, n2);
  state.p = pNew;
  state.v = add(vNew, scale(n2, -vn));
  return { stopped: false, surface: terrain.surfaceAt(pNew[0], pNew[2]) };
}

function checkCup(p, prev, cup, speed) {
  if (!cup) return false;
  // Closest approach of this step's segment to the cup centre.
  const ax = prev[0] - cup.x;
  const az = prev[2] - cup.z;
  const dx = p[0] - prev[0];
  const dz = p[2] - prev[2];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / l2)) : 0;
  const d = Math.hypot(ax + dx * t, az + dz * t);
  // A ball faster than ~1.6 m/s lips out even when centred.
  return d < CUP_RADIUS && speed < 1.6;
}

function finishResult(ctx) {
  const { origin, points, landing, p, t } = ctx;
  points.push({ t, x: p[0], y: p[1], z: p[2], phase: ctx.holed ? 'holed' : ctx.water ? 'water' : 'stopped' });
  const horiz = (q) => Math.hypot(q[0] - origin[0], q[2] - origin[2]);
  return {
    points,
    apex: ctx.apex - origin[1],
    carry: landing ? horiz([landing.x, 0, landing.z]) : 0,
    total: horiz(p),
    landing,
    flightTime: landing ? landing.t : null,
    rest: { x: p[0], y: p[1], z: p[2], t, surface: ctx.restSurface?.name ?? null },
    holed: !!ctx.holed,
    water: !!ctx.water,
    waterEntry: ctx.waterEntry ?? null,
    bounces: ctx.bounces,
  };
}

/**
 * @param {Object} launch  as simulateShot (ballSpeed, launchAngle, launchDirection, spinRate, spinAxis)
 * @param {Object} o
 * @param {number[]} o.origin   world [x, y, z] of the ball
 * @param {number} o.heading    compass heading of the aim line (deg)
 * @param {Object} o.terrain    { heightAt(x,z), surfaceAt(x,z), normalAt?(x,z) }
 * @param {number[]} [o.wind]   world wind velocity (m/s)
 * @param {{x:number,z:number}} [o.cup]
 */
export function simulateOnTerrain(launch, o) {
  const env = { rho: o.airDensity ?? DEFAULT_AIR_DENSITY, wind: o.wind ?? [0, 0, 0], aero: o.aero ?? AERO };
  const dt = o.dt ?? 1 / 400;
  const sampleEvery = o.sampleEvery ?? 5;
  const maxTime = o.maxTime ?? 40;
  const terrain = o.terrain;
  const axis = localToWorld(spinAxisVector(launch.launchDirection, launch.spinAxis), o.heading);
  let omega0 = Math.max(0, launch.spinRate) * RPM_TO_RADS;
  let accel = makeAccel(env, axis, omega0);
  const origin = [...o.origin];
  const ctx = { origin, points: [], landing: null, p: [...origin], t: 0, apex: origin[1], bounces: [] };
  let v = localToWorld(launchVelocity(launch.ballSpeed, launch.launchAngle, launch.launchDirection), o.heading);
  let tPhase = 0;
  let phase = launch.ballSpeed > 0 ? 'flight' : 'roll';
  let step = 0;
  ctx.points.push({ t: 0, x: origin[0], y: origin[1], z: origin[2], phase });

  while (ctx.t < maxTime) {
    const p = ctx.p;
    if (phase === 'flight' || phase === 'bounce') {
      const [pn, vn] = rk4Step(p, v, tPhase, dt, accel);
      ctx.t += dt;
      tPhase += dt;
      step++;
      const gPrev = p[1] - terrain.heightAt(p[0], p[2]);
      const gNext = pn[1] - terrain.heightAt(pn[0], pn[2]);
      if (gNext <= 0 && step > 1) {
        const f = gPrev > 0 ? gPrev / (gPrev - gNext) : 0;
        const pc = [p[0] + (pn[0] - p[0]) * f, 0, p[2] + (pn[2] - p[2]) * f];
        pc[1] = terrain.heightAt(pc[0], pc[2]);
        const vc = [v[0] + (vn[0] - v[0]) * f, v[1] + (vn[1] - v[1]) * f, v[2] + (vn[2] - v[2]) * f];
        const tc = ctx.t - dt + dt * f;
        const surface = terrain.surfaceAt(pc[0], pc[2]);
        if (!ctx.landing) ctx.landing = { x: pc[0], y: pc[1], z: pc[2], t: tc, surface: surface.name };
        ctx.points.push({ t: tc, x: pc[0], y: pc[1], z: pc[2], phase: 'contact' });
        ctx.p = pc;
        ctx.t = tc;
        if (surface.water) {
          ctx.water = true;
          ctx.waterEntry = { x: pc[0], y: pc[1], z: pc[2] };
          ctx.restSurface = surface;
          break;
        }
        const n = normalAt(terrain, pc[0], pc[2]);
        const vnMag = dot(vc, n); // negative into the ground
        const e = turfRestitution(-vnMag, surface);
        const vt = add(vc, scale(n, -vnMag));
        const vtMag = norm(vt);
        const spinNow = omega0 * Math.exp(-tPhase / env.aero.spinDecayTau);
        const reduction = Math.min(vtMag, surface.bounceFriction * (1 + e) * -vnMag + surface.spinCheck * spinNow * BALL.radius);
        const vt2 = vtMag > 1e-9 ? scale(vt, (vtMag - reduction) / vtMag) : [0, 0, 0];
        v = add(vt2, scale(n, -e * vnMag));
        ctx.bounces.push({ x: pc[0], z: pc[2], t: tc, surface: surface.name });
        omega0 = spinNow * 0.25;
        accel = makeAccel(env, axis, omega0);
        tPhase = 0;
        if (-e * vnMag > 0.6 && ctx.bounces.length < 8) {
          phase = 'bounce';
          // Lift the ball just off the ground to avoid re-contact in the same step.
          ctx.p = [pc[0], pc[1] + 1e-3, pc[2]];
        } else {
          phase = 'roll';
          v = vt2;
        }
      } else {
        ctx.p = pn;
        v = vn;
        if (pn[1] > ctx.apex) ctx.apex = pn[1];
        if (step % sampleEvery === 0) ctx.points.push({ t: ctx.t, x: pn[0], y: pn[1], z: pn[2], phase });
      }
    } else {
      const state = { p: ctx.p, v };
      const prev = ctx.p;
      const r = rollStep(state, terrain, dt);
      ctx.t += dt;
      step++;
      if (r.stopped) {
        ctx.restSurface = r.surface;
        break;
      }
      ctx.p = state.p;
      v = state.v;
      if (r.surface.water) {
        ctx.water = true;
        ctx.waterEntry = { x: ctx.p[0], y: ctx.p[1], z: ctx.p[2] };
        ctx.restSurface = r.surface;
        break;
      }
      if (checkCup(ctx.p, prev, o.cup, norm(v))) {
        ctx.holed = true;
        ctx.p = [o.cup.x, terrain.heightAt(o.cup.x, o.cup.z) - 0.05, o.cup.z];
        ctx.restSurface = r.surface;
        break;
      }
      if (step % sampleEvery === 0) ctx.points.push({ t: ctx.t, x: ctx.p[0], y: ctx.p[1], z: ctx.p[2], phase: 'roll' });
    }
  }
  if (!ctx.restSurface) ctx.restSurface = terrain.surfaceAt(ctx.p[0], ctx.p[2]);
  return finishResult(ctx);
}

/**
 * A putt (or any rolling-only stroke): initial speed along the heading.
 * @param {Object} o same as simulateOnTerrain plus o.speed (m/s)
 */
export function simulatePutt(o) {
  const terrain = o.terrain;
  const dir = localToWorld([0, 0, 1], o.heading);
  const n = normalAt(terrain, o.origin[0], o.origin[2]);
  let v = scale(dir, o.speed);
  v = add(v, scale(n, -dot(v, n)));
  const s = norm(v);
  if (s > 0) v = scale(v, o.speed / s);
  const dt = o.dt ?? 1 / 400;
  const ctx = { origin: [...o.origin], points: [], landing: null, p: [...o.origin], t: 0, apex: o.origin[1], bounces: [] };
  ctx.points.push({ t: 0, x: ctx.p[0], y: ctx.p[1], z: ctx.p[2], phase: 'roll' });
  let step = 0;
  while (ctx.t < (o.maxTime ?? 30)) {
    const state = { p: ctx.p, v };
    const prev = ctx.p;
    const r = rollStep(state, terrain, dt);
    ctx.t += dt;
    step++;
    if (r.stopped) {
      ctx.restSurface = r.surface;
      break;
    }
    ctx.p = state.p;
    v = state.v;
    if (r.surface.water) {
      ctx.water = true;
      ctx.waterEntry = { x: ctx.p[0], y: ctx.p[1], z: ctx.p[2] };
      ctx.restSurface = r.surface;
      break;
    }
    if (checkCup(ctx.p, prev, o.cup, norm(v))) {
      ctx.holed = true;
      ctx.p = [o.cup.x, terrain.heightAt(o.cup.x, o.cup.z) - 0.05, o.cup.z];
      ctx.restSurface = r.surface;
      break;
    }
    if (step % (o.sampleEvery ?? 8) === 0) ctx.points.push({ t: ctx.t, x: ctx.p[0], y: ctx.p[1], z: ctx.p[2], phase: 'roll' });
  }
  if (!ctx.restSurface) ctx.restSurface = terrain.surfaceAt(ctx.p[0], ctx.p[2]);
  return finishResult(ctx);
}

/** Initial putt speed (m/s) that rolls `distance` metres on flat ground with resistance `rr`. */
export function puttSpeedFor(distance, rr = 0.06) {
  return Math.sqrt(2 * rr * GRAVITY * Math.max(0, distance));
}
