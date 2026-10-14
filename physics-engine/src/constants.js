// Physical constants and the aerodynamic model parameters.
//
// Everything here is physics, not game tuning. Game tuning (how hard a phone
// swing has to be to hit a given distance) lives in game-config.js.

export const GRAVITY = 9.80665; // m/s^2

// USGA/R&A rules: mass <= 45.93 g, diameter >= 42.67 mm.
export const BALL = Object.freeze({
  mass: 0.04593, // kg
  radius: 0.042672 / 2, // m
});

export const BALL_AREA = Math.PI * BALL.radius * BALL.radius; // m^2

// Air density at 20 °C, sea level, 50% RH.
export const DEFAULT_AIR_DENSITY = 1.204; // kg/m^3

/**
 * Air density from temperature (°C) and altitude (m) using the barometric
 * formula for the troposphere (dry air approximation).
 */
export function airDensity(tempC = 20, altitudeM = 0) {
  const T = tempC + 273.15;
  const p0 = 101325;
  const L = 0.0065;
  const T0 = 288.15;
  const p = p0 * Math.pow(1 - (L * altitudeM) / T0, 5.25588);
  return p / (287.05 * T);
}

// Aerodynamic coefficient model, as functions of the spin parameter
// S = r * omega / v (dimensionless).
//   Cd(S) = cd0 + cdSpin * S
//   Cl(S) = clMax * S / (S + clHalf)
// Functional forms follow the shape of published wind-tunnel data for
// dimpled golf balls (Bearman & Harvey 1976; Smits & Smith 1994), where Cl
// rises steeply at small S and flattens, and Cd grows roughly linearly
// with S in the post-critical Reynolds range. The four numbers were fitted
// against public launch-monitor averages (see physics-engine/test and
// docs/PHYSICS.md); they are not measured by this project.
export const AERO = Object.freeze({
  cd0: 0.2,
  cdSpin: 0.35,
  clMax: 0.5,
  clHalf: 0.22,
  // Exponential spin decay time constant (s). Literature values for golf
  // balls are on the order of 20-30 s.
  spinDecayTau: 25,
});

export function dragCoefficient(S, aero = AERO) {
  return aero.cd0 + aero.cdSpin * S;
}

export function liftCoefficient(S, aero = AERO) {
  if (S <= 0) return 0;
  return (aero.clMax * S) / (S + aero.clHalf);
}
