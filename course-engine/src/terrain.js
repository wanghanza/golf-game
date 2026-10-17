// Terrain: a coastal mountain with the 18 holes carved into its slopes.
//
// height(x, z) blends a natural landform (a mountain falling to the sea plus
// fBm ridges) with smoothed corridors along every hole, flat tees and
// gently tilted greens. Everything is analytic and deterministic, so the
// renderer and the ball physics see exactly the same ground.

import { fbm, smoothstep } from './noise.js';
import { buildHoles, pathDistance, PEAK, CLUBHOUSE, dirOf } from './layout.js';

export const SEA_LEVEL = 0;

// Surface physics (same fields as physics-engine/src/ground.js) + lie factor
// (ball-speed multiplier for shots played from that surface).
export const COURSE_SURFACES = Object.freeze({
  tee: { name: 'tee', label: '티', restitutionScale: 1.0, bounceFriction: 0.55, spinCheck: 0.15, rollingResistance: 0.25, lie: 1.0 },
  fairway: { name: 'fairway', label: '페어웨이', restitutionScale: 1.0, bounceFriction: 0.55, spinCheck: 0.15, rollingResistance: 0.25, lie: 1.0 },
  rough: { name: 'rough', label: '러프', restitutionScale: 0.6, bounceFriction: 0.75, spinCheck: 0.1, rollingResistance: 0.7, lie: 0.88 },
  green: { name: 'green', label: '그린', restitutionScale: 0.6, bounceFriction: 0.65, spinCheck: 0.45, rollingResistance: 0.06, lie: 1.0 },
  bunker: { name: 'bunker', label: '벙커', restitutionScale: 0.15, bounceFriction: 0.95, spinCheck: 0.0, rollingResistance: 2.5, lie: 0.8 },
  forest: { name: 'forest', label: '숲 (낙엽)', restitutionScale: 0.4, bounceFriction: 0.85, spinCheck: 0.05, rollingResistance: 1.4, lie: 0.65 },
  water: { name: 'water', label: '바다', water: true, restitutionScale: 0, bounceFriction: 1, spinCheck: 0, rollingResistance: 10, lie: 0 },
});

function naturalHeight(x, z) {
  const r2 = (x - PEAK.x) ** 2 + (z - PEAK.z) ** 2;
  const mountain = 260 * Math.exp(-r2 / 845000) - 60;
  const ridges = 34 * fbm(x / 300, z / 300, { octaves: 4, seed: 7 });
  const detail = 5 * fbm(x / 55, z / 55, { octaves: 3, seed: 31 });
  // Fade the noise out offshore so the sea floor stays smooth.
  const land = smoothstep(-40, 20, mountain);
  return mountain + (ridges + detail) * (0.35 + 0.65 * land);
}

export function createCourse() {
  const holes = buildHoles();

  // Per-hole elevation profile and features.
  let prevGreen = null;
  for (const h of holes) {
    let hTee = Math.max(12, naturalHeight(h.tee.x, h.tee.z));
    if (prevGreen) {
      // Keep the walk from the previous green gentle (<= 12% grade).
      const walk = Math.hypot(h.tee.x - prevGreen.x, h.tee.z - prevGreen.z);
      const maxStep = 0.12 * walk;
      hTee = Math.min(prevGreen.y + maxStep, Math.max(prevGreen.y - maxStep, hTee));
    }
    // Average uphill grade is limited to 7% so low-lofted clubs can still be
    // played; downhill holes may drop up to 15%. The landform is cut and
    // filled around the corridor.
    const hGreen = Math.max(10, Math.min(hTee + 0.07 * h.length, Math.max(hTee - 0.15 * h.length, naturalHeight(h.green.x, h.green.z))));
    h.teeHeight = hTee;
    h.greenHeight = hGreen;
    // Green tilts gently (1.5%) down toward the approach: back-to-front.
    const last = h.path[h.path.length - 2];
    const ax = h.green.x - last.x;
    const az = h.green.z - last.z;
    const al = Math.hypot(ax, az) || 1;
    h.greenSlope = { x: (ax / al) * 0.015, z: (az / al) * 0.015 };
    // Bunkers: two greenside, one fairway bunker on longer holes.
    const side = { x: az / al, z: -ax / al };
    const gr = h.greenRadius;
    h.bunkers = [
      { x: h.green.x + side.x * (gr + 6), z: h.green.z + side.z * (gr + 6), r: 6 },
      { x: h.green.x - side.x * (gr + 5) - (ax / al) * 6, z: h.green.z - side.z * (gr + 5) - (az / al) * 6, r: 5 },
    ];
    if (h.par >= 4) {
      const p = pointAlong(h.path, 0.62);
      const sgn = h.number % 2 ? 1 : -1;
      const d = dirAt(h.path, 0.62);
      h.bunkers.push({ x: p.x + d.z * sgn * (h.fairwayHalfWidth + 2), z: p.z - d.x * sgn * (h.fairwayHalfWidth + 2), r: 8 });
    }
    h.yardage = Math.round(totalLength(h.path));
    const xs = h.path.map((p) => p.x);
    const zs = h.path.map((p) => p.z);
    h.mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    h.reach = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 120;
    prevGreen = { x: h.green.x, z: h.green.z, y: hGreen };
  }
  const clubhouseHeight = holes[0].teeHeight;

  function corridor(x, z) {
    let best = null;
    for (const h of holes) {
      const pd = pathDistance(x, z, h.path);
      if (!best || pd.d < best.d) best = { d: pd.d, s: pd.s, hole: h };
    }
    return best;
  }

  // Playing-surface height for one hole at (x, z) and its blend weight.
  function holeTarget(h, x, z) {
    const pd = pathDistance(x, z, h.path);
    const half = Math.max(h.fairwayHalfWidth, 14);
    let target = h.teeHeight + (h.greenHeight - h.teeHeight) * smoothstep(0, 1, pd.s);
    target += 1.8 * Math.sin(pd.s * Math.PI * 3 + h.number) * (1 - Math.abs(2 * pd.s - 1));
    let w = smoothstep(half + 60, half + 8, pd.d);
    let priority = 0;
    const dTee = Math.hypot(x - h.tee.x, z - h.tee.z);
    if (dTee < 22) {
      const k = smoothstep(22, 9, dTee);
      target = target * (1 - k) + h.teeHeight * k;
      w = Math.max(w, k);
      priority = Math.max(priority, k);
    }
    const dGreen = Math.hypot(x - h.green.x, z - h.green.z);
    if (dGreen < h.greenRadius + 30) {
      const plane = h.greenHeight - h.greenSlope.x * (x - h.green.x) - h.greenSlope.z * (z - h.green.z);
      const g = smoothstep(h.greenRadius + 30, h.greenRadius + 2, dGreen);
      target = target * (1 - g) + plane * g;
      w = Math.max(w, g);
      priority = Math.max(priority, g);
    }
    return { target, w, d: pd.d, priority };
  }

  function heightAt(x, z) {
    const nat = naturalHeight(x, z);
    // Blend every nearby hole so corridors meet smoothly (green -> next tee).
    let wSum = 0;
    let tSum = 0;
    let wMax = 0;
    let nearest = null;
    for (const h of holes) {
      // Cheap reject: far from the hole's bounding circle.
      if (Math.hypot(x - h.mid.x, z - h.mid.z) > h.reach) continue;
      const r = holeTarget(h, x, z);
      if (!nearest || r.d < nearest.d) nearest = { d: r.d, hole: h };
      if (r.w <= 0) continue;
      // Greens and tees win over a neighbouring hole's corridor.
      const wk = r.w * r.w * (1 + 200 * r.priority ** 2);
      wSum += wk;
      tSum += wk * r.target;
      wMax = Math.max(wMax, r.w);
    }
    let y = wSum > 0 ? nat * (1 - wMax) + (tSum / wSum) * wMax : nat;
    if (nearest) {
      for (const b of nearest.hole.bunkers) {
        const db = Math.hypot(x - b.x, z - b.z);
        if (db < b.r) y -= 0.6 * (1 - (db / b.r) ** 2);
      }
    }
    // Clubhouse terrace.
    const dc = Math.hypot(x - CLUBHOUSE.x, z - CLUBHOUSE.z);
    if (dc < 40) {
      const k = smoothstep(40, 22, dc);
      y = y * (1 - k) + clubhouseHeight * k;
    }
    return y;
  }

  function normalAt(x, z, eps = 0.5) {
    const hx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
    const hz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
    const n = Math.hypot(hx, 1, hz);
    return { x: -hx / n, y: 1 / n, z: -hz / n, hx, hz };
  }

  function surfaceAt(x, z) {
    if (heightAt(x, z) < SEA_LEVEL + 0.2) return COURSE_SURFACES.water;
    const c = corridor(x, z);
    const h = c.hole;
    if (Math.hypot(x - h.green.x, z - h.green.z) <= h.greenRadius) return COURSE_SURFACES.green;
    for (const b of h.bunkers) if (Math.hypot(x - b.x, z - b.z) <= b.r) return COURSE_SURFACES.bunker;
    if (Math.hypot(x - h.tee.x, z - h.tee.z) <= 7) return COURSE_SURFACES.tee;
    const fairStart = h.par === 3 ? 0.8 : 0.16;
    const half = h.par === 3 ? 10 : h.fairwayHalfWidth;
    if (c.d <= half && c.s >= fairStart) return COURSE_SURFACES.fairway;
    if (c.d <= Math.max(h.fairwayHalfWidth, 10) + 22) return COURSE_SURFACES.rough;
    return COURSE_SURFACES.forest;
  }

  return {
    name: '단풍 바다 CC',
    holes,
    par: holes.reduce((a, h) => a + h.par, 0),
    heightAt,
    normalAt,
    surfaceAt,
    corridor,
    clubhouse: CLUBHOUSE,
    bounds: { minX: -1300, maxX: 1300, minZ: -1300, maxZ: 1500 },
  };
}

function totalLength(path) {
  let t = 0;
  for (let i = 0; i + 1 < path.length; i++) t += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  return t;
}

export function pointAlong(path, s) {
  const total = totalLength(path);
  let target = s * total;
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    if (target <= seg || i === path.length - 2) {
      const t = seg ? Math.min(1, target / seg) : 0;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, z: path[i].z + (path[i + 1].z - path[i].z) * t };
    }
    target -= seg;
  }
  return { ...path[path.length - 1] };
}

export function dirAt(path, s) {
  const a = pointAlong(path, Math.max(0, s - 0.02));
  const b = pointAlong(path, Math.min(1, s + 0.02));
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
}

/** Compass heading (deg) from a to b. */
export function headingTo(a, b) {
  return ((Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI + 360) % 360;
}

export { dirOf };
