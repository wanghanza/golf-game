// Course surfaces for the driving range.
//
// Surface parameters are first-order values chosen to give typical roll-outs
// (driver ~15-25 m on firm fairway, short irons a few metres). They are model
// parameters, not measurements, and are documented in docs/PHYSICS.md.

export const SURFACES = Object.freeze({
  tee: { name: 'tee', restitutionScale: 1.0, bounceFriction: 0.55, spinCheck: 0.15, rollingResistance: 0.25 },
  fairway: { name: 'fairway', restitutionScale: 1.0, bounceFriction: 0.55, spinCheck: 0.15, rollingResistance: 0.25 },
  rough: { name: 'rough', restitutionScale: 0.6, bounceFriction: 0.75, spinCheck: 0.1, rollingResistance: 0.7 },
});

export const DEFAULT_COURSE = Object.freeze({
  fairwayHalfWidth: 22, // m
  fairwayStart: 30, // m from tee
  teeHalfWidth: 4,
  teeLength: 6,
});

export function surfaceAt(x, z, course = DEFAULT_COURSE) {
  if (Math.abs(x) <= course.teeHalfWidth && z >= -course.teeLength / 2 && z <= course.teeLength) {
    return SURFACES.tee;
  }
  if (z >= course.fairwayStart && Math.abs(x) <= course.fairwayHalfWidth) return SURFACES.fairway;
  return SURFACES.rough;
}
