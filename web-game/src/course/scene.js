// 3D course renderer (three.js). The look follows the course theme:
// "autumn" (단풍 바다 CC, maples on a mountain) or "pinebeach" (seaside
// clifftop links with black pines and golden zoysia).
//
// World (course-engine): x east, y up, z north. three.js: (x, y, -z).

import * as THREE from 'three';
import { fbm, smoothstep } from '../../../course-engine/src/noise.js';
import { pointAlong, dirAt } from '../../../course-engine/src/terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const EYE_HEIGHT = 1.65; // m, camera height in the golfer's view
const EYE_BACK = 2.6; // m behind the ball
const SUN_DIR = new THREE.Vector3(-0.55, 0.32, 0.77).normalize(); // low autumn sun in the south-west (three coords)

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function label(text, { color = '#fff', bg = 'rgba(40,20,10,0.6)', scale = 1 } = {}) {
  const tex = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 26);
    g.fill();
    g.fillStyle = color;
    let size = 64;
    g.font = `bold ${size}px system-ui, sans-serif`;
    while (size > 28 && g.measureText(text).width > w - 48) {
      size -= 4;
      g.font = `bold ${size}px system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(12 * scale, 3 * scale, 1);
  return s;
}

// Deterministic PRNG for placement.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUTUMN = {
  mapleRed: [0.72, 0.16, 0.1],
  mapleOrange: [0.86, 0.42, 0.12],
  ginkgo: [0.93, 0.74, 0.18],
  oak: [0.62, 0.38, 0.16],
  pine: [0.16, 0.3, 0.18],
};

// Fine grass detail (grey, multiplied with the surface colour): speckle,
// short blades and soft clumps, tiled over the ground in world units.
function grassTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, hgt) => {
    ctx.fillStyle = 'rgb(222,222,222)';
    ctx.fillRect(0, 0, w, hgt);
    const r = rng(77);
    for (let i = 0; i < 90; i++) {
      // Soft clumps.
      const x = r() * w;
      const y = r() * hgt;
      const rad = 10 + r() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const v = r() < 0.5 ? 255 : 190;
      g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      for (const ox of [-w, 0, w]) for (const oy of [-hgt, 0, hgt]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - rad, y - rad, 2 * rad, 2 * rad); ctx.restore(); }
    }
    for (let i = 0; i < 5200; i++) {
      // Blades.
      const x = r() * w;
      const y = r() * hgt;
      const v = Math.round(150 + r() * 105);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Per-course look. Colours are linear RGB triplets.
const THEMES = {
  autumn: {
    fog: 0xe8cfa8,
    steps: { terrain: '산악 지형', trees: '단풍 숲', leaves: '낙엽' },
    leaves: true,
    pineShare: 0,
    floor: (n) => [0.55 + 0.12 * n, 0.3 + 0.08 * n, 0.12 + 0.04 * n], // leaf litter
    rough: (n) => [0.4 + 0.05 * n, 0.48 + 0.05 * n, 0.18],
    low: [0.83, 0.76, 0.58], // beach
    rock: [0.47, 0.43, 0.38],
    fairway: [[0.34, 0.58, 0.19], [0.28, 0.5, 0.16]],
    patchRough: [0.47, 0.47, 0.17],
    patchFloor: (nz) => [0.56 + nz * 3, 0.31 + nz, 0.12],
    green: [[0.2, 0.55, 0.16], [0.17, 0.49, 0.14]],
    fringe: [0.26, 0.56, 0.17],
    tee: [0.3, 0.58, 0.2],
    sand: [0.9, 0.84, 0.66],
    pine: [0.16, 0.3, 0.18],
    roof: 0x7a3b26,
    signBg: 'rgba(122,59,38,0.85)',
    maxTrees: 5200,
  },
  pinebeach: {
    fog: 0xcfdce6,
    steps: { terrain: '해안 절벽', trees: '해송 숲', leaves: '바닷바람' },
    leaves: false,
    pineShare: 1,
    floor: (n) => [0.25 + 0.05 * n, 0.3 + 0.05 * n, 0.14], // pine needles and grass
    rough: (n) => [0.3 + 0.05 * n, 0.42 + 0.05 * n, 0.15], // zoysia rough, a little golden
    low: [0.42, 0.4, 0.37], // wave-cut rock
    rock: [0.44, 0.4, 0.36],
    fairway: [[0.34, 0.62, 0.17], [0.27, 0.53, 0.14]], // zoysia (금잔디) fairway
    patchRough: [0.64, 0.56, 0.3],
    patchFloor: (nz) => [0.36 + nz * 2, 0.4 + nz * 2, 0.2],
    green: [[0.24, 0.58, 0.17], [0.2, 0.52, 0.15]],
    fringe: [0.33, 0.56, 0.18],
    tee: [0.36, 0.6, 0.2],
    sand: [0.86, 0.8, 0.62],
    pine: [0.1, 0.22, 0.14], // black pine (해송)
    roof: 0x2f4a5c,
    signBg: 'rgba(30,60,80,0.85)',
    maxTrees: 4200,
  },
};

export class CourseScene {
  constructor(host, course, { onProgress, quality = 'high' } = {}) {
    this.host = host;
    this.course = course;
    this.quality = quality;
    this.theme = THEMES[course.theme] ?? THEMES.autumn;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { high: 1.75, medium: 1.3, low: 1 }[quality] ?? 1.75));
    this.turfTex = quality === 'low' ? null : grassTexture();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(this.theme.fog, 700, 5200);
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 30000);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.camPos = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this.camGoalPos = new THREE.Vector3();
    this.camGoalTarget = new THREE.Vector3();
    this.mode = 'aim';
    this.onProgress = onProgress || (() => {});
    this._loop = this._loop.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
  }

  /** Builds the world in steps so the UI can show progress. */
  async build() {
    const steps = [
      ['하늘과 바다', () => this._buildSkyAndSea()],
      [this.theme.steps.terrain, () => this._buildTerrain()],
      ['페어웨이와 그린', () => this._buildHoles()],
      [this.theme.steps.trees, () => this._buildTrees()],
      ['클럽하우스', () => this._buildClubhouse()],
      ['공과 깃발', () => this._buildBallAndMarkers()],
      [this.theme.steps.leaves, () => this.theme.leaves && this._buildLeaves()],
    ];
    for (let i = 0; i < steps.length; i++) {
      this.onProgress(i / steps.length, steps[i][0]);
      await new Promise((r) => setTimeout(r, 16));
      steps[i][1]();
    }
    this.onProgress(1, '완료');
    this.resize();
  }

  _buildSkyAndSea() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(20000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { sunDir: { value: SUN_DIR } },
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 sunDir; varying vec3 vD;
          void main(){
            float h = clamp(vD.y, -0.1, 1.0);
            vec3 zen = vec3(0.24,0.43,0.72), mid = vec3(0.58,0.74,0.9), hor = vec3(0.98,0.8,0.58);
            vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
            c = mix(c, zen, smoothstep(0.18, 0.7, h));
            float s = max(dot(normalize(vD), sunDir), 0.0);
            c += vec3(1.0,0.75,0.45) * pow(s, 24.0) * 0.55 + vec3(1.0,0.95,0.8) * pow(s, 900.0) * 3.0;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.scene.add(sky);

    this.seaUniforms = { time: { value: 0 }, sunDir: { value: SUN_DIR }, fogColor: { value: new THREE.Color(this.theme.fog) } };
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(60000, 60000, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.seaUniforms,
        transparent: false,
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
        fragmentShader: `
          uniform float time; uniform vec3 sunDir; uniform vec3 fogColor; varying vec3 vW;
          void main(){
            vec2 p = vW.xz;
            float w1 = sin(p.x*0.045 + time*0.9) + sin(p.y*0.06 - time*1.1);
            float w2 = sin((p.x+p.y)*0.11 + time*1.7) * 0.5;
            vec3 n = normalize(vec3((w1+w2)*0.06, 1.0, (w1-w2)*0.06));
            vec3 v = normalize(cameraPosition - vW);
            float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
            vec3 deep = vec3(0.07,0.24,0.42), sky = vec3(0.75,0.75,0.78);
            vec3 c = mix(deep, sky, fres*0.7);
            vec3 r = reflect(-v, n);
            c += vec3(1.0,0.82,0.55) * pow(max(dot(r, sunDir), 0.0), 120.0) * 1.6;
            float d = length(cameraPosition.xz - vW.xz);
            c = mix(c, fogColor, smoothstep(2500.0, 16000.0, d) * 0.85);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.0;
    this.scene.add(sea);

    // Distant islands on the horizon.
    const isl = new THREE.MeshLambertMaterial({ color: 0x7d8aa0 });
    const r = rng(5);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.55 + r() * 0.9);
      const d = 3500 + r() * 4500;
      const m = new THREE.Mesh(new THREE.ConeGeometry(250 + r() * 500, 80 + r() * 260, 7), isl);
      m.position.set(Math.cos(a) * d, 20, Math.sin(a) * d);
      m.scale.z = 0.5 + r();
      this.scene.add(m);
    }

    this.scene.add(new THREE.HemisphereLight(0xffe6c4, 0x5a3e24, 0.95));
    const sun = new THREE.DirectionalLight(0xffd7a0, 1.7);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    this.scene.add(sun);
  }

  _buildTerrain() {
    const c = this.course;
    const { minX, maxX, minZ, maxZ } = c.bounds;
    const step = 10;
    const nx = Math.round((maxX - minX) / step);
    const nz = Math.round((maxZ - minZ) / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uvs = new Float32Array((nx + 1) * (nz + 1) * 2);
    const idx = [];
    let k = 0;
    const tmp = new THREE.Color();
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = minX + i * step;
        const z = minZ + j * step;
        let y = c.heightAt(x, z);
        // Corridors get their own fine mesh: push the coarse ground under it.
        const cor = c.corridor(x, z);
        if (cor.d < Math.max(cor.hole.fairwayHalfWidth, 10) + 16 && y > 2) y -= 1.5;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = -z;
        tmp.setRGB(...(y < 3 ? this.theme.low : this._turf(x, z, y)));
        uvs[k * 2] = x / 6;
        uvs[k * 2 + 1] = z / 6;
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
        k++;
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const d = a + nx + 1;
        const e = d + 1;
        // z is mirrored into three.js space, so this order faces up.
        idx.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, this._groundMaterial(THREE.FrontSide));
    this.scene.add(this.terrain);
  }

  _groundMaterial(side) {
    return new THREE.MeshLambertMaterial({ vertexColors: true, side, map: this.turfTex });
  }

  /**
   * Ground colour at (x, z) with soft edges between surfaces: fairway with
   * mowing stripes and a first cut, green with a checker pattern and a fringe,
   * bunkers with a darker lip, tees, rough and the forest floor. Matches the
   * physics surfaces (course.surfaceAt) to within about a metre.
   */
  _turf(x, z, y) {
    const T = this.theme;
    const c = this.course;
    const n = fbm(x / 40, z / 40, { octaves: 3, seed: 99 });
    const nz = fbm(x / 9, z / 9, { octaves: 2, seed: 5 }) * 0.04;
    if (y < 0.4) return T.low;
    const nn = c.normalAt(x, z);
    const cor = c.corridor(x, z);
    const h = cor.hole;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // Rough -> forest floor.
    const rough = T.rough(n);
    const roughW = Math.max(h.fairwayHalfWidth, 10) + 22;
    let col = mix(rough, T.floor(n), smoothstep(roughW - 2, roughW + 4, cor.d));
    // Fairway with mowing stripes along the hole and a first cut.
    const fairStart = h.carry ? Math.max(0.8, h.carry[1]) : h.par === 3 ? 0.8 : 0.16;
    const half = h.par === 3 ? 10 : h.fairwayHalfWidth;
    const along = cor.s * h.yardage;
    const sIn = smoothstep(fairStart - 0.012, fairStart + 0.012, cor.s);
    const fw = smoothstep(half + 0.9, half - 0.9, cor.d) * sIn;
    const cut = smoothstep(half + 3.2, half + 0.9, cor.d) * sIn;
    const stripe = smoothstep(-0.25, 0.25, Math.sin((along / 9) * Math.PI));
    const fairCol = mix(T.fairway[1], T.fairway[0], stripe).map((v) => v + nz);
    const cutCol = mix(rough, fairCol, 0.55);
    col = mix(col, cutCol, cut);
    col = mix(col, fairCol, fw);
    // Tee box.
    const dt = Math.hypot(x - h.tee.x, z - h.tee.z);
    col = mix(col, T.tee, smoothstep(7.4, 6.6, dt));
    // Green, fringe and checker mowing.
    const dg = Math.hypot(x - h.green.x, z - h.green.z);
    const r = h.greenRadius;
    col = mix(col, T.fringe, smoothstep(r + 2.2, r + 0.4, dg));
    const checker = smoothstep(-0.2, 0.2, Math.sin(x / 2.2) * Math.sin(z / 2.2));
    col = mix(col, mix(T.green[1], T.green[0], checker), smoothstep(r + 0.4, r - 0.4, dg));
    // Bunkers with a darker lip.
    for (const b of h.bunkers) {
      const db = Math.hypot(x - b.x, z - b.z);
      if (db > b.r + 1.2) continue;
      col = mix(col, mix(T.sand, [0.3, 0.27, 0.2], 0.55), smoothstep(b.r + 1.0, b.r + 0.2, db) * smoothstep(b.r - 0.6, b.r + 0.2, db));
      col = mix(col, T.sand.map((v) => v + nz * 0.5), smoothstep(b.r + 0.2, b.r - 0.3, db));
    }
    // Steep ground shows rock.
    col = mix(col, [T.rock[0] + 0.05 * n, T.rock[1] + 0.05 * n, T.rock[2] + 0.04 * n], smoothstep(0.8, 0.7, nn.y));
    return col;
  }

  // Fine (2.5 m) mesh along each hole with per-vertex surface colours, so the
  // fairway, green, bunkers and tee follow the ground exactly.
  _holePatch(h) {
    const c = this.course;
    const step = 2.5;
    const half = Math.max(h.fairwayHalfWidth, 10) + 30;
    const pre = 18; // metres behind the tee
    const post = h.greenRadius + 30; // metres beyond the green
    const length = h.yardage + pre + post;
    const n = Math.ceil(length / step);
    const across = Math.ceil((2 * half) / step);
    const pos = [];
    const col = [];
    const uv = [];
    const idx = [];
    const tmp = new THREE.Color();
    const first = dirAt(h.path, 0.001);
    const last = dirAt(h.path, 0.999);
    for (let i = 0; i <= n; i++) {
      const dist = i * step - pre;
      let p;
      let d;
      if (dist < 0) {
        d = first;
        p = { x: h.tee.x + d.x * dist, z: h.tee.z + d.z * dist };
      } else if (dist > h.yardage) {
        d = last;
        p = { x: h.green.x + d.x * (dist - h.yardage), z: h.green.z + d.z * (dist - h.yardage) };
      } else {
        const s = dist / h.yardage;
        p = pointAlong(h.path, s);
        d = dirAt(h.path, s);
      }
      for (let j = 0; j <= across; j++) {
        const off = -half + j * step;
        const x = p.x + d.z * off;
        const z = p.z - d.x * off;
        pos.push(x, c.heightAt(x, z) + 0.02, -z);
        uv.push(x / 3, z / 3);
        const y = c.heightAt(x, z);
        tmp.setRGB(...this._turf(x, z, y));
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + 1;
        const d2 = a + across + 1;
        const e = d2 + 1;
        idx.push(a, d2, b, b, d2, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, this._groundMaterial(THREE.DoubleSide));
  }

  _buildHoles() {
    const c = this.course;
    this.flags = [];
    for (const h of c.holes) {
      this.scene.add(this._holePatch(h));
      // Tee markers + sign.
      const d = dirAt(h.path, 0.02);
      for (const side of [-1, 1]) {
        const mx = h.tee.x + d.z * side * 3;
        const mz = h.tee.z - d.x * side * 3;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        m.position.copy(V(mx, c.heightAt(mx, mz) + 0.3, mz));
        this.scene.add(m);
      }
      const sign = label(`${h.number}번 홀 · 파${h.par} · ${h.yardage}m`, { scale: 0.7 });
      const sx = h.tee.x - d.x * 8 + d.z * 7;
      const sz = h.tee.z - d.z * 8 - d.x * 7;
      sign.position.copy(V(sx, c.heightAt(sx, sz) + 3, sz));
      this.scene.add(sign);
      // Pin and flag.
      const py = c.heightAt(h.pin.x, h.pin.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pole.position.copy(V(h.pin.x, py + 1.2, h.pin.z));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.48, 6, 1), new THREE.MeshLambertMaterial({ color: 0xd63a2f, side: THREE.DoubleSide }));
      flag.position.copy(V(h.pin.x, py + 2.15, h.pin.z));
      flag.geometry.translate(0.375, 0, 0);
      const cup = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      cup.rotation.x = -Math.PI / 2;
      cup.position.copy(V(h.pin.x, py + 0.12, h.pin.z));
      this.scene.add(pole, flag, cup);
      this.flags.push(flag);
    }
  }

  _buildTrees() {
    const c = this.course;
    const r = rng(42);
    const { minX, maxX, minZ, maxZ } = c.bounds;
    const items = [];
    const maxTrees = Math.round(this.theme.maxTrees * ({ high: 1, medium: 0.7, low: 0.4 }[this.quality] ?? 1));
    for (let tries = 0; tries < 60000 && items.length < maxTrees; tries++) {
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      const y = c.heightAt(x, z);
      if (y < 4) continue;
      const cor = c.corridor(x, z);
      const clear = Math.max(cor.hole.fairwayHalfWidth, 10) + 24;
      if (cor.d < clear) continue;
      // Denser near holes (what the player sees), sparser far away.
      const keep = cor.d < 160 ? 1 : cor.d < 350 ? 0.45 : 0.18;
      if (r() > keep) continue;
      if (fbm(x / 120, z / 120, { octaves: 2, seed: 3 }) < -0.35) continue; // clearings
      if (Math.hypot(x - c.clubhouse.x, z - c.clubhouse.z) < 70) continue;
      const v = fbm(x / 90, z / 90, { octaves: 2, seed: 11 }) + (r() - 0.5) * 0.6;
      // Wind-bent black pines on the clifftops; maples and ginkgo on the mountain.
      const type = r() < this.theme.pineShare || (y > 150 && r() < 0.5) ? 'pine' : v < -0.2 ? 'pine' : v < 0.05 ? 'mapleRed' : v < 0.25 ? 'mapleOrange' : v < 0.4 ? 'oak' : 'ginkgo';
      items.push({ x, y, z, type, s: 0.8 + r() * 0.7, rot: r() * Math.PI * 2, shade: 0.85 + r() * 0.3 });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 4, 5);
    trunkGeo.translate(0, 2, 0);
    const leafGeo = new THREE.IcosahedronGeometry(3.2, 0);
    leafGeo.scale(1, 1.15, 1);
    leafGeo.translate(0, 6.2, 0);
    const pineGeo = new THREE.ConeGeometry(2.6, 8, 7);
    pineGeo.translate(0, 7, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3222 }), items.length);
    const decid = items.filter((t) => t.type !== 'pine');
    const pines = items.filter((t) => t.type === 'pine');
    const crowns = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), decid.length);
    const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pines.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    items.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      sc.set(t.s, t.s, t.s);
      m.compose(V(t.x, t.y - 0.3, t.z), q, sc);
      trunks.setMatrixAt(i, m);
    });
    decid.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      sc.set(t.s, t.s * (0.9 + (t.shade - 0.85)), t.s);
      m.compose(V(t.x, t.y - 0.3, t.z), q, sc);
      crowns.setMatrixAt(i, m);
      const [rr, gg, bb] = AUTUMN[t.type];
      col.setRGB(rr * t.shade, gg * t.shade, bb * t.shade);
      crowns.setColorAt(i, col);
    });
    const bent = this.theme.pineShare > 0; // wind-shaped seaside pines: lower, wider, leaning
    const tilt = new THREE.Quaternion();
    pines.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      if (bent) {
        tilt.setFromAxisAngle(new THREE.Vector3(Math.cos(t.rot), 0, Math.sin(t.rot)), 0.08 + 0.12 * (t.shade - 0.85));
        q.premultiply(tilt);
        sc.set(t.s * 1.35, t.s * 0.85, t.s * 1.35);
      } else {
        sc.set(t.s, t.s * 1.1, t.s);
      }
      m.compose(V(t.x, t.y - 0.3, t.z), q, sc);
      pineMesh.setMatrixAt(i, m);
      const [rr, gg, bb] = this.theme.pine;
      col.setRGB(rr * t.shade, gg * t.shade, bb * t.shade);
      pineMesh.setColorAt(i, col);
    });
    this.scene.add(trunks, crowns, pineMesh);
    this.treeCount = items.length;
  }

  _buildClubhouse() {
    const c = this.course;
    const { x, z } = c.clubhouse;
    const y = c.heightAt(x, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 18), new THREE.MeshLambertMaterial({ color: 0xefe3cc }));
    body.position.copy(V(x, y + 4, z));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(24, 7, 4), new THREE.MeshLambertMaterial({ color: this.theme.roof }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.6);
    roof.position.copy(V(x, y + 11.5, z));
    const sign = label(c.name, { bg: this.theme.signBg });
    sign.position.copy(V(x, y + 17, z));
    this.scene.add(body, roof, sign);
  }

  _buildBallAndMarkers() {
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    this.scene.add(this.ball);
    // Soft contact shadow on the ground under the ball (cheap depth cue).
    const shadowTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(3 * 6000);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xffe28a }));
    trail.frustumCulled = false;
    this.scene.add(trail);
    this.aimGeo = new THREE.BufferGeometry();
    this.aimPos = new Float32Array(3 * 80);
    this.aimGeo.setAttribute('position', new THREE.BufferAttribute(this.aimPos, 3));
    this.aimLine = new THREE.Line(this.aimGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.8 }));
    this.aimLine.frustumCulled = false;
    this.scene.add(this.aimLine);
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.aimRing);
    this.landMarker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 32), new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide }));
    this.landMarker.rotation.x = -Math.PI / 2;
    this.landMarker.visible = false;
    this.scene.add(this.landMarker);
  }

  _buildLeaves() {
    const n = 450;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const r = rng(9);
    const palette = [AUTUMN.mapleRed, AUTUMN.mapleOrange, AUTUMN.ginkgo, AUTUMN.oak];
    this.leafSeeds = [];
    for (let i = 0; i < n; i++) {
      pos.set([(r() - 0.5) * 70, r() * 25, (r() - 0.5) * 70], i * 3);
      const p = palette[Math.floor(r() * palette.length)];
      col.set([p[0] * 1.15, p[1] * 1.15, p[2] * 1.15], i * 3);
      this.leafSeeds.push({ phase: r() * Math.PI * 2, speed: 0.6 + r() * 0.8, drift: 0.5 + r() });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tex = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(32, 32, 26, 14, Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
    });
    this.leaves = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, map: tex, transparent: true, alphaTest: 0.4 }));
    this.leaves.frustumCulled = false;
    this.scene.add(this.leaves);
  }

  // ---------------------------------------------------------------- runtime

  setBall(p) {
    this.ballWorld = { ...p };
    this.ball.scale.setScalar(1);
    this.landMarker.visible = false;
    this.ball.position.copy(V(p.x, p.y + 0.09, p.z));
    this._placeShadow(p.x, p.z, 0);
  }

  /** Aim line along a compass heading for `distance` metres (putts: straight line to the pin). */
  setAim(headingDeg, distance) {
    const c = this.course;
    const b = this.ballWorld;
    const hd = (headingDeg * Math.PI) / 180;
    const dx = Math.sin(hd);
    const dz = Math.cos(hd);
    const n = 60;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * distance;
      const x = b.x + dx * t;
      const z = b.z + dz * t;
      this.aimPos.set([x, c.heightAt(x, z) + 0.25, -z], i * 3);
    }
    this.aimGeo.setDrawRange(0, n);
    this.aimGeo.attributes.position.needsUpdate = true;
    this.aimLine.computeLineDistances();
    const ex = b.x + dx * distance;
    const ez = b.z + dz * distance;
    this.aimRing.position.copy(V(ex, c.heightAt(ex, ez) + 0.3, ez));
    const ringScale = Math.max(0.15, Math.min(1.6, distance / 120));
    this.aimRing.scale.set(ringScale, ringScale, ringScale);
    this.aimLine.visible = this.aimRing.visible = true;
    this.aimHeading = headingDeg;
    this.aimDistance = distance;
    if (this.mode === 'aim') this._aimCamera(false);
  }

  _aimCamera(snap) {
    const b = this.ballWorld;
    const hd = (this.aimHeading * Math.PI) / 180;
    const dx = Math.sin(hd);
    const dz = Math.cos(hd);
    const putt = this.aimDistance < 30;
    // A golfer's view: standing just behind the ball at eye height.
    const back = putt ? 3.2 : EYE_BACK;
    const up = putt ? 1.6 : EYE_HEIGHT;
    const look = Math.min(this.aimDistance, putt ? this.aimDistance : 150);
    const cx = b.x - dx * back;
    const cz = b.z - dz * back;
    // Rise only as much as needed to see over a crest right in front.
    let crest = b.y;
    for (let t = 5; t <= Math.min(look, 40); t += 5) crest = Math.max(crest, this.course.heightAt(b.x + dx * t, b.z + dz * t));
    const cy = Math.max(this.course.heightAt(cx, cz) + up, b.y + up, crest + (putt ? 0.8 : 0.6));
    this.camGoalPos.copy(V(cx, cy, cz));
    const tx = b.x + dx * look;
    const tz = b.z + dz * look;
    this.camGoalTarget.copy(V(tx, this.course.heightAt(tx, tz) + (putt ? 0 : 1.2), tz));
    if (snap) {
      this.camPos.copy(this.camGoalPos);
      this.camTarget.copy(this.camGoalTarget);
    }
  }

  /** Fly over a hole from behind the tee to the green, then settle at the ball. */
  flyover(hole, seconds = 4.5) {
    this.mode = 'flyover';
    this.fly = { hole, t: 0, dur: seconds, start: performance.now() };
    this.trailGeo.setDrawRange(0, 0);
    this.landMarker.visible = false;
  }

  /** End a running flyover immediately. */
  skipFlyover() {
    if (this.mode === 'flyover' && this.fly) this.fly.start = performance.now() - (this.fly.dur + 1) * 1000;
  }

  playShot(result, onDone) {
    this.mode = 'flight';
    this.flight = { result, t: 0, idx: 0, onDone };
    this.trailGeo.setDrawRange(0, 0);
    this.landMarker.visible = false;
    this.aimLine.visible = this.aimRing.visible = false;
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.clock.getDelta();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  _placeShadow(x, z, above) {
    const gy = this.course.heightAt(x, z);
    this.ballShadow.position.copy(V(x, Math.max(gy, 0) + 0.03, z));
    const k = Math.max(0.15, 1 - above / 25);
    this.ballShadow.scale.setScalar(1 + above / 15);
    this.ballShadow.material.opacity = k;
    this.ballShadow.visible = gy > 0;
  }

  /** World (course) point -> CSS pixels in the canvas, or null if behind the camera. */
  project(x, y, z) {
    const v = V(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, w: r.width, h: r.height };
  }

  /** Orange line over the water the shot has to carry, with its length. */
  setHazardLine(hz, from) {
    if (!this.hazardLine) {
      this.hazardGeo = new THREE.BufferGeometry();
      this.hazardGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 40), 3));
      this.hazardLine = new THREE.Line(this.hazardGeo, new THREE.LineBasicMaterial({ color: 0xff8a3d }));
      this.hazardLine.frustumCulled = false;
      this.scene.add(this.hazardLine);
    }
    if (!hz) {
      this.hazardLine.visible = false;
      return;
    }
    // A bar across the line of play at the carry distance (screen-golf style).
    const pos = this.hazardGeo.attributes.position;
    const cx = from.x + hz.dx * hz.to;
    const cz = from.z + hz.dz * hz.to;
    const y = Math.max(0, this.course.heightAt(cx, cz)) + 0.6;
    for (let i = 0; i < 40; i++) {
      const o = -12 + (24 * i) / 39;
      pos.setXYZ(i, cx + hz.dz * o, y, -(cz - hz.dx * o));
    }
    pos.needsUpdate = true;
    this.hazardLine.visible = true;
  }

  /** Release GPU resources and remove the canvas (used when switching courses). */
  dispose() {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const m = o.material;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
        mm.map?.dispose();
        mm.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  _loop() {
    if (!this.running) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(raw, 1e-3)) * 0.05 : 30;
    this.time += dt;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    if (this.seaUniforms) this.seaUniforms.time.value = this.time;
    for (const f of this.flags || []) f.rotation.y = Math.sin(this.time * 2.3 + f.position.x) * 0.35;
    const c = this.course;
    if (this.mode === 'flyover' && this.fly) {
      const F = this.fly;
      // Real time, so a slow device does not stretch the flyover.
      F.t = (performance.now() - F.start) / 1000;
      const s = Math.min(1, F.t / F.dur);
      const e = s * s * (3 - 2 * s);
      const p = pointAlong(F.hole.path, Math.min(1, e * 1.05));
      const d = dirAt(F.hole.path, Math.min(0.98, e));
      const h = c.heightAt(p.x, p.z);
      this.camGoalPos.copy(V(p.x - d.x * 60, h + 45 - 25 * e, p.z - d.z * 60));
      const t = pointAlong(F.hole.path, Math.min(1, e + 0.25));
      this.camGoalTarget.copy(V(t.x, c.heightAt(t.x, t.z), t.z));
      if (!F.snapped) {
        F.snapped = true;
        this.camPos.copy(this.camGoalPos);
        this.camTarget.copy(this.camGoalTarget);
      }
      if (F.t >= F.dur + 0.8) {
        this.mode = 'aim';
        this._aimCamera(false);
        this.fly.onDone?.();
      }
    } else if (this.mode === 'flight' && this.flight) {
      const f = this.flight;
      const pts = f.result.points;
      // Roll-out plays faster than real time to keep the game moving.
      const rolling = pts[f.idx] && pts[f.idx].phase === 'roll';
      f.t += dt * (rolling ? 3 : 1);
      while (f.idx < pts.length - 1 && pts[f.idx + 1].t <= f.t) {
        f.idx++;
        const n = this.trailGeo.drawRange.count;
        if (pts[f.idx].phase !== 'roll' && n < 6000) {
          this.trailPos.set([pts[f.idx].x, pts[f.idx].y + 0.1, -pts[f.idx].z], n * 3);
          this.trailGeo.setDrawRange(0, n + 1);
          this.trailGeo.attributes.position.needsUpdate = true;
        }
        if (pts[f.idx].phase === 'contact' && !this.landMarker.visible) {
          this.landMarker.position.copy(V(pts[f.idx].x, pts[f.idx].y + 0.12, pts[f.idx].z));
          this.landMarker.visible = true;
        }
      }
      const a = pts[f.idx];
      const b = pts[Math.min(f.idx + 1, pts.length - 1)];
      const span = b.t - a.t;
      const k = span > 0 ? Math.min(1, (f.t - a.t) / span) : 1;
      const bp = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
      this.ball.position.copy(V(bp.x, bp.y + 0.09, bp.z));
      this._placeShadow(bp.x, bp.z, bp.y - c.heightAt(bp.x, bp.z));
      // Watch the ball like the golfer: stay at eye height behind the ball
      // and turn to follow it; once it is far away, walk the camera after it
      // (still near eye height) so the ball stays large enough to see.
      const start = pts[0];
      const vx = bp.x - start.x;
      const vz = bp.z - start.z;
      const l = Math.hypot(vx, vz);
      const ux = l > 1 ? vx / l : Math.sin((this.aimHeading * Math.PI) / 180);
      const uz = l > 1 ? vz / l : Math.cos((this.aimHeading * Math.PI) / 180);
      if (f.eye === undefined) f.eye = { x: start.x - ux * EYE_BACK, z: start.z - uz * EYE_BACK };
      const followGap = 70;
      const along = Math.max(0, l - followGap);
      const cx = f.eye.x + ux * along;
      const cz = f.eye.z + uz * along;
      const ground = c.heightAt(cx, cz);
      const lift = along > 0 ? Math.min(25, Math.max(0, bp.y - ground) * 0.25) : 0;
      this.camGoalPos.copy(V(cx, Math.max(ground + EYE_HEIGHT + lift, start.y + EYE_HEIGHT - along * 0.05), cz));
      this.camGoalTarget.copy(V(bp.x, bp.y, bp.z));
      // Keep the ball visible at long range.
      const camDist = this.camera.position.distanceTo(this.ball.position);
      this.ball.scale.setScalar(Math.min(8, Math.max(1, camDist / 30)));
      if (f.idx >= pts.length - 1 && !f.done) {
        f.done = true;
        setTimeout(() => f.onDone?.(f.result), 900);
      }
    }
    const lerp = 1 - Math.exp(-dt * (this.mode === 'flight' ? 2.2 : 3));
    this.camPos.lerp(this.camGoalPos, lerp);
    // In flight the view turns quickly to keep the ball near the centre.
    this.camTarget.lerp(this.camGoalTarget, this.mode === 'flight' ? 1 - Math.exp(-dt * 9) : lerp);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this._updateLeaves(dt);
  }

  _updateLeaves(dt) {
    if (!this.leaves) return;
    const p = this.leaves.geometry.attributes.position;
    const cam = this.camera.position;
    for (let i = 0; i < this.leafSeeds.length; i++) {
      const s = this.leafSeeds[i];
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      y -= s.speed * dt;
      x += Math.sin(this.time * 1.3 + s.phase) * s.drift * dt + 0.6 * dt;
      z += Math.cos(this.time * 0.9 + s.phase) * s.drift * dt * 0.5;
      // Keep leaves in a box around the camera (wrap, also after camera jumps).
      const wrap = (v, c, half) => c + ((((v - c + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
      x = wrap(x, cam.x, 35);
      z = wrap(z, cam.z, 35);
      y = wrap(y, cam.y + 7, 13);
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
  }
}

