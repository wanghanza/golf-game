// Side panel with an immediate verdict for every swing attempt: launched or
// not, why, the numbers behind it (phases, sensor range use) and a tip.
// Also shows live rotation / acceleration bars against the sensor ranges.
import { h, $, esc } from '../util.js';
import { settings, saveSettings } from '../settings.js';

const DEG = 180 / Math.PI;
const G = 9.80665;
const ICON = { ok: '✓', warn: '!', bad: '✗', na: '·' };

export function createDiagPanel(root) {
  const el = h(`
    <aside class="diag">
      <button class="diag-toggle" data-diag="toggle">판정</button>
      <div class="diag-body">
        <div class="diag-live">
          <div class="diag-meter"><span>회전</span><i><b data-m="w"></b></i><em data-m="wv">–</em></div>
          <div class="diag-meter"><span>가속</span><i><b data-m="a"></b></i><em data-m="av">–</em></div>
        </div>
        <div class="diag-card" data-el="card"><div class="diag-title">스윙하면 결과가 여기에 표시됩니다</div></div>
        <div class="diag-cmp" data-el="cmp"></div>
        <ol class="diag-history" data-el="hist"></ol>
      </div>
    </aside>`);
  root.appendChild(el);
  const card = $(el, '[data-el=card]');
  const hist = $(el, '[data-el=hist]');
  const cmpEl = $(el, '[data-el=cmp]');
  let onCalibrate = null;
  cmpEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-diag=calibrate]') && onCalibrate) onCalibrate();
  });
  const history = [];
  let ranges = { gyro: null, accel: null };
  let peakW = 0;
  let peakA = 0;

  const setOpen = (open) => {
    el.classList.toggle('closed', !open);
    settings.diagPanel = open;
    saveSettings();
  };
  setOpen(settings.diagPanel !== false);
  $(el, '[data-diag=toggle]').addEventListener('click', () => setOpen(el.classList.contains('closed')));

  function bar(key, value, range, fmt) {
    const frac = range ? Math.min(1, value / range) : Math.min(1, value / (key === 'w' ? 35 : 80));
    const b = $(el, `[data-m=${key}]`);
    b.style.width = `${Math.round(frac * 100)}%`;
    b.className = frac >= 0.99 ? 'over' : frac > 0.85 ? 'near' : '';
    $(el, `[data-m=${key}v]`).textContent = fmt;
  }

  return {
    el,
    setRanges(r) {
      ranges = { gyro: r?.gyroRange ?? null, accel: r?.accelRange ?? null };
    },
    /** Every sensor sample: peak-hold (decaying) rotation and acceleration. */
    track(s) {
      const w = Math.hypot(s.gx, s.gy, s.gz);
      const a = Math.hypot(s.ax, s.ay, s.az);
      peakW = Math.max(peakW * 0.995, w);
      peakA = Math.max(peakA * 0.995, a);
    },
    render() {
      bar('w', peakW, ranges.gyro, `${Math.round(peakW * DEG)}°/s${ranges.gyro ? ` / ${Math.round(ranges.gyro * DEG)}` : ''}`);
      bar('a', peakA, ranges.accel, `${(peakA / G).toFixed(1)}g${ranges.accel ? ` / ${(ranges.accel / G).toFixed(0)}g` : ''}`);
    },
    /**
     * Shot vs a clean virtual swing: what cost distance or sent it sideways.
     * @param {Object} c  compareToIdeal() result
     * @param {Object} [opts] { fmtDist, calibrate: { omega, apply } }
     */
    showCompare(c, opts = {}) {
      const fd = opts.fmtDist ?? ((m) => `${m.toFixed(0)} m`);
      const side = (m) => (Math.abs(m) < 0.5 ? '0' : `${m > 0 ? 'R' : 'L'} ${fd(Math.abs(m))}`);
      const top = c.factors.filter((f) => f.hurts).slice(0, 3);
      // Most costly fault first, then the power note (if any).
      const tips = [...c.factors.filter((f) => f.hurts && f.advice), ...c.factors.filter((f) => !f.hurts && f.advice)].slice(0, 2);
      onCalibrate = opts.calibrate?.apply ?? null;
      cmpEl.innerHTML = `
        <div class="diag-cmp-h">가상 스윙(이상적) 대비</div>
        <div class="diag-cmp-sum">캐리 <b>${fd(c.actual.carry)}</b> <small>(이상 ${fd(c.ideal.carry)})</small> · 좌우 <b>${side(c.actual.lateral)}</b></div>
        ${top.length ? `<ul class="diag-rows">${top.map((f) => `<li class="bad"><i>✗</i><span>${esc(f.label)}</span><b>${f.dCarry < -3 ? `거리 ${fd(f.dCarry)}` : ''}${f.dCarry < -3 && Math.abs(f.dLateral) > 3 ? ' · ' : ''}${Math.abs(f.dLateral) > 3 ? `${side(f.dLateral)}` : ''}</b></li>`).join('')}</ul>` : '<div class="diag-tip">가상 스윙과 거의 같은 샷입니다 👍</div>'}
        ${tips.map((f) => `<div class="diag-tip">💡 ${esc(f.advice)}</div>`).join('')}
        ${opts.calibrate ? `<button class="diag-cal" data-diag="calibrate">내 스윙(${opts.calibrate.omega.toFixed(1)} rad/s)을 100% 기준으로</button>` : ''}`;
    },
    clearCompare() {
      cmpEl.innerHTML = '';
    },
    show(d) {
      cmpEl.innerHTML = '';
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      card.className = `diag-card ${d.ok ? 'ok' : 'bad'}`;
      card.innerHTML = `
        <div class="diag-title">${d.ok ? '✓' : '✗'} ${esc(d.title)} <small>${time}</small></div>
        ${d.detail ? `<div class="diag-detail">${esc(d.detail)}</div>` : ''}
        <ul class="diag-rows">${(d.ok ? d.rows.filter((r) => r.status === 'warn' || r.status === 'bad') : d.rows).map((r) => `<li class="${r.status}"><i>${ICON[r.status] ?? ''}</i><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`).join('')}</ul>
        ${d.tip ? `<div class="diag-tip">💡 ${esc(d.tip)}</div>` : ''}`;
      history.unshift({ time, ok: d.ok, text: d.ok ? d.title : d.detail || d.title });
      history.length = Math.min(history.length, 6);
      hist.innerHTML = history.slice(1).map((x) => `<li class="${x.ok ? 'ok' : 'bad'}">${x.time} ${x.ok ? '✓' : '✗'} ${esc(x.text)}</li>`).join('');
      if (el.classList.contains('closed')) {
        // Make a failure visible even when the panel is folded.
        el.classList.toggle('flash', !d.ok);
      }
    },
  };
}
