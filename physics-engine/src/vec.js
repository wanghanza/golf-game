// Minimal 3-vector helpers on plain arrays [x, y, z].
// World frame used by the physics engine:
//   +x = right of the target line (seen from behind the golfer)
//   +y = up
//   +z = down the target line
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 0];
};
export const DEG = Math.PI / 180;
export const RPM_TO_RADS = (2 * Math.PI) / 60;
