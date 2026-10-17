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
        <ol class="diag-history" data-el="hist"></ol>
      </div>
    </aside>`);
  root.appendChild(el);
  const card = $(el, '[data-el=card]');
  const hist = $(el, '[data-el=hist]');
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
    show(d) {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      card.className = `diag-card ${d.ok ? 'ok' : 'bad'}`;
      card.innerHTML = `
        <div class="diag-title">${d.ok ? '✓' : '✗'} ${esc(d.title)} <small>${time}</small></div>
        ${d.detail ? `<div class="diag-detail">${esc(d.detail)}</div>` : ''}
        <ul class="diag-rows">${d.rows.map((r) => `<li class="${r.status}"><i>${ICON[r.status] ?? ''}</i><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`).join('')}</ul>
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
