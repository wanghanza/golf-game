// Mode C: replay stored or synthetic sensor data through the full pipeline.
import { h, $, esc, fmt } from '../util.js';
import { createAnalysisView } from '../ui/analysis-view.js';
import { analyzeSwing } from '../../../swing-engine/src/analyze.js';
import { fromCSV } from '../../../swing-engine/src/recording.js';
import { generateSwing, SWING_TYPES } from '../../../data-tools/src/synth.js';
import { recordings } from '../storage.js';
import { shotFromAnalysis } from '../shot.js';
import { settings, fmtDist } from '../settings.js';

export function createSimulateScreen(app) {
  const el = h(`
  <section class="screen" id="screen-simulate">
    <div class="topbar">
      <button data-act="back">← 메뉴</button>
      <span class="title">시뮬레이션 테스트 (저장 데이터 재생)</span>
    </div>
    <div class="page">
      <div class="side">
        <div class="card stack">
          <h3>합성 스윙 <span class="badge syn">가상 데이터</span></h3>
          <div class="muted">실제 측정값이 아닌, 물리 모델로 만든 테스트용 센서 데이터입니다.</div>
          <div class="row"><label style="flex:0 0 auto">시드</label><input type="number" data-el="seed" value="1" min="1" max="9999" style="width:90px;flex:0 0 auto"/></div>
          <div class="list" data-el="synth"></div>
        </div>
        <div class="card stack">
          <h3>파일 불러오기 (CSV)</h3>
          <input type="file" accept=".csv,text/csv" data-el="file" />
          <div class="err" data-el="ferr"></div>
        </div>
        <div class="card stack">
          <h3>저장된 기록</h3>
          <div class="list" data-el="saved"></div>
        </div>
      </div>
      <div class="main">
        <div class="card row" data-el="actions" style="display:none">
          <div class="grow" data-el="preview"></div>
          <button class="primary" data-act="launch" style="flex:0 0 auto">3D로 발사</button>
        </div>
        <div data-el="view"></div>
        <div class="muted" data-el="hint">왼쪽에서 데이터를 선택하면 스윙 구간 판정과 예상 탄도를 보여 줍니다.</div>
      </div>
    </div>
  </section>`);

  const view = createAnalysisView();
  $(el, '[data-el=view]').appendChild(view.el);
  view.el.style.display = 'none';
  let current = null;

  $(el, '[data-el=synth]').innerHTML = Object.entries(SWING_TYPES)
    .map(([k, v]) => `<div class="item" data-type="${k}"><div class="grow"><div class="name">${esc(v.label)}</div></div><button>선택</button></div>`)
    .join('');

  function select(samples, label) {
    const result = analyzeSwing(samples);
    current = { result, label };
    view.el.style.display = '';
    $(el, '[data-el=hint]').style.display = 'none';
    view.show(result, label, `${samples.length} 샘플`);
    const actions = $(el, '[data-el=actions]');
    actions.style.display = '';
    if (result.valid) {
      const { shot, flight } = shotFromAnalysis(result, settings.club);
      $(el, '[data-el=preview]').innerHTML = `<b>${esc(shot.shape.label)}</b> · 캐리 ${fmtDist(flight.carry)} · 총 ${fmtDist(flight.total)} · 볼스피드 ${fmt(shot.launch.ballSpeed)} m/s <span class="tag estimated">추정</span>`;
      $(el, '[data-act=launch]').disabled = false;
    } else {
      $(el, '[data-el=preview]').textContent = '유효한 스윙이 아니므로 발사하지 않습니다 (판정 결과 확인용).';
      $(el, '[data-act=launch]').disabled = true;
    }
  }

  async function refreshSaved() {
    const all = await recordings.list();
    $(el, '[data-el=saved]').innerHTML = all.length
      ? all.map((r) => `<div class="item" data-id="${esc(r.id)}"><div class="grow"><div class="name">${esc(r.meta.swingTypeLabel)}</div><div class="meta">${esc(r.id)}</div></div><button>선택</button></div>`).join('')
      : '<div class="muted">센서 분석 화면에서 기록하면 여기에 표시됩니다</div>';
    return all;
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') app.show('home');
    if (act === 'launch' && current?.result.valid) app.show('game', { replay: current });
    const synth = e.target.closest('[data-type]');
    if (synth && e.target.tagName === 'BUTTON') {
      const seed = Number($(el, '[data-el=seed]').value) || 1;
      const { samples, meta } = generateSwing({ type: synth.dataset.type, seed });
      select(samples, `합성 · ${meta.swingTypeLabel} (seed ${seed})`);
    }
    const saved = e.target.closest('[data-id]');
    if (saved && e.target.tagName === 'BUTTON') {
      const all = await recordings.list();
      const rec = all.find((r) => r.id === saved.dataset.id);
      if (rec) select(rec.samples, `기록 · ${rec.id}`);
    }
  });

  $(el, '[data-el=file]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const ferr = $(el, '[data-el=ferr]');
    ferr.textContent = '';
    if (!file) return;
    try {
      const samples = fromCSV(await file.text());
      select(samples, `파일 · ${file.name}`);
    } catch (err) {
      ferr.textContent = `읽기 실패: ${err.message}`;
    }
  });

  return {
    el,
    enter() {
      refreshSaved();
    },
    leave() {},
  };
}
