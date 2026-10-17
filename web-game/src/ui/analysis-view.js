// Analysis result view: phase-shaded charts + feature table with provenance tags.
import { h, $, fmt, tag, esc } from '../util.js';
import { Chart } from './chart.js';
import { REASON_TEXT } from '../../../swing-engine/src/analyze.js';

const FEATURE_ORDER = [
  ['sampleRateHz', '샘플링 속도', 0],
  ['peakOmega', '최대 각속도 (크기)', 2],
  ['peakAccel', '최대 가속도 (크기)', 1],
  ['peakOmegaInPlane', '스윙 평면 최대 각속도', 2],
  ['omegaAtImpact', '임팩트 시 각속도', 2],
  ['backswingDuration', '백스윙 시간', 3],
  ['downswingDuration', '다운스윙 시간', 3],
  ['tempoRatio', '템포 (백:다운)', 2],
  ['backswingAngle', '백스윙 회전각', 0],
  ['followThroughAngle', '팔로스루 회전각', 0],
  ['planeTilt', '스윙 평면 기울기', 0],
  ['impactTime', '가상 임팩트 시각', 3],
  ['handSpeed', '손 속도', 2],
  ['lagRetention', '래그 유지율 (임팩트/최대 각속도)', 3],
  ['releaseTimingMs', '릴리스 시점 (최대 각속도-임팩트)', 0],
  ['forearmRollRate', '전완 회전 속도 (+ = 페이스 닫힘)', 2],
  ['faceRollDeg', '페이스 회전 추정', 1],
  ['planeShiftDeg', '경로 변화 추정', 1],
  ['qualityScore', '스윙 완성도', 2],
];

export function createAnalysisView() {
  const el = h(`
    <div class="stack">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h3 data-el="title" style="margin:0">분석 결과</h3>
          <span data-el="verdict"></span>
        </div>
        <div class="muted" data-el="sub"></div>
      </div>
      <canvas class="chart tall" data-el="c1"></canvas>
      <canvas class="chart" data-el="c2"></canvas>
      <div class="card"><div class="kv" data-el="kv"></div>
        <div class="legend">측정 = 센서 원값 · 측정유래 = 센서값을 결정적으로 계산 · 추정 = 모델 가정 포함 (실측 아님)</div>
      </div>
    </div>`);
  const c1 = new Chart($(el, '[data-el=c1]'), { title: '스윙 평면 회전각', unit: 'deg' });
  const c2 = new Chart($(el, '[data-el=c2]'), { title: '각속도', unit: 'rad/s' });

  return {
    el,
    show(result, title = '분석 결과', subtitle = '') {
      $(el, '[data-el=title]').textContent = title;
      $(el, '[data-el=sub]').textContent = subtitle;
      $(el, '[data-el=verdict]').innerHTML = result.valid
        ? '<span class="badge ok">유효한 스윙</span>'
        : `<span class="badge bad">${esc(REASON_TEXT[result.reason] ?? result.reason)}</span>`;
      const s = result.signals;
      if (s) {
        requestAnimationFrame(() => {
          c1.draw(s.t, [{ name: 'θ', values: s.thetaDeg, color: '#79c0ff' }], { phases: result.phases });
          c2.draw(s.t, [
            { name: '|ω|', values: s.wmag, color: '#ffa657' },
            { name: 'ω 평면', values: s.wp, color: '#7ee787' },
          ], { phases: result.phases });
        });
      }
      const f = result.features || {};
      $(el, '[data-el=kv]').innerHTML = FEATURE_ORDER.filter(([k]) => f[k])
        .map(([k, label, d]) => `<span class="k">${label}</span><span class="v">${fmt(f[k].value, d)} ${esc(f[k].unit)}</span>${tag(f[k].source)}`)
        .join('') || '<span class="muted">특징값 없음 (스윙 구간을 찾지 못함)</span>';
    },
  };
}
