// Screen-golf style overlay for the course round: hole map with the aim line
// and landing ring, green slope map, ball-to-pin elevation profile, wind
// arrow, a floating distance/height label over the flag, the carry needed
// over a hazard and the current lie.
import { h, $, esc } from '../util.js';
import { fmtDist } from '../settings.js';
import { headingTo } from '../../../course-engine/src/terrain.js';

const SURF_RGB = {
  water: [38, 92, 150],
  green: [96, 200, 92],
  fairway: [84, 168, 70],
  tee: [100, 178, 80],
  bunker: [226, 210, 160],
  rough: [58, 122, 52],
  forest: [30, 70, 40],
};

const LIE_TEXT = {
  tee: ['Tee', '티'],
  fairway: ['Fairway', '페어웨이'],
  rough: ['Rough', '러프'],
  green: ['Green', '그린'],
  bunker: ['Bunker', '벙커'],
  forest: ['Forest', '숲'],
};

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export function createCourseHud(root) {
  const el = h(`
    <div class="chud">
      <div class="chud-map">
        <div class="chud-head"><span class="chud-wind"><i data-el="arrow">➤</i><b data-el="wind">–</b></span><span data-el="maptitle"></span></div>
        <div class="chud-carry" data-el="carry"></div>
        <div class="chud-green"><canvas data-el="green" width="180" height="96"></canvas><span data-el="greenlbl"></span></div>
        <div class="chud-hole"><canvas data-el="hole" width="180" height="210"></canvas></div>
        <div class="chud-prof"><canvas data-el="prof" width="180" height="36"></canvas><span data-el="proflbl"></span></div>
      </div>
      <div class="chud-flag" data-el="flag"><b data-el="fd"></b><span data-el="fh"></span></div>
      <div class="chud-lie" data-el="lie"><i></i><div><b data-el="lie1"></b><small data-el="lie2"></small></div></div>
    </div>`);
  root.appendChild(el);
  const holeCv = $(el, '[data-el=hole]');
  const greenCv = $(el, '[data-el=green]');
  const profCv = $(el, '[data-el=prof]');
  const flag = $(el, '[data-el=flag]');
  const carryEl = $(el, '[data-el=carry]');
  const lieEl = $(el, '[data-el=lie]');
  let course = null;
  let map = null; // { hole, img, toPx(x,z), angle }
  let greenImg = null;
  let job = 0;
  let last = null; // last state passed to update(), for redraws when a map finishes

  // ------------------------------------------------------------ hole map
  async function buildHoleMap(hole) {
    const my = ++job;
    // Rotate so the hole plays from the bottom (tee) to the top (green).
    const ang = (headingTo(hole.tee, hole.green) * Math.PI) / 180;
    const fx = Math.sin(ang);
    const fz = Math.cos(ang);
    const rx = fz;
    const rz = -fx;
    // Extent in the rotated frame.
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hole.path) {
      const u = (p.x - hole.tee.x) * rx + (p.z - hole.tee.z) * rz;
      const v = (p.x - hole.tee.x) * fx + (p.z - hole.tee.z) * fz;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    minV -= 25; maxV += 35; minU -= 45; maxU += 45;
    const W = holeCv.width;
    const H = holeCv.height;
    const scale = Math.max((maxU - minU) / W, (maxV - minV) / H);
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    const toWorld = (px, py) => {
      const u = cu + (px - W / 2) * scale;
      const v = cv - (py - H / 2) * scale;
      return { x: hole.tee.x + u * rx + v * fx, z: hole.tee.z + u * rz + v * fz };
    };
    const toPx = (x, z) => {
      const u = (x - hole.tee.x) * rx + (z - hole.tee.z) * rz;
      const v = (x - hole.tee.x) * fx + (z - hole.tee.z) * fz;
      return { x: W / 2 + (u - cu) / scale, y: H / 2 - (v - cv) / scale };
    };
    // Coarse sampling (cost: one terrain lookup per cell), then smooth upscale.
    const step = 2;
    const cw = Math.ceil(W / step);
    const ch = Math.ceil(H / step);
    const small = document.createElement('canvas');
    small.width = cw;
    small.height = ch;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(cw, ch);
    const heights = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const w = toWorld(i * step + step / 2, j * step + step / 2);
        const s = course.surfaceAt(w.x, w.z).name;
        heights[j * cw + i] = course.heightAt(w.x, w.z);
        const c = SURF_RGB[s] ?? SURF_RGB.rough;
        const k = (j * cw + i) * 4;
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = 255;
      }
      if (j % 20 === 0) {
        await yieldFrame();
        if (my !== job) return;
      }
    }
    // Hill shading from the light in the upper left.
    const cell = scale * step;
    for (let j = 1; j < ch - 1; j++) {
      for (let i = 1; i < cw - 1; i++) {
        const dx = (heights[j * cw + i + 1] - heights[j * cw + i - 1]) / (2 * cell);
        const dy = (heights[(j + 1) * cw + i] - heights[(j - 1) * cw + i]) / (2 * cell);
        const shade = Math.max(0.6, Math.min(1.25, 1 - 1.6 * (dx * 0.7 - dy * 0.7)));
        const k = (j * cw + i) * 4;
        if (img.data[k + 2] > 140 && img.data[k] < 60) continue; // water stays flat
        img.data[k] = Math.min(255, img.data[k] * shade);
        img.data[k + 1] = Math.min(255, img.data[k + 1] * shade);
        img.data[k + 2] = Math.min(255, img.data[k + 2] * shade);
      }
    }
    sctx.putImageData(img, 0, 0);
    if (my !== job) return;
    map = { hole, small, toPx, scale };
    buildGreenMap(hole);
    if (last && last.hole === hole) {
      drawHole(last);
      drawGreen(last);
    }
  }

  // ------------------------------------------------------------ green map
  function buildGreenMap(hole) {
    const W = greenCv.width;
    const H = greenCv.height;
    const r = hole.greenRadius + 5;
    const scale = (2 * r) / H; // metres per pixel
    const ang = (headingTo(hole.path[hole.path.length - 2], hole.green) * Math.PI) / 180;
    const fx = Math.sin(ang);
    const fz = Math.cos(ang);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const ctx = off.getContext('2d');
    const img = ctx.createImageData(W, H);
    const pinY = course.heightAt(hole.pin.x, hole.pin.z);
    const toWorld = (px, py) => {
      const u = (px - W / 2) * scale;
      const v = -(py - H / 2) * scale;
      return { x: hole.green.x + u * fz + v * fx, z: hole.green.z - u * fx + v * fz };
    };
    let lo = Infinity;
    let hi = -Infinity;
    const hs = new Float32Array(W * H);
    for (let j = 0; j < H; j += 2) {
      for (let i = 0; i < W; i += 2) {
        const w = toWorld(i, j);
        const y = course.heightAt(w.x, w.z) - pinY;
        hs[j * W + i] = y;
        if (Math.hypot(w.x - hole.green.x, w.z - hole.green.z) <= hole.greenRadius) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
    }
    const span = Math.max(0.15, Math.max(Math.abs(lo), Math.abs(hi)));
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const y = hs[(j & ~1) * W + (i & ~1)];
        const w = toWorld(i, j);
        const inGreen = Math.hypot(w.x - hole.green.x, w.z - hole.green.z) <= hole.greenRadius;
        const k = (j * W + i) * 4;
        let c;
        if (!inGreen) c = [40, 80, 50];
        else {
          // Blue = below the pin, green = level, yellow/red = above.
          const t = Math.max(-1, Math.min(1, y / span));
          c = t < 0 ? [Math.round(60 + 40 * (1 + t)), Math.round(120 + 90 * (1 + t)), Math.round(230 - 120 * (1 + t))] : [Math.round(100 + 150 * t), Math.round(210 - 40 * t), Math.round(110 - 80 * t)];
          // Contour lines every 5 cm.
          if (Math.abs(((y * 20) % 1 + 1) % 1 - 0.5) > 0.46) c = c.map((v) => v * 0.8);
        }
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (x, z) => {
      const dx = x - hole.green.x;
      const dz = z - hole.green.z;
      return { x: W / 2 + (dx * fz - dz * fx) / scale, y: H / 2 - (dx * fx + dz * fz) / scale };
    };
    greenImg = { off, toPx, range: span };
    $(el, '[data-el=greenlbl]').textContent = `높낮이 ±${(span * 100).toFixed(0)} cm`;
  }

  // ------------------------------------------------------------ drawing
  function drawHole(st) {
    const ctx = holeCv.getContext('2d');
    const W = holeCv.width;
    const H = holeCv.height;
    ctx.clearRect(0, 0, W, H);
    if (!map || map.hole !== st.hole) {
      ctx.fillStyle = 'rgba(20,40,30,0.8)';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.small, 0, 0, W, H);
    const P = map.toPx;
    // Aim line and landing ring.
    const b = P(st.ball.x, st.ball.z);
    const hd = (st.aim * Math.PI) / 180;
    const lx = st.ball.x + Math.sin(hd) * st.aimDistance;
    const lz = st.ball.z + Math.cos(hd) * st.aimDistance;
    const l = P(lx, lz);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(l.x, l.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(l.x, l.y, Math.max(4, 8 / map.scale), 0, Math.PI * 2);
    ctx.stroke();
    // Pin and ball.
    const p = P(st.pin.x, st.pin.z);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(p.x, p.y - 9, 6, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 0.5, p.y - 9, 1.5, 9);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawGreen(st) {
    const ctx = greenCv.getContext('2d');
    ctx.clearRect(0, 0, greenCv.width, greenCv.height);
    if (!greenImg || !map || map.hole !== st.hole) return;
    ctx.drawImage(greenImg.off, 0, 0);
    const p = greenImg.toPx(st.pin.x, st.pin.z);
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 0.5, p.y - 10, 1.5, 10);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(p.x + 1, p.y - 10, 7, 4);
    const b = greenImg.toPx(st.ball.x, st.ball.z);
    if (b.x > 0 && b.x < greenCv.width && b.y > 0 && b.y < greenCv.height) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  function drawProfile(st) {
    const ctx = profCv.getContext('2d');
    const W = profCv.width;
    const H = profCv.height;
    ctx.clearRect(0, 0, W, H);
    const n = 40;
    const ys = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      ys.push(course.heightAt(st.ball.x + (st.pin.x - st.ball.x) * t, st.ball.z + (st.pin.z - st.ball.z) * t));
    }
    const lo = Math.min(...ys) - 1;
    const hi = Math.max(...ys) + 1;
    const span = Math.max(4, hi - lo);
    ctx.beginPath();
    ctx.moveTo(0, H);
    ys.forEach((y, i) => ctx.lineTo((i / n) * W, H - 4 - ((y - lo) / span) * (H - 8)));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(120,200,110,0.55)';
    ctx.fill();
    const dh = ys[n] - ys[0];
    $(el, '[data-el=proflbl]').textContent = `높이 ${dh >= 0 ? '+' : ''}${dh.toFixed(1)} m`;
  }

  /** Distance along the aim to the far edge of water in the way, if any. */
  function hazardCarry(st) {
    if (st.club === 'putter') return null;
    const hd = (st.aim * Math.PI) / 180;
    const dx = Math.sin(hd);
    const dz = Math.cos(hd);
    const reach = st.aimDistance + 30;
    let first = null;
    let last = null;
    for (let t = 4; t <= reach; t += 2) {
      const s = course.surfaceAt(st.ball.x + dx * t, st.ball.z + dz * t).name;
      if (s === 'water') {
        if (first === null) first = t;
        last = t;
      } else if (last !== null && t - last > 6) break;
    }
    if (first === null || last > st.aimDistance + 20) return null;
    return { from: first, to: last + 2, dx, dz };
  }

  return {
    el,
    setCourse(c) {
      course = c;
      map = null;
      greenImg = null;
    },
    setHole(hole) {
      $(el, '[data-el=maptitle]').textContent = `${hole.number}H · Par ${hole.par}`;
      buildHoleMap(hole);
    },
    /**
     * @param {Object} st { hole, ball, pin, aim, aimDistance, club, wind:[x,y,z], lie }
     * @returns {Object|null} hazard carry { from, to, dx, dz } for the 3D line
     */
    update(st) {
      last = st;
      drawHole(st);
      drawGreen(st);
      drawProfile(st);
      const speed = Math.hypot(st.wind[0], st.wind[2]);
      // Arrow points where the wind blows, relative to the aim (up = target).
      const wdir = (Math.atan2(st.wind[0], st.wind[2]) * 180) / Math.PI;
      $(el, '[data-el=arrow]').style.transform = `rotate(${wdir - st.aim - 90}deg)`;
      $(el, '[data-el=wind]').textContent = `${speed.toFixed(1)} m/s`;
      const lie = st.lie?.name ?? 'tee';
      const nearGreen = Math.hypot(st.ball.x - st.hole.green.x, st.ball.z - st.hole.green.z) < st.hole.greenRadius + 25;
      const [en, ko] = LIE_TEXT[lie] ?? [lie, ''];
      $(el, '[data-el=lie1]').textContent = lie === 'bunker' && nearGreen ? 'Green Bunker' : en;
      $(el, '[data-el=lie2]').textContent = ko;
      lieEl.className = `chud-lie ${lie}`;
      const hz = hazardCarry(st);
      carryEl.innerHTML = hz ? `해저드 캐리 <b>${esc(fmtDist(hz.to))}</b>` : '';
      carryEl.classList.toggle('show', !!hz);
      return hz;
    },
    /** Floating label over the flag (screen position from the 3D view). */
    flagLabel(pos, dist, height) {
      if (!pos) {
        flag.classList.remove('show');
        return;
      }
      flag.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
      $(el, '[data-el=fd]').textContent = `거리 ${fmtDist(dist)}`;
      const ht = $(el, '[data-el=fh]');
      ht.textContent = `높이 ${height >= 0 ? '+' : ''}${height.toFixed(2)} m`;
      ht.className = height >= 0 ? 'up' : 'down';
      flag.classList.add('show');
    },
    setVisible(v) {
      el.classList.toggle('hide', !v);
    },
  };
}
