// Game tuning, kept separate from physics on purpose.
//
// A phone swung safely in the hands does not move like a club head, and the
// phone cannot measure club speed, face angle, path or ball spin. These
// coefficients define how the measured phone motion is *mapped* to a virtual
// club. They are design choices, not measurements, and can be changed in the
// in-app settings.

export const PLAYER_LEVELS = Object.freeze({
  // Fraction of the tour-average club speed reached at 100% swing power.
  beginner: { label: '초급', speedScale: 0.7 },
  average: { label: '중급', speedScale: 0.82 },
  pro: { label: '프로', speedScale: 1.0 },
});

export const DEFAULT_GAME_CONFIG = Object.freeze({
  playerLevel: 'average',
  // Peak in-plane angular velocity of the phone (rad/s) that counts as a
  // 100% swing. Low on purpose so that small, safe swings are enough.
  referenceOmega: 11,
  // Power above 100% is capped (no reward for swinging harder).
  maxPowerRatio: 1.05,
  powerExponent: 1.0,
  // Phone roll about its long axis at the virtual impact (deg) -> face angle (deg).
  faceGain: 0.5,
  faceClampDeg: 12,
  // Swing-plane azimuth change backswing->downswing (deg) -> club path (deg).
  pathGain: 1.0,
  pathClampDeg: 10,
  // 0 = raw estimate, 1 = always straight. Makes the game forgiving while the
  // face/path estimates are unvalidated.
  directionAssist: 0.3,
  // Strike quality penalty on ball speed when the swing quality score is low.
  maxStrikePenalty: 0.12,
  // Wrist action. Lag retention = phone angular velocity at impact / peak.
  // Clubhead speed follows the club's angular velocity at impact, so the
  // speed factor is lagRetention / lagIdeal (floored at minLagSpeed). The
  // extra dynamic loft of an early release is a game estimate: tour irons
  // are delofted ~12 deg by shaft lean; a full flip is assumed to give back
  // castLoftDeg of that. Spin and smash then follow from the spin loft.
  // Face direction comes from the face roll angle at impact (forearm
  // rotation + lead-wrist flexion/extension both turn the phone about its
  // long axis), not from the roll *rate*: launch-monitor data show no
  // correlation between closure rate and accuracy.
  wristModel: true,
  lagIdeal: 0.96,
  lagPoor: 0.8,
  minLagSpeed: 0.75,
  castLoftDeg: 5,
  // Acceleration zone (fraction of the downswing where rotational power
  // peaks). The club is the last link of the kinematic sequence, so it
  // should gain most of its speed late in the downswing. The window is a
  // game estimate, not a measured norm.
  accelZone: [0.6, 0.88],
  accelEarlySpan: 0.3, // full "early" penalty at accelZone[0] - span
  accelLateSpan: 0.1,
  earlyFaceCloseDeg: 1.5,
  lateFaceOpenDeg: 4,
  lateDeloftDeg: 3,
  // Transition from the top ("vertical drop"): share of the backswing angle
  // already unwound in the first 35% of the downswing [good, bad], and the
  // mean downward hand acceleration there [bad, good] in m/s^2.
  transitionRotation: [0.1, 0.3],
  transitionDrop: [-1, 1.5],
  steepPathDeg: 3,
  steepAttackDeg: 2,
});

export function resolveGameConfig(overrides = {}) {
  return { ...DEFAULT_GAME_CONFIG, ...overrides };
}
