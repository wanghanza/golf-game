// From club delivery to ball launch, and from phone-swing features to a
// virtual club delivery.
//
// Two layers, kept apart so it is always clear what is physics and what is
// game mapping:
//   1. deliveryToLaunch: club delivery -> ball launch. Simplified ball-flight
//      laws (D-plane) anchored on public launch-monitor averages.
//   2. swingToDelivery: phone measurements -> virtual club delivery. Pure
//      game mapping driven by game-config.js.

import { getClub } from './clubs.js';
import { PLAYER_LEVELS, resolveGameConfig } from './game-config.js';
import { classifyShot } from './shot-shape.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {Object} delivery
 * @param {number} delivery.clubSpeed     m/s
 * @param {number} delivery.faceAngle     deg, + open (right of target)
 * @param {number} delivery.clubPath      deg, + in-to-out (right of target)
 * @param {number} [delivery.attackAngle] deg, + up
 * @param {number} [delivery.strikeQuality] 0..1 (1 = centred strike)
 * @param {string} clubKey
 */
export function deliveryToLaunch(delivery, clubKey, opts = {}) {
  const club = getClub(clubKey);
  const attack = delivery.attackAngle ?? club.refAttack;
  const strike = clamp(delivery.strikeQuality ?? 1, 0, 1);
  const penalty = (opts.maxStrikePenalty ?? 0.12) * (1 - strike);
  const ballSpeed = club.smash * (1 - penalty) * Math.max(0, delivery.clubSpeed);
  // Launch rises with attack angle; about half of an attack-angle change
  // shows up in launch angle.
  const launchAngle = club.refLaunch + 0.5 * (attack - club.refAttack);
  // Spin scales with club speed relative to the reference delivery.
  const speedRatio = club.refClubSpeed > 0 ? delivery.clubSpeed / club.refClubSpeed : 0;
  const spinRate = Math.max(0, club.refSpin * speedRatio * (1 - 0.5 * penalty));
  // D-plane: start direction mostly follows the face; curvature follows the
  // face-to-path difference relative to spin loft.
  const face = delivery.faceAngle ?? 0;
  const path = delivery.clubPath ?? 0;
  const launchDirection = club.faceWeight * face + (1 - club.faceWeight) * path;
  const spinAxis = clamp((Math.atan2(face - path, club.spinLoft) * 180) / Math.PI, -45, 45);
  return { ballSpeed, launchAngle, launchDirection, spinRate, spinAxis };
}

/**
 * Map phone-swing features to a virtual club delivery.
 *
 * @param {Object} swing
 * @param {number} swing.peakOmega         rad/s, measured (phone gyroscope, in-plane)
 * @param {number} [swing.faceRollDeg]     deg, estimated phone roll at virtual impact
 * @param {number} [swing.planeShiftDeg]   deg, estimated swing-plane azimuth shift
 * @param {number} [swing.qualityScore]    0..1, estimated
 */
export function swingToDelivery(swing, clubKey, configOverrides = {}) {
  const cfg = resolveGameConfig(configOverrides);
  const club = getClub(clubKey);
  const level = PLAYER_LEVELS[cfg.playerLevel] ?? PLAYER_LEVELS.average;
  const powerRaw = Math.max(0, swing.peakOmega) / cfg.referenceOmega;
  const power = clamp(Math.pow(powerRaw, cfg.powerExponent), 0, cfg.maxPowerRatio);
  const clubSpeed = club.refClubSpeed * level.speedScale * power;
  const assist = 1 - clamp(cfg.directionAssist, 0, 1);
  const faceAngle = clamp((swing.faceRollDeg ?? 0) * cfg.faceGain, -cfg.faceClampDeg, cfg.faceClampDeg) * assist;
  const clubPath = clamp((swing.planeShiftDeg ?? 0) * cfg.pathGain, -cfg.pathClampDeg, cfg.pathClampDeg) * assist;
  return {
    power,
    clubSpeed,
    faceAngle,
    clubPath,
    // Game attack angle: the driver is struck slightly on the way up.
    attackAngle: club.gameAttack ?? club.refAttack,
    strikeQuality: clamp(swing.qualityScore ?? 1, 0, 1),
  };
}

/**
 * Convenience: phone-swing features -> delivery -> launch -> shot shape,
 * with provenance labels for the UI.
 */
export function swingToShot(swing, clubKey, configOverrides = {}) {
  const cfg = resolveGameConfig(configOverrides);
  const delivery = swingToDelivery(swing, clubKey, cfg);
  const launch = deliveryToLaunch(delivery, clubKey, cfg);
  const shape = classifyShot(launch.launchDirection, launch.spinAxis);
  return {
    club: clubKey,
    delivery,
    launch,
    shape,
    // Nothing below is measured: it is all virtual-club model output.
    provenance: {
      delivery: 'estimated (virtual club model + game config)',
      launch: 'estimated (ball-flight laws anchored on public launch-monitor averages)',
    },
  };
}
