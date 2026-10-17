// Virtual club models.
//
// Reference values are the widely published TrackMan PGA Tour averages
// (club speed, ball speed, launch angle, spin rate, attack angle). They are
// used as anchor points for the virtual club: the game scales from these
// anchors, it never claims to measure them.

const MPH = 0.44704;

export const CLUBS = Object.freeze({
  driver: {
    key: 'driver', label: '드라이버', loft: 10.5,
    refClubSpeed: 113 * MPH, refBallSpeed: 167 * MPH, refLaunch: 10.9, refSpin: 2686, refAttack: -1.3,
    smash: 1.48, spinLoft: 14, faceWeight: 0.85,
    // Ball off the lead heel, shaft about vertical at address, struck slightly
    // on the way up (impact just past the low point).
    addressLeanDeg: 0, impactPastAddressDeg: 4, gameAttack: 2,
  },
  wood3: {
    key: 'wood3', label: '3번 우드', loft: 15,
    refClubSpeed: 107 * MPH, refBallSpeed: 158 * MPH, refLaunch: 9.2, refSpin: 3655, refAttack: -2.9,
    smash: 1.48, spinLoft: 17, faceWeight: 0.85,
    addressLeanDeg: 0, impactPastAddressDeg: 0,
  },
  iron5: {
    key: 'iron5', label: '5번 아이언', loft: 27,
    refClubSpeed: 94 * MPH, refBallSpeed: 132 * MPH, refLaunch: 12.1, refSpin: 5361, refAttack: -3.1,
    smash: 1.41, spinLoft: 24, faceWeight: 0.75,
    addressLeanDeg: 3, impactPastAddressDeg: 0,
  },
  iron7: {
    key: 'iron7', label: '7번 아이언', loft: 34,
    refClubSpeed: 90 * MPH, refBallSpeed: 120 * MPH, refLaunch: 16.3, refSpin: 7097, refAttack: -4.3,
    smash: 1.33, spinLoft: 28, faceWeight: 0.75,
    // Ball in the middle, hands slightly ahead (3-5 deg toward the target).
    addressLeanDeg: 4, impactPastAddressDeg: 0,
  },
  pw: {
    key: 'pw', label: '피칭 웨지', loft: 46,
    refClubSpeed: 83 * MPH, refBallSpeed: 102 * MPH, refLaunch: 24.2, refSpin: 9304, refAttack: -5.0,
    smash: 1.23, spinLoft: 36, faceWeight: 0.7,
    // Ball toward the trail foot, strong forward lean (5-8 deg).
    addressLeanDeg: 7, impactPastAddressDeg: 0,
  },
});

/** Address posture for the putter (not a full-swing club). */
export const PUTTER_POSTURE = Object.freeze({ addressLeanDeg: 1, impactPastAddressDeg: 0 });

/** Shaft lean (deg toward the target) and impact offset for a club key, including 'putter'. */
export function clubPosture(key) {
  if (key === 'putter') return PUTTER_POSTURE;
  const c = CLUBS[key];
  return { addressLeanDeg: c?.addressLeanDeg ?? 0, impactPastAddressDeg: c?.impactPastAddressDeg ?? 0 };
}

export const CLUB_ORDER = ['driver', 'wood3', 'iron5', 'iron7', 'pw'];

export function getClub(key) {
  const c = CLUBS[key];
  if (!c) throw new Error(`Unknown club: ${key}`);
  return c;
}
