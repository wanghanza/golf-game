// Small vector / quaternion / matrix helpers. Quaternions are [w, x, y, z].
// Rotation convention: q maps phone (body) coordinates to world coordinates.

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize(a) {
    const n = Math.hypot(a[0], a[1], a[2]);
    return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
  },
};

export const quat = {
  identity: () => [1, 0, 0, 0],
  mul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
  },
  conj: (q) => [q[0], -q[1], -q[2], -q[3]],
  normalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  },
  fromAxisAngle(axis, angle) {
    const u = v3.normalize(axis);
    const s = Math.sin(angle / 2);
    return [Math.cos(angle / 2), u[0] * s, u[1] * s, u[2] * s];
  },
  /** Rotation that takes unit vector a onto unit vector b (shortest arc). */
  fromTwoVectors(a, b) {
    const ua = v3.normalize(a);
    const ub = v3.normalize(b);
    const d = v3.dot(ua, ub);
    if (d < -0.999999) {
      let axis = v3.cross([1, 0, 0], ua);
      if (v3.norm(axis) < 1e-6) axis = v3.cross([0, 1, 0], ua);
      return quat.fromAxisAngle(axis, Math.PI);
    }
    const c = v3.cross(ua, ub);
    return quat.normalize([1 + d, c[0], c[1], c[2]]);
  },
  rotate(q, v) {
    const p = [0, v[0], v[1], v[2]];
    const r = quat.mul(quat.mul(q, p), quat.conj(q));
    return [r[1], r[2], r[3]];
  },
  /** Integrate a body-frame angular velocity (rad/s) over dt seconds. */
  integrateBody(q, w, dt) {
    const angle = Math.hypot(w[0], w[1], w[2]) * dt;
    if (angle < 1e-12) return q;
    return quat.normalize(quat.mul(q, quat.fromAxisAngle(w, angle)));
  },
  /** Signed twist angle (rad) of q about unit axis u (swing-twist decomposition). */
  twistAngle(q, u) {
    const p = q[1] * u[0] + q[2] * u[1] + q[3] * u[2];
    let a = 2 * Math.atan2(p, q[0]);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a < -Math.PI) a += 2 * Math.PI;
    return a;
  },
};

/** Principal eigenvector of a symmetric 3x3 matrix (Jacobi iterations). */
export function principalAxis(m) {
  const a = m.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 3; i++) if (a[i][i] > a[best][best]) best = i;
  return { vector: v3.normalize([V[0][best], V[1][best], V[2][best]]), values: [a[0][0], a[1][1], a[2][2]] };
}

/** Weighted scatter matrix sum(w * v v^T). */
export function scatter(vectors, weights) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const w = weights ? weights[i] : 1;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r][c] += w * v[r] * v[c];
  }
  return m;
}

export function wrapDeg(a) {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}
