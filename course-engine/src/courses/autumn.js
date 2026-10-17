// "단풍 바다 CC": autumn mountain course with a sea view.
import { fbm, smoothstep } from '../noise.js';
import { HOLE_SPECS, PEAK, CLUBHOUSE } from '../layout.js';

function naturalHeight(x, z) {
  const r2 = (x - PEAK.x) ** 2 + (z - PEAK.z) ** 2;
  const mountain = 260 * Math.exp(-r2 / 845000) - 60;
  const ridges = 34 * fbm(x / 300, z / 300, { octaves: 4, seed: 7 });
  const detail = 5 * fbm(x / 55, z / 55, { octaves: 3, seed: 31 });
  // Fade the noise out offshore so the sea floor stays smooth.
  const land = smoothstep(-40, 20, mountain);
  return mountain + (ridges + detail) * (0.35 + 0.65 * land);
}

export const AUTUMN_COURSE = Object.freeze({
  id: 'autumn',
  name: '단풍 바다 CC',
  subtitle: '가을 산악 코스, 바다 전망',
  specs: HOLE_SPECS,
  start: CLUBHOUSE,
  clubhouse: CLUBHOUSE,
  natural: () => naturalHeight,
  bounds: { minX: -1300, maxX: 1300, minZ: -1300, maxZ: 1500 },
  windScale: 1,
  theme: 'autumn',
});
