// Minimal canvas time-series chart with optional phase shading.

const COLORS = ['#ff7b72', '#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#f2cc60'];
const PHASE_COLORS = {
  address: 'rgba(121,192,255,0.12)',
  backswing: 'rgba(210,168,255,0.14)',
  downswing: 'rgba(255,166,87,0.16)',
  finish: 'rgba(126,231,135,0.12)',
};
const PHASE_LABELS = { address: '어드레스', backswing: '백스윙', downswing: '다운스윙', finish: '피니시' };

export class Chart {
  constructor(canvas, { title = '', unit = '' } = {}) {
    this.canvas = canvas;
    this.title = title;
    this.unit = unit;
  }

  _prep() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 600;
    const h = c.clientHeight || 190;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  /**
   * @param {number[]} t
   * @param {{name: string, values: number[]}[]} series
   * @param {Object} [opts] { phases, impact, tRange: [t0, t1] }
   */
  draw(t, series, opts = {}) {
    const { g, w, h } = this._prep();
    const pad = { l: 40, r: 8, t: 18, b: 18 };
    const t0 = opts.tRange ? opts.tRange[0] : t[0] ?? 0;
    const t1 = opts.tRange ? opts.tRange[1] : t[t.length - 1] ?? 1;
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.values) {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const span = hi - lo;
    lo -= span * 0.05;
    hi += span * 0.05;
    const X = (x) => pad.l + ((x - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo)) * (h - pad.t - pad.b);

    if (opts.phases) {
      g.font = '10px system-ui';
      for (const [k, col] of Object.entries(PHASE_COLORS)) {
        const p = opts.phases[k];
        if (!p) continue;
        g.fillStyle = col;
        g.fillRect(X(p[0]), pad.t, Math.max(1, X(p[1]) - X(p[0])), h - pad.t - pad.b);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillText(PHASE_LABELS[k], X(p[0]) + 2, h - 5);
      }
      if (Number.isFinite(opts.phases.impact)) {
        g.strokeStyle = '#ffe066';
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(X(opts.phases.impact), pad.t);
        g.lineTo(X(opts.phases.impact), h - pad.b);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#ffe066';
        g.fillText('가상 임팩트', X(opts.phases.impact) + 3, pad.t + 10);
      }
    }

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '10px system-ui';
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      g.beginPath();
      g.moveTo(pad.l, Y(v));
      g.lineTo(w - pad.r, Y(v));
      g.stroke();
      g.fillText(v.toFixed(Math.abs(hi - lo) < 10 ? 1 : 0), 2, Y(v) + 3);
    }
    if (lo < 0 && hi > 0) {
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.moveTo(pad.l, Y(0));
      g.lineTo(w - pad.r, Y(0));
      g.stroke();
    }

    series.forEach((s, si) => {
      g.strokeStyle = s.color || COLORS[si % COLORS.length];
      g.lineWidth = 1.5;
      g.beginPath();
      let started = false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] < t0 || t[i] > t1 || !Number.isFinite(s.values[i])) continue;
        const x = X(t[i]);
        const y = Y(s.values[i]);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.stroke();
    });

    g.font = '11px system-ui';
    let lx = pad.l + 4;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(`${this.title}${this.unit ? ` [${this.unit}]` : ''}`, lx, 12);
    lx += g.measureText(`${this.title} [${this.unit}]`).width + 12;
    series.forEach((s, si) => {
      g.fillStyle = s.color || COLORS[si % COLORS.length];
      g.fillText(s.name, lx, 12);
      lx += g.measureText(s.name).width + 10;
    });
  }
}
