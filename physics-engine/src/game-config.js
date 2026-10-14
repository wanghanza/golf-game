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
});

export function resolveGameConfig(overrides = {}) {
  return { ...DEFAULT_GAME_CONFIG, ...overrides };
}
