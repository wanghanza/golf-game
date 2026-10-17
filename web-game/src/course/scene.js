// "단풍 바다 CC": autumn mountain course with a sea view, rendered with three.js.
//
// World (course-engine): x east, y up, z north. three.js: (x, y, -z).

import * as THREE from 'three';
import { fbm } from '../../../course-engine/src/noise.js';
import { pointAlong, dirAt } from '../../../course-engine/src/terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, -z);
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
    g.font = 'bold 64px system-ui, sans-serif';
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

export class CourseScene {
  constructor(host, course, { onProgress } = {}) {
    this.host = host;
    this.course = course;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8cfa8, 700, 5200);
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
      ['산악 지형', () => this._buildTerrain()],
      ['페어웨이와 그린', () => this._buildHoles()],
      ['단풍 숲', () => this._buildTrees()],
      ['클럽하우스', () => this._buildClubhouse()],
      ['공과 깃발', () => this._buildBallAndMarkers()],
      ['낙엽', () => this._buildLeaves()],
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

    this.seaUniforms = { time: { value: 0 }, sunDir: { value: SUN_DIR }, fogColor: { value: new THREE.Color(0xe8cfa8) } };
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
        const n = fbm(x / 40, z / 40, { octaves: 3, seed: 99 });
        if (y < 3) {
          tmp.setRGB(0.83, 0.76, 0.58); // beach
        } else {
          const s = c.surfaceAt(x, z).name;
          const nn = c.normalAt(x, z);
          if (nn.y < 0.78) tmp.setRGB(0.47, 0.43, 0.38); // rock
          else if (s === 'forest') tmp.setRGB(0.55 + 0.12 * n, 0.3 + 0.08 * n, 0.12 + 0.04 * n); // leaf litter
          else tmp.setRGB(0.52 + 0.05 * n, 0.55 + 0.05 * n, 0.24); // golden rough
        }
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
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.terrain);
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
        const surf = c.surfaceAt(x, z).name;
        const stripe = Math.floor(dist / 12) % 2 === 0;
        const nz = fbm(x / 9, z / 9, { octaves: 2, seed: 5 }) * 0.04;
        switch (surf) {
          case 'fairway': tmp.setRGB((stripe ? 0.34 : 0.28) + nz, (stripe ? 0.58 : 0.5) + nz, (stripe ? 0.19 : 0.16)); break;
          case 'green': tmp.setRGB(0.2 + nz * 0.5, 0.52 + nz * 0.5, 0.17); break;
          case 'tee': tmp.setRGB(0.3, 0.58, 0.2); break;
          case 'bunker': tmp.setRGB(0.9, 0.84, 0.66); break;
          case 'rough': tmp.setRGB(0.47 + nz, 0.47 + nz, 0.17); break;
          case 'water': tmp.setRGB(0.83, 0.76, 0.58); break;
          default: tmp.setRGB(0.56 + nz * 3, 0.31 + nz, 0.12); // leaf litter
        }
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
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
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
    const maxTrees = 5200;
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
      const type = y > 150 && r() < 0.5 ? 'pine' : v < -0.2 ? 'pine' : v < 0.05 ? 'mapleRed' : v < 0.25 ? 'mapleOrange' : v < 0.4 ? 'oak' : 'ginkgo';
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
    pines.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      sc.set(t.s, t.s * 1.1, t.s);
      m.compose(V(t.x, t.y - 0.3, t.z), q, sc);
      pineMesh.setMatrixAt(i, m);
      const [rr, gg, bb] = AUTUMN.pine;
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
    const roof = new THREE.Mesh(new THREE.ConeGeometry(24, 7, 4), new THREE.MeshLambertMaterial({ color: 0x7a3b26 }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.6);
    roof.position.copy(V(x, y + 11.5, z));
    const sign = label('단풍 바다 CC', { bg: 'rgba(122,59,38,0.85)' });
    sign.position.copy(V(x, y + 17, z));
    this.scene.add(body, roof, sign);
  }

  _buildBallAndMarkers() {
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    this.scene.add(this.ball);
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
    this.landMarker.visible = false;
    this.ball.position.copy(V(p.x, p.y + 0.09, p.z));
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
    const back = putt ? 3.2 : 8;
    const up = putt ? 1.6 : 4;
    const look = Math.min(this.aimDistance, putt ? this.aimDistance : 150);
    const cx = b.x - dx * back;
    const cz = b.z - dz * back;
    // See over a crest in front of the ball.
    let crest = b.y;
    for (let t = 5; t <= Math.min(look, 60); t += 5) crest = Math.max(crest, this.course.heightAt(b.x + dx * t, b.z + dz * t));
    const cy = Math.max(this.course.heightAt(cx, cz) + up, b.y + up, crest + (putt ? 0.8 : 2));
    this.camGoalPos.copy(V(cx, cy, cz));
    const tx = b.x + dx * look;
    const tz = b.z + dz * look;
    this.camGoalTarget.copy(V(tx, this.course.heightAt(tx, tz) + (putt ? 0 : 1.5), tz));
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

  _loop() {
    if (!this.running) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(raw, 1e-3)) * 0.05 : 30;
    this.time += dt;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
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
      const start = pts[0];
      const vx = bp.x - start.x;
      const vz = bp.z - start.z;
      const l = Math.hypot(vx, vz) || 1;
      const back = Math.min(18, 7 + (bp.y - start.y) * 0.3);
      const cx = bp.x - (vx / l) * back;
      const cz = bp.z - (vz / l) * back;
      this.camGoalPos.copy(V(cx, Math.max(c.heightAt(cx, cz) + 3, bp.y + 3), cz));
      this.camGoalTarget.copy(V(bp.x + (vx / l) * 10, bp.y, bp.z + (vz / l) * 10));
      if (f.idx >= pts.length - 1 && !f.done) {
        f.done = true;
        setTimeout(() => f.onDone?.(f.result), 900);
      }
    }
    const lerp = 1 - Math.exp(-dt * (this.mode === 'flight' ? 2.2 : 3));
    this.camPos.lerp(this.camGoalPos, lerp);
    this.camTarget.lerp(this.camGoalTarget, lerp);
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

