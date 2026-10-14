// Mode B: sensor analysis + developer data collection.
import { h, $, esc, fmt, newId } from '../util.js';
import { sensors } from '../sensors.js';
import { Chart } from '../ui/chart.js';
import { createAnalysisView } from '../ui/analysis-view.js';
import { analyzeSwing } from '../../../swing-engine/src/analyze.js';
import { SwingDetector } from '../../../swing-engine/src/realtime.js';
import { toCSV, makeMetadata, SWING_LABELS } from '../../../swing-engine/src/recording.js';
import { recordings } from '../storage.js';
import { settings, saveSettings } from '../settings.js';
import { saveFiles, deviceInfo, keepScreenOn } from '../platform.js';

const TYPES = ['normal', 'draw', 'fade', 'slow', 'fast', 'incomplete', 'nonswing'];
const MAX_RECORD_SECONDS = 60;

export function createRecorderScreen(app) {
  const el = h(`
  <section class="screen" id="screen-recorder">
    <div class="topbar">
      <button data-act="back">← 메뉴</button>
      <span class="title">센서 분석 · 데이터 수집</span>
      <span class="pill" data-el="rate">센서 꺼짐</span>
    </div>
    <div class="page">
      <div class="side">
        <div class="card stack">
          <h3>기록 설정</h3>
          <label>참가자 ID (이름 대신 코드 사용)</label>
          <input type="text" data-el="pid" maxlength="24" />
          <label>스윙 유형 (의도 — 실제 구질 아님)</label>
          <select data-el="type">${TYPES.map((t) => `<option value="${t}">${SWING_LABELS[t]}</option>`).join('')}</select>
          <div class="row">
            <button data-act="sensor">센서 시작</button>
            <button class="primary" data-act="record" disabled>기록 시작</button>
          </div>
          <label><input type="checkbox" data-el="auto" /> 자동 스윙 감지 저장 (어드레스 정지 → 스윙 → 자동 저장)</label>
          <div class="muted" data-el="state">센서가 꺼져 있습니다</div>
          <div class="err" data-el="err"></div>
        </div>
        <div class="card stack">
          <h3>센서 정보</h3>
          <div class="muted" data-el="info">-</div>
        </div>
        <div class="card stack">
          <div class="row" style="justify-content:space-between"><h3 style="margin:0">저장된 기록</h3><span class="muted" data-el="count"></span></div>
          <div class="list" data-el="list"></div>
        </div>
      </div>
      <div class="main">
        <canvas class="chart" data-el="live-a"></canvas>
        <canvas class="chart" data-el="live-g"></canvas>
        <div data-el="analysis"></div>
      </div>
    </div>
  </section>`);

  const ratePill = $(el, '[data-el=rate]');
  const stateEl = $(el, '[data-el=state]');
  const errEl = $(el, '[data-el=err]');
  const listEl = $(el, '[data-el=list]');
  const recBtn = $(el, '[data-act=record]');
  const sensorBtn = $(el, '[data-act=sensor]');
  const autoEl = $(el, '[data-el=auto]');
  const pidEl = $(el, '[data-el=pid]');
  const typeEl = $(el, '[data-el=type]');
  const chartA = new Chart($(el, '[data-el=live-a]'), { title: '가속도', unit: 'm/s²' });
  const chartG = new Chart($(el, '[data-el=live-g]'), { title: '각속도', unit: 'rad/s' });
  const view = createAnalysisView();
  $(el, '[data-el=analysis]').appendChild(view.el);
  view.el.style.display = 'none';

  const live = [];
  let recording = null;
  let unsub = null;
  let drawTimer = null;
  let selectedId = null;

  const detector = new SwingDetector({
    onState: (s) => {
      if (autoEl.checked) stateEl.textContent = { waitStill: '자동: 어드레스 자세로 정지하세요', ready: '자동: 준비 완료, 스윙하세요', swinging: '자동: 스윙 기록 중…', cooldown: '자동: 저장 완료' }[s] ?? s;
    },
    onSwing: (r, windowSamples) => saveRecording(windowSamples, r),
  });

  function onSample(s) {
    live.push(s);
    while (live.length && live[0].t < s.t - 6) live.shift();
    if (recording) {
      recording.push(s);
      if (s.t - recording[0].t > MAX_RECORD_SECONDS) stopRecording();
    }
    if (autoEl.checked) detector.push(s);
  }

  function drawLive() {
    if (!live.length) return;
    const t1 = live[live.length - 1].t;
    const t = live.map((s) => s.t - t1);
    chartA.draw(t, [
      { name: 'ax', values: live.map((s) => s.ax) },
      { name: 'ay', values: live.map((s) => s.ay) },
      { name: 'az', values: live.map((s) => s.az) },
    ], { tRange: [-5, 0] });
    chartG.draw(t, [
      { name: 'gx', values: live.map((s) => s.gx) },
      { name: 'gy', values: live.map((s) => s.gy) },
      { name: 'gz', values: live.map((s) => s.gz) },
    ], { tRange: [-5, 0] });
    const hz = sensors.rateHz;
    ratePill.textContent = `실측 ${hz.toFixed(0)} Hz`;
    ratePill.className = `pill ${hz >= 90 ? 'ok' : hz > 0 ? 'warn' : 'bad'}`;
    if (recording) stateEl.textContent = `기록 중… ${recording.length} 샘플 (${(recording.at(-1).t - recording[0].t).toFixed(1)} s)`;
  }

  async function toggleSensor() {
    errEl.textContent = '';
    if (sensors.running) {
      stopRecording();
      sensors.stop();
      keepScreenOn(false);
      sensorBtn.textContent = '센서 시작';
      recBtn.disabled = true;
      stateEl.textContent = '센서가 꺼져 있습니다';
      ratePill.textContent = '센서 꺼짐';
      ratePill.className = 'pill';
      return;
    }
    const r = await sensors.start(settings.sensorRateHz);
    if (!r.ok) {
      errEl.textContent = r.error;
      return;
    }
    keepScreenOn(true);
    sensorBtn.textContent = '센서 중지';
    recBtn.disabled = false;
    stateEl.textContent = r.kind === 'native' ? '네이티브 센서 (안드로이드) 동작 중' : '브라우저 센서 동작 중 (정확도 제한)';
    renderInfo();
    if (autoEl.checked) detector.arm();
  }

  function renderInfo() {
    const info = sensors.info();
    if (!info) return;
    if (info.sensors) {
      $(el, '[data-el=info]').innerHTML = info.sensors
        .map((s) => `<div><b>${esc(s.type)}</b>: ${esc(s.name)} (${esc(s.vendor)})<br/>범위 ±${fmt(s.maxRange, 1)} · 분해능 ${fmt(s.resolution, 4)} · 최소주기 ${s.minDelayUs} µs</div>`)
        .join('') + (info.requestedPeriodUs ? `<div>요청 주기 ${info.requestedPeriodUs} µs</div>` : '');
    } else {
      $(el, '[data-el=info]').textContent = info.note || JSON.stringify(info);
    }
  }

  function startRecording() {
    recording = [];
    recBtn.textContent = '기록 중지';
    recBtn.classList.remove('primary');
    recBtn.classList.add('danger');
  }

  function stopRecording() {
    if (!recording) return;
    const samples = recording;
    recording = null;
    recBtn.textContent = '기록 시작';
    recBtn.classList.add('primary');
    recBtn.classList.remove('danger');
    if (samples.length < 20) {
      stateEl.textContent = '기록이 너무 짧습니다';
      return;
    }
    saveRecording(samples, analyzeSwing(samples));
  }

  async function saveRecording(rawSamples, analysis) {
    const t0 = rawSamples[0].t;
    const samples = rawSamples.map((s) => ({ ...s, t: s.t - t0 }));
    // Re-run analysis on the zero-based copy so phase times match the file.
    const result = analyzeSwing(samples);
    const info = sensors.info();
    const meta = makeMetadata({
      id: newId(),
      participantId: pidEl.value.trim() || 'anonymous',
      swingType: typeEl.value,
      samples,
      analysis: result,
      device: { ...deviceInfo(), sensors: info?.sensors ?? null, source: sensors.kind },
    });
    try {
      await recordings.put({ id: meta.id, meta, samples });
      stateEl.textContent = `저장됨: ${meta.id} (${result.valid ? '유효 스윙' : '스윙 아님/무효'})`;
    } catch (e) {
      errEl.textContent = `저장 실패: ${e}`;
    }
    void analysis;
    selectedId = meta.id;
    showAnalysis({ meta, samples }, result);
    refreshList();
  }

  function showAnalysis(rec, result = analyzeSwing(rec.samples)) {
    view.el.style.display = '';
    view.show(result, rec.meta.id, `${rec.meta.swingTypeLabel} · ${rec.meta.sampleCount} 샘플 · ${fmt(rec.meta.measuredRateHz, 0)} Hz · ${rec.meta.participantId}`);
    return result;
  }

  async function refreshList() {
    const all = await recordings.list();
    $(el, '[data-el=count]').textContent = `${all.length}개`;
    listEl.innerHTML = all.length
      ? all.map((r) => `
        <div class="item ${r.id === selectedId ? 'sel' : ''}" data-id="${esc(r.id)}">
          <div class="grow">
            <div class="name">${esc(r.meta.swingTypeLabel)} · ${esc(r.meta.participantId)}</div>
            <div class="meta">${esc(r.meta.createdAt.slice(0, 19).replace('T', ' '))} · ${r.meta.sampleCount}샘플 ·
              ${r.meta.analysis?.valid ? '<span class="badge ok">유효</span>' : '<span class="badge bad">무효</span>'}</div>
          </div>
          <button data-rec="view">보기</button>
          <button data-rec="export">내보내기</button>
          <button data-rec="play">발사</button>
          <button data-rec="del" class="danger">삭제</button>
        </div>`).join('')
      : '<div class="muted">아직 기록이 없습니다</div>';
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-rec]');
    const item = e.target.closest('[data-id]');
    if (!btn || !item) return;
    const all = await recordings.list();
    const rec = all.find((r) => r.id === item.dataset.id);
    if (!rec) return;
    const act = btn.dataset.rec;
    if (act === 'view') {
      selectedId = rec.id;
      showAnalysis(rec);
      refreshList();
    } else if (act === 'export') {
      try {
        const where = await saveFiles([
          { name: `${rec.id}.csv`, mime: 'text/csv', content: toCSV(rec.samples) },
          { name: `${rec.id}.json`, mime: 'application/json', content: JSON.stringify(rec.meta, null, 2) },
        ], { share: true });
        stateEl.textContent = `내보냄: ${where}`;
      } catch (err) {
        errEl.textContent = `내보내기 실패: ${err.message ?? err}`;
      }
    } else if (act === 'play') {
      const result = analyzeSwing(rec.samples);
      app.show('game', { replay: { result, label: `저장 기록 ${rec.id}` } });
    } else if (act === 'del') {
      if (confirm(`${rec.id} 기록을 삭제할까요?`)) {
        await recordings.remove(rec.id);
        refreshList();
      }
    }
  });

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') app.show('home');
    if (act === 'sensor') toggleSensor();
    if (act === 'record') (recording ? stopRecording() : startRecording());
  });
  autoEl.addEventListener('change', () => {
    if (autoEl.checked && sensors.running) detector.arm();
    else detector.disarm();
  });
  pidEl.addEventListener('change', () => {
    settings.participantId = pidEl.value.trim();
    saveSettings();
  });

  return {
    el,
    enter() {
      pidEl.value = settings.participantId;
      unsub = sensors.onSample(onSample);
      drawTimer = setInterval(drawLive, 66);
      refreshList();
    },
    leave() {
      stopRecording();
      detector.disarm();
      sensors.stop();
      keepScreenOn(false);
      sensorBtn.textContent = '센서 시작';
      recBtn.disabled = true;
      unsub?.();
      clearInterval(drawTimer);
    },
  };
}
