// Golf ball flight + ground interaction simulation.
//
// Deterministic: fixed time step RK4, no randomness. Same launch input
// always returns the same trajectory.

import { add, scale, dot, cross, norm, normalize, DEG, RPM_TO_RADS } from './vec.js';
import {
  GRAVITY,
  BALL,
  BALL_AREA,
  DEFAULT_AIR_DENSITY,
  AERO,
  dragCoefficient,
  liftCoefficient,
} from './constants.js';
import { surfaceAt, DEFAULT_COURSE } from './ground.js';

/**
 * @typedef {Object} Launch
 * @property {number} ballSpeed      m/s
 * @property {number} launchAngle    deg, vertical launch angle (up is +)
 * @property {number} launchDirection deg, horizontal start direction (right of target is +)
 * @property {number} spinRate       rpm, total spin
 * @property {number} spinAxis       deg, tilt of the spin axis (+ curves right / fade, - curves left / draw)
 */

/**
 * Initial velocity vector from speed, vertical and horizontal angles.
 */
export function launchVelocity(ballSpeed, launchAngleDeg, launchDirectionDeg) {
  const v = DEG * launchAngleDeg;
  const h = DEG * launchDirectionDeg;
  return [
    ballSpeed * Math.cos(v) * Math.sin(h),
    ballSpeed * Math.sin(v),
    ballSpeed * Math.cos(v) * Math.cos(h),
  ];
}

/**
 * Unit spin-axis vector (angular velocity direction) in world coordinates.
 * Pure backspin for a ball heading down +z is the -x axis (omega x v points up).
 * A positive tilt rotates the axis so the Magnus force gains a +x (right)
 * component.
 */
export function spinAxisVector(launchDirectionDeg, spinAxisDeg) {
  const h = DEG * launchDirectionDeg;
  const a = DEG * spinAxisDeg;
  // Horizontal "right" vector perpendicular to the launch heading.
  const right = [Math.cos(h), 0, -Math.sin(h)];
  return normalize(add(scale(right, -Math.cos(a)), [0, Math.sin(a), 0]));
}

function makeAccel(env, axis, omega0) {
  const { rho, wind, aero } = env;
  const k = (0.5 * rho * BALL_AREA) / BALL.mass;
  return function accel(t, v) {
    const omega = omega0 * Math.exp(-t / aero.spinDecayTau); // rad/s
    const rel = [v[0] - wind[0], v[1] - wind[1], v[2] - wind[2]];
    const speed = norm(rel);
    if (speed < 1e-6) return [0, -GRAVITY, 0];
    const S = (BALL.radius * omega) / speed;
    const cd = dragCoefficient(S, aero);
    const cl = liftCoefficient(S, aero);
    const drag = scale(rel, -k * cd * speed);
    // Magnus lift is perpendicular to both the spin axis and the relative velocity.
    let liftDir = cross(axis, rel);
    const ln = norm(liftDir);
    const lift = ln > 1e-9 ? scale(liftDir, (k * cl * speed * speed) / ln) : [0, 0, 0];
    return [drag[0] + lift[0], drag[1] + lift[1] - GRAVITY, drag[2] + lift[2]];
  };
}

function rk4Step(p, v, t, dt, accel) {
  const a1 = accel(t, v);
  const v2 = add(v, scale(a1, dt / 2));
  const a2 = accel(t + dt / 2, v2);
  const v3 = add(v, scale(a2, dt / 2));
  const a3 = accel(t + dt / 2, v3);
  const v4 = add(v, scale(a3, dt));
  const a4 = accel(t + dt, v4);
  const pNext = add(p, scale(add(add(v, scale(v2, 2)), add(scale(v3, 2), v4)), dt / 6));
  const vNext = add(v, scale(add(add(a1, scale(a2, 2)), add(scale(a3, 2), a4)), dt / 6));
  return [pNext, vNext];
}

/**
 * Coefficient of restitution for the normal component on turf. Decreases
 * with impact speed (after Penner 2002, "The run of a golf ball").
 */
export function turfRestitution(vnAbs, surface) {
  const e = 0.51 - 0.0375 * vnAbs + 0.000903 * vnAbs * vnAbs;
  return Math.max(0.05, Math.min(0.6, e * surface.restitutionScale));
}

/**
 * Simulate a full shot: flight, bounces and roll.
 *
 * @param {Launch} launch
 * @param {Object} [opts]
 * @param {number[]} [opts.wind]  wind velocity [x,y,z] in m/s (air moving toward +z is a tailwind)
 * @param {number} [opts.airDensity]
 * @param {number} [opts.dt]      integration step (s)
 * @param {number} [opts.sampleEvery] record one trajectory point every N steps
 * @param {Object} [opts.course]  course layout for surface lookup
 */
export function simulateShot(launch, opts = {}) {
  const env = {
    rho: opts.airDensity ?? DEFAULT_AIR_DENSITY,
    wind: opts.wind ?? [0, 0, 0],
    aero: opts.aero ?? AERO,
  };
  const course = opts.course ?? DEFAULT_COURSE;
  const dt = opts.dt ?? 1 / 500;
  const sampleEvery = opts.sampleEvery ?? 5;
  const maxTime = opts.maxTime ?? 30;

  const axis = spinAxisVector(launch.launchDirection, launch.spinAxis);
  let omega0 = Math.max(0, launch.spinRate) * RPM_TO_RADS;
  let accel = makeAccel(env, axis, omega0);

  let p = [0, 0, 0];
  let v = launchVelocity(launch.ballSpeed, launch.launchAngle, launch.launchDirection);
  let t = 0;
  let tPhase = 0; // time since the current flight segment started (for spin decay)
  let step = 0;
  let phase = 'flight';
  let apex = 0;
  let landing = null;
  let descentAngle = null;
  let flightTime = null;
  const bounces = [];
  const points = [{ t, x: 0, y: 0, z: 0, phase }];

  while (t < maxTime) {
    if (phase === 'flight' || phase === 'bounce') {
      const [pn, vn] = rk4Step(p, v, tPhase, dt, accel);
      t += dt;
      tPhase += dt;
      step++;
      if (pn[1] <= 0 && vn[1] < 0) {
        // Interpolate the exact ground contact.
        const f = p[1] / (p[1] - pn[1]);
        const pc = [p[0] + (pn[0] - p[0]) * f, 0, p[2] + (pn[2] - p[2]) * f];
        const vc = [v[0] + (vn[0] - v[0]) * f, v[1] + (vn[1] - v[1]) * f, v[2] + (vn[2] - v[2]) * f];
        const tc = t - dt + dt * f;
        const surface = surfaceAt(pc[0], pc[2], course);
        if (!landing) {
          landing = { x: pc[0], y: 0, z: pc[2], t: tc, surface: surface.name };
          flightTime = tc;
          const vh = Math.hypot(vc[0], vc[2]);
          descentAngle = Math.atan2(-vc[1], vh) / DEG;
        }
        points.push({ t: tc, x: pc[0], y: 0, z: pc[2], phase: 'contact' });
        // Bounce: normal component reversed with restitution, tangential
        // component reduced by friction and by backspin "check".
        const vnAbs = -vc[1];
        const e = turfRestitution(vnAbs, surface);
        const vh = [vc[0], 0, vc[2]];
        const vhMag = norm(vh);
        const spinNow = omega0 * Math.exp(-tPhase / env.aero.spinDecayTau);
        const spinSurfaceSpeed = spinNow * BALL.radius; // m/s
        // Friction impulse limited by Coulomb friction (mu * normal impulse).
        const maxFriction = surface.bounceFriction * (1 + e) * vnAbs;
        const reduction = Math.min(vhMag, maxFriction + surface.spinCheck * spinSurfaceSpeed);
        const newVh = vhMag > 1e-9 ? scale(vh, (vhMag - reduction) / vhMag) : [0, 0, 0];
        bounces.push({ x: pc[0], z: pc[2], t: tc, speedIn: norm(vc), surface: surface.name });
        p = pc;
        v = [newVh[0], e * vnAbs, newVh[2]];
        // Most spin is lost on the first contact.
        omega0 = spinNow * 0.25;
        accel = makeAccel(env, axis, omega0);
        tPhase = 0;
        phase = v[1] > 0.6 && bounces.length < 8 ? 'bounce' : 'roll';
        if (phase === 'roll') v = [v[0], 0, v[2]];
        t = tc;
      } else {
        p = pn;
        v = vn;
        if (p[1] > apex) apex = p[1];
        if (step % sampleEvery === 0) points.push({ t, x: p[0], y: p[1], z: p[2], phase });
      }
    } else if (phase === 'roll') {
      const surface = surfaceAt(p[0], p[2], course);
      const speed = Math.hypot(v[0], v[2]);
      const decel = surface.rollingResistance * GRAVITY;
      if (speed <= decel * dt) {
        phase = 'stopped';
        break;
      }
      const s = (speed - decel * dt) / speed;
      v = [v[0] * s, 0, v[2] * s];
      p = [p[0] + v[0] * dt, 0, p[2] + v[2] * dt];
      t += dt;
      step++;
      if (step % sampleEvery === 0) points.push({ t, x: p[0], y: 0, z: p[2], phase });
    }
  }
  points.push({ t, x: p[0], y: 0, z: p[2], phase: 'stopped' });

  const carry = landing ? Math.hypot(landing.x, landing.z) : 0;
  const total = Math.hypot(p[0], p[2]);
  return {
    points,
    apex,
    carry,
    carryDownrange: landing ? landing.z : 0,
    carryLateral: landing ? landing.x : 0,
    total,
    totalDownrange: p[2],
    totalLateral: p[0],
    flightTime,
    descentAngle,
    landing,
    rest: { x: p[0], y: 0, z: p[2], t, surface: surfaceAt(p[0], p[2], course).name },
    bounces,
  };
}
