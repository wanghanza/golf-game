// Three.js driving range.
//
// Physics frame: x right, y up, z downrange. Three.js frame used here:
// (x, y, -z) so that a camera looking down -z sees +x on the right.

import * as THREE from 'three';

const toThree = (p) => new THREE.Vector3(p.x, p.y, -p.z);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeLabel(text, color = '#ffffff', bg = 'rgba(0,0,0,0.45)') {
  const tex = canvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 18);
    g.fill();
    g.fillStyle = color;
    g.font = 'bold 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(8, 3, 1);
  return s;
}

export class RangeScene {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd9ee, 180, 520);
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 2000);
    this.camTarget = new THREE.Vector3(0, 1.2, -60);
    this.camPos = new THREE.Vector3(0, 1.7, 5.5);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    this._buildSky();
    this._buildGround();
    this._buildMarkers();
    this._buildBall();

    this.flight = null;
    this.running = false;
    this.onShotDone = null;
    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1200, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d7fc4) }, bottom: { value: new THREE.Color(0xd8ebf7) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a5a2a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-60, 120, 40);
    this.scene.add(sun);
  }

  _buildGround() {
    const roughTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#3f7a35';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(${20 + Math.random() * 40},${70 + Math.random() * 60},${20 + Math.random() * 30},0.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
    roughTex.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ map: roughTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -500);
    this.scene.add(ground);

    const fwTex = canvasTexture(64, 256, (g, w, h) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#5cab48' : '#67b852';
        g.fillRect(0, (i * h) / 8, w, h / 8);
      }
    });
    fwTex.wrapS = fwTex.wrapT = THREE.RepeatWrapping;
    fwTex.repeat.set(1, 12);
    const fw = new THREE.Mesh(new THREE.PlaneGeometry(44, 420), new THREE.MeshLambertMaterial({ map: fwTex }));
    fw.rotation.x = -Math.PI / 2;
    fw.position.set(0, 0, -(30 + 210));
    this.scene.add(fw);

    const tee = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 9), new THREE.MeshLambertMaterial({ color: 0x78c25e }));
    tee.position.set(0, 0.0, 1.5);
    this.scene.add(tee);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshLambertMaterial({ color: 0x2e6b2b }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, 0.045, 0.2);
    this.scene.add(mat);

    // Target line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.05, -2), new THREE.Vector3(0, 0.05, -330)]);
    this.scene.add(new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.45 })).computeLineDistances());

    // Trees for depth cues (deterministic placement)
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
    const crownGeo = new THREE.ConeGeometry(2.4, 7, 8);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5b4330 });
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2d5a2a });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 70;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (48 + rnd() * 40);
      const z = -(20 + rnd() * 430);
      const s = 0.8 + rnd() * 0.8;
      m.makeScale(s, s, s).setPosition(x, 1.5 * s, z);
      trunks.setMatrixAt(i, m);
      m.makeScale(s, s, s).setPosition(x, 6 * s, z);
      crowns.setMatrixAt(i, m);
    }
    this.scene.add(trunks, crowns);
  }

  _buildMarkers() {
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.setUnits('m');
    // Target flag at 150 m
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    pole.position.set(0, 1.2, -150);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshLambertMaterial({ color: 0xff4040, side: THREE.DoubleSide }));
    flag.position.set(0.45, 2.1, -150);
    const green = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.MeshLambertMaterial({ color: 0x86d06a }));
    green.rotation.x = -Math.PI / 2;
    green.position.set(0, 0.01, -150);
    this.scene.add(pole, flag, green);
  }

  setUnits(units) {
    this.units = units;
    this.markerGroup.clear();
    const step = units === 'yd' ? 50 * 0.9144 : 50;
    for (let i = 1; i <= 7; i++) {
      const d = i * step;
      const label = makeLabel(`${i * 50}${units === 'yd' ? 'y' : 'm'}`, '#ffffff');
      label.position.set(-26, 2.6, -d);
      const label2 = label.clone();
      label2.position.set(26, 2.6, -d);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(44, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(0, 0.03, -d);
      this.markerGroup.add(label, label2, bar);
    }
  }

  _buildBall() {
    // Visual radius exaggerated so the ball stays visible at distance.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    this.scene.add(this.ball);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(3 * 4000);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xffe066 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    const ring = (color) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      this.scene.add(r);
      return r;
    };
    this.landMarker = ring(0xffe066);
    this.restMarker = ring(0xff5c5c);
    this.restLabel = makeLabel('', '#fff');
    this.restLabel.visible = false;
    this.scene.add(this.restLabel);
    this.resetBall();
  }

  resetBall() {
    this.flight = null;
    this.ball.position.set(0, 0.1, 0);
    this.trailGeo.setDrawRange(0, 0);
    this.landMarker.visible = false;
    this.restMarker.visible = false;
    this.restLabel.visible = false;
    this.camPos.set(0, 1.7, 5.5);
    this.camTarget.set(0, 1.2, -60);
  }

  /** Play a simulated trajectory (from physics-engine simulateShot). */
  playShot(result, label = '') {
    this.resetBall();
    this.flight = { result, t: 0, idx: 0, label, done: false, landed: false };
    this.clock.getDelta();
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
    const dt = Math.min(0.05, this.clock.getDelta());
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    const f = this.flight;
    if (f && !f.done) {
      f.t += dt;
      const pts = f.result.points;
      while (f.idx < pts.length - 1 && pts[f.idx + 1].t <= f.t) {
        f.idx++;
        const p = toThree(pts[f.idx]);
        const n = this.trailGeo.drawRange.count;
        if (n < 4000) {
          this.trailPos.set([p.x, p.y + 0.05, p.z], n * 3);
          this.trailGeo.setDrawRange(0, n + 1);
          this.trailGeo.attributes.position.needsUpdate = true;
        }
        if (!f.landed && pts[f.idx].phase === 'contact') {
          f.landed = true;
          this.landMarker.position.set(p.x, 0.04, p.z);
          this.landMarker.visible = true;
        }
      }
      const a = pts[f.idx];
      const b = pts[Math.min(f.idx + 1, pts.length - 1)];
      const span = b.t - a.t;
      const k = span > 0 ? Math.min(1, (f.t - a.t) / span) : 1;
      const pos = toThree({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
      this.ball.position.set(pos.x, pos.y + 0.09, pos.z);
      if (f.idx >= pts.length - 1) {
        f.done = true;
        const rest = toThree(f.result.rest);
        this.restMarker.position.set(rest.x, 0.05, rest.z);
        this.restMarker.visible = true;
        this.restLabel.position.set(rest.x, 3.2, rest.z);
        this.restLabel.visible = !!f.label;
        if (f.label) {
          this.scene.remove(this.restLabel);
          this.restLabel = makeLabel(f.label, '#ffffff');
          this.restLabel.position.set(rest.x, 3.2, rest.z);
          this.scene.add(this.restLabel);
        }
        this.onShotDone?.(f.result);
      }
      // Camera: stay at the tee briefly, then chase from behind and above.
      const bp = this.ball.position;
      if (f.t > 0.5) {
        const back = Math.min(16, 6 + bp.y * 0.4);
        this.camPos.lerp(new THREE.Vector3(bp.x * 0.85, Math.max(2.2, bp.y * 0.7 + 3), bp.z + back + 4), 1 - Math.exp(-dt * 1.6));
      }
      this.camTarget.lerp(new THREE.Vector3(bp.x, bp.y * 0.6, bp.z - 8), 1 - Math.exp(-dt * 3));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }
}
