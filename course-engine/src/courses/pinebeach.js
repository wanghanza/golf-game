// "해남 솔바다 링크스": a seaside cliff-top course inspired by the publicly
// described character of Pine Beach Golf Links in Haenam (South Jeolla):
// holes laid on rocky clifftops of a peninsula with small headlands, about
// ten holes along the sea, a signature par 3 (6th) played across a cove
// from one headland to another, a second sea-crossing par 3 (15th), black
// pines (haesong) and golden zoysia, islands of the Dadohae on the horizon.
// The routing, distances and hole names are original to this game; it is
// not a replica of the real course.
import { fbm, smoothstep } from '../noise.js';
import { segDistance } from '../layout.js';

const P = (x, z) => ({ x, z });

const SPECS = Object.freeze([
  // Front nine: south along the west cliffs, across the cove, back up the pine valley.
  { name: '솔바람 출발', par: 4, tee: P(-60, -50), green: P(-180, -400), coast: 0 },
  { name: '서쪽 절벽', par: 5, tee: P(-210, -430), corner: P(-250, -700), green: P(-370, -880), coast: 1 },
  { name: '곶 끝 그린', par: 3, tee: P(-400, -905), green: P(-560, -930), coast: 1 },
  { name: '파도 능선', par: 4, tee: P(-570, -975), corner: P(-520, -1180), green: P(-430, -1320), coast: 1 },
  { name: '해송 길', par: 4, tee: P(-420, -1365), green: P(-320, -1690), coast: 1 },
  { name: '바다 건너 (시그니처)', par: 3, tee: P(-350, -1745), green: P(-175, -1800), carry: [0.08, 0.88], coast: 1 },
  { name: '갯바위 올라', par: 5, tee: P(-140, -1790), corner: P(-70, -1530), green: P(-130, -1310), coast: 0 },
  { name: '솔숲 계곡', par: 4, tee: P(-120, -1270), green: P(-110, -900), coast: 0 },
  { name: '클럽하우스로', par: 4, tee: P(-100, -830), green: P(-20, -445), coast: 0 },
  // Back nine: down the east cliffs, round the southern tip, home up the middle.
  { name: '동쪽 바다', par: 4, tee: P(60, -430), green: P(290, -720), coast: 0 },
  { name: '금잔디 언덕', par: 4, tee: P(330, -750), corner: P(410, -950), green: P(450, -1080), coast: 1 },
  { name: '다도해 전망', par: 5, tee: P(490, -1115), corner: P(560, -1400), green: P(480, -1590), coast: 1 },
  { name: '등대 곶', par: 3, tee: P(450, -1630), green: P(560, -1750), coast: 1 },
  { name: '노을 홀', par: 4, tee: P(520, -1800), corner: P(400, -2000), green: P(230, -2060), coast: 1 },
  { name: '해협 건너', par: 3, tee: P(200, -2110), green: P(30, -2170), carry: [0.08, 0.88], coast: 1 },
  { name: '남쪽 끝에서', par: 4, tee: P(20, -2130), green: P(110, -1790), coast: 0 },
  { name: '솔숲 롱홀', par: 5, tee: P(140, -1745), corner: P(220, -1480), green: P(200, -1275), coast: 0 },
  { name: '귀향', par: 4, tee: P(210, -1235), corner: P(200, -980), green: P(120, -830), coast: 0 },
]);

export const PINEBEACH_CLUBHOUSE = Object.freeze({ x: 0, z: -40 });

// Inland body of the peninsula (pine valley between the coastal holes).
const INLAND = [
  P(-170, 150), P(-150, -380), P(-230, -650), P(-350, -860), P(-480, -1000), P(-470, -1250), P(-380, -1450),
  P(-290, -1650), P(-120, -1720), P(-40, -1850), P(100, -1900), P(300, -1950), P(430, -1800), P(480, -1650),
  P(500, -1450), P(470, -1150), P(380, -900), P(250, -650), P(170, 150),
];

// Islands of the archipelago (inside the play bounds they count as land, but
// they are far off any line of play).
const ISLANDS = [
  { x: -950, z: -2350, r: 220, h: 80 },
  { x: 750, z: -2550, r: 300, h: 130 },
  { x: 1150, z: -1500, r: 170, h: 60 },
  { x: -1150, z: -1150, r: 190, h: 70 },
  { x: 250, z: -2950, r: 380, h: 160 },
  { x: -500, z: -2800, r: 200, h: 90 },
];

function polygonSdf(px, pz, poly) {
  // Signed distance: positive inside.
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    d = Math.min(d, segDistance(px, pz, a, b).d);
    if ((a.z > pz) !== (b.z > pz) && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside ? d : -d;
}

function makeNatural(holes) {
  // Land = the peninsula body + a strip along every hole (minus forced
  // carries) + the walks between holes; the sea elsewhere.
  const segs = [];
  const sample = (h, s0, s1, margin) => {
    const n = Math.max(2, Math.ceil(((s1 - s0) * h.length) / 25));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const p = along(h.path, s0 + ((s1 - s0) * k) / n);
      if (prev) segs.push({ a: prev, b: p, m: margin });
      prev = p;
    }
  };
  holes.forEach((h, i) => {
    const margin = h.carry ? 28 : 78;
    if (h.carry) {
      sample(h, 0, h.carry[0] - 0.02, margin);
      sample(h, h.carry[1] + 0.02, 1, margin);
    } else {
      sample(h, 0, 1, margin);
    }
    if (i > 0) segs.push({ a: holes[i - 1].green, b: h.tee, m: 30 });
  });
  segs.push({ a: PINEBEACH_CLUBHOUSE, b: holes[0].tee, m: 70 });
  segs.push({ a: holes[17].green, b: PINEBEACH_CLUBHOUSE, m: 50 });

  const landSdf = (x, z) => {
    let sdf = polygonSdf(x, z, INLAND) - 10;
    for (const s of segs) {
      // Cheap reject.
      if (Math.abs(x - s.a.x) > 140 && Math.abs(x - s.b.x) > 140 && Math.sign(x - s.a.x) === Math.sign(x - s.b.x)) continue;
      sdf = Math.max(sdf, s.m - segDistance(x, z, s.a, s.b).d);
    }
    // Mainland to the north.
    sdf = Math.max(sdf, z - 60);
    // Ragged, rocky coastline.
    return sdf + 14 * fbm(x / 70, z / 70, { octaves: 3, seed: 21 });
  };

  return (x, z) => {
    const sdf = landSdf(x, z);
    // Clifftop plateau 18-30 m, rising inland into pine-covered hills.
    const inland = smoothstep(20, 220, sdf);
    const plateau = 22 + 7 * fbm(x / 260, z / 260, { octaves: 3, seed: 4 }) + 2.2 * fbm(x / 35, z / 35, { octaves: 2, seed: 8 }) + 22 * inland;
    // Steep rocky cliff down to the sea.
    const cliff = smoothstep(-6, 12, sdf);
    let y = -12 + (plateau + 12) * cliff;
    for (const isl of ISLANDS) {
      const d2 = ((x - isl.x) ** 2 + (z - isl.z) ** 2) / (isl.r * isl.r);
      if (d2 < 4) y = Math.max(y, isl.h * Math.exp(-d2 * 1.6) * (1 + 0.25 * fbm(x / 60, z / 60, { octaves: 2, seed: 13 })) - 12);
    }
    return y;
  };
}

function along(path, s) {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  let t = s * total;
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    if (t <= seg || i === path.length - 2) {
      const f = seg ? Math.min(1, t / seg) : 0;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * f, z: path[i].z + (path[i + 1].z - path[i].z) * f };
    }
    t -= seg;
  }
  return path[path.length - 1];
}

export const PINEBEACH_COURSE = Object.freeze({
  id: 'pinebeach',
  name: '해남 솔바다 링크스',
  subtitle: '해남 파인비치에서 영감 — 바닷가 절벽 위 링크스',
  specs: SPECS,
  start: PINEBEACH_CLUBHOUSE,
  clubhouse: PINEBEACH_CLUBHOUSE,
  natural: makeNatural,
  bounds: { minX: -1000, maxX: 1000, minZ: -2500, maxZ: 400 },
  windScale: 1.35,
  theme: 'pinebeach',
});
