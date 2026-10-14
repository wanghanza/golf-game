// Mode A: swing game.
import { h, $, fmt, tag, esc } from '../util.js';
import { RangeScene } from '../game/scene.js';
import { sensors } from '../sensors.js';
import { SwingDetector } from '../../../swing-engine/src/realtime.js';
import { REASON_TEXT } from '../../../swing-engine/src/analyze.js';
import { generateSwing } from '../../../data-tools/src/synth.js';
import { analyzeSwing } from '../../../swing-engine/src/analyze.js';
import { CLUBS, CLUB_ORDER } from '../../../physics-engine/src/clubs.js';
import { settings, saveSettings, fmtDist } from '../settings.js';
import { shotFromAnalysis } from '../shot.js';
import { vibrate, keepScreenOn } from '../platform.js';

const STATE_TEXT = {
  idle: ['스윙 준비를 누르세요', '휴대폰을 그립처럼 양손으로 잡고 손목 스트랩을 착용하세요'],
  waitStill: ['어드레스 자세로 멈추세요', '움직이지 않고 0.4초 정지하면 준비됩니다'],
  ready: ['준비 완료 — 스윙하세요', '작고 부드러운 스윙으로도 충분합니다'],
  swinging: ['스윙 감지 중…', ''],
  cooldown: ['분석 완료', ''],
};

export function createGameScreen(app) {
  const el = h(`
  <section class="screen" id="screen-game">
    <div id="game-canvas-host"></div>
    <div class="topbar">
      <button data-act="back">← 메뉴</button>
      <span class="title">스윙 게임</span>
      <select data-act="club">${CLUB_ORDER.map((k) => `<option value="${k}">${CLUBS[k].label}</option>`).join('')}</select>
      <span class="pill" data-el="sensor">센서 꺼짐</span>
    </div>
    <div class="game-status" data-el="status"></div>
    <div class="sim-banner" data-el="banner"></div>
    <div class="game-actions">
      <button class="primary" data-act="arm">스윙 준비</button>
      <button data-act="sample">샘플 스윙 (가상)</button>
      <button data-act="reset">공 다시 놓기</button>
    </div>
    <div class="result" data-el="result"></div>
    <div class="touch-lock" data-el="lock"><button class="unlock" data-act="unlock">길게 눌러 잠금 해제</button></div>
  </section>`);

  const status = $(el, '[data-el=status]');
  const result = $(el, '[data-el=result]');
  const lock = $(el, '[data-el=lock]');
  const sensorPill = $(el, '[data-el=sensor]');
  const banner = $(el, '[data-el=banner]');
  const clubSel = $(el, '[data-act=club]');
  const armBtn = $(el, '[data-act=arm]');
  let scene = null;
  let unsub = null;
  let pillTimer = null;

  const setStatus = (main, sub = '') => {
    status.innerHTML = `${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  };

  const detector = new SwingDetector({
    onState: (s) => {
      const [a, b] = STATE_TEXT[s] ?? [s, ''];
      if (s !== 'cooldown') setStatus(a, b);
      if (s === 'ready') vibrate(30);
      lock.classList.toggle('on', s === 'waitStill' || s === 'ready' || s === 'swinging');
    },
    onSwing: (r) => handleResult(r, null),
  });

  function handleResult(r, label) {
    if (!r.valid) {
      setStatus('발사하지 않음', REASON_TEXT[r.reason] ?? r.reason);
      vibrate(120);
      return;
    }
    const { shot, flight, features } = shotFromAnalysis(r, settings.club);
    banner.textContent = label ? `시뮬레이션 재생: ${label} (실측 아님)` : '';
    banner.classList.toggle('show', !!label);
    setStatus(shot.shape.label, `${CLUBS[shot.club].label} · 파워 ${(shot.delivery.power * 100).toFixed(0)}%`);
    scene.playShot(flight, fmtDist(flight.total));
    renderResult(shot, flight, r, features);
  }

  function renderResult(shot, flight, r, f) {
    const L = shot.launch;
    const D = shot.delivery;
    const side = flight.totalLateral;
    result.innerHTML = `
      <div class="shape">${esc(shot.shape.label)}</div>
      <div class="big">
        <div>캐리<b>${fmtDist(flight.carry)}</b></div>
        <div>총거리<b>${fmtDist(flight.total)}</b></div>
        <div>좌우<b>${side >= 0 ? 'R' : 'L'} ${fmtDist(Math.abs(side))}</b></div>
      </div>
      <div class="kv">
        <span class="k">최고 높이</span><span class="v">${fmtDist(flight.apex)}</span>${tag('estimated')}
        <span class="k">볼 스피드</span><span class="v">${fmt(L.ballSpeed)} m/s</span>${tag('estimated')}
        <span class="k">발사각</span><span class="v">${fmt(L.launchAngle)}°</span>${tag('estimated')}
        <span class="k">출발 방향</span><span class="v">${fmt(L.launchDirection)}°</span>${tag('estimated')}
        <span class="k">스핀 / 스핀축</span><span class="v">${fmt(L.spinRate, 0)} rpm / ${fmt(L.spinAxis)}°</span>${tag('estimated')}
        <span class="k">가상 클럽 스피드</span><span class="v">${fmt(D.clubSpeed)} m/s</span>${tag('estimated')}
        <span class="k">페이스 / 경로</span><span class="v">${fmt(D.faceAngle)}° / ${fmt(D.clubPath)}°</span>${tag('estimated')}
        <span class="k">휴대폰 최대 각속도</span><span class="v">${fmt(f.peakOmegaInPlane)} rad/s</span>${tag('derived')}
        <span class="k">템포 (백:다운)</span><span class="v">${fmt(f.tempoRatio)} : 1</span>${tag('derived')}
        <span class="k">백스윙 회전각</span><span class="v">${fmt(f.backswingAngle, 0)}°</span>${tag('derived')}
        <span class="k">스윙 완성도</span><span class="v">${fmt(f.qualityScore * 100, 0)}점</span>${tag('estimated')}
        <span class="k">샘플링</span><span class="v">${fmt(f.sampleRateHz, 0)} Hz</span>${tag('measured')}
      </div>
      <div class="legend">측정 = 센서 원값 · 측정유래 = 센서값을 계산한 값 · 추정 = 가상 클럽/물리 모델 결과 (실제 공·클럽을 측정한 값이 아님)</div>`;
    result.classList.add('show');
  }

  async function arm() {
    if (detector.state !== 'idle') {
      detector.disarm();
      sensors.stop();
      keepScreenOn(false);
      armBtn.textContent = '스윙 준비';
      lock.classList.remove('on');
      setStatus(...STATE_TEXT.idle);
      return;
    }
    if (!settings.safetyAccepted) {
      app.show('safety', { next: 'game' });
      return;
    }
    const r = await sensors.start(settings.sensorRateHz);
    if (!r.ok) {
      setStatus('센서를 사용할 수 없습니다', `${r.error} — "샘플 스윙"으로 테스트할 수 있습니다`);
      return;
    }
    keepScreenOn(true);
    result.classList.remove('show');
    banner.classList.remove('show');
    scene.resetBall();
    armBtn.textContent = '중지';
    detector.analysis = sensors.analysisOptions();
    detector.arm();
  }

  let sampleSeed = 1;
  function sampleSwing() {
    const types = ['normal', 'draw', 'fade', 'half', 'fast'];
    const type = types[(sampleSeed - 1) % types.length];
    const { samples, meta } = generateSwing({ type, seed: sampleSeed++ });
    handleResult(analyzeSwing(samples), `합성 데이터 · ${meta.swingTypeLabel}`);
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') app.show('home');
    if (act === 'arm') arm();
    if (act === 'sample') sampleSwing();
    if (act === 'reset') {
      scene.resetBall();
      result.classList.remove('show');
      banner.classList.remove('show');
    }
  });
  clubSel.addEventListener('change', () => {
    settings.club = clubSel.value;
    saveSettings();
  });
  // Long-press to unlock touches while armed.
  let pressTimer = null;
  const unlockBtn = $(el, '[data-act=unlock]');
  unlockBtn.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(() => {
      lock.classList.remove('on');
      detector.disarm();
      sensors.stop();
      armBtn.textContent = '스윙 준비';
      setStatus(...STATE_TEXT.idle);
    }, 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => unlockBtn.addEventListener(ev, () => clearTimeout(pressTimer)));

  return {
    el,
    enter(params = {}) {
      document.body.classList.add('wants-landscape');
      if (!scene) {
        scene = new RangeScene($(el, '#game-canvas-host'));
      }
      scene.setUnits(settings.units);
      scene.start();
      clubSel.value = settings.club;
      setStatus(...STATE_TEXT.idle);
      unsub = sensors.onSample((s) => detector.push(s));
      pillTimer = setInterval(() => {
        if (sensors.running) {
          const hz = sensors.rateHz;
          sensorPill.textContent = `센서 ${hz.toFixed(0)} Hz`;
          sensorPill.className = `pill ${hz >= 90 ? 'ok' : hz > 0 ? 'warn' : 'bad'}`;
        } else {
          sensorPill.textContent = '센서 꺼짐';
          sensorPill.className = 'pill';
        }
      }, 500);
      if (params.replay) {
        handleResult(params.replay.result, params.replay.label);
      }
    },
    leave() {
      document.body.classList.remove('wants-landscape');
      detector.disarm();
      sensors.stop();
      keepScreenOn(false);
      armBtn.textContent = '스윙 준비';
      lock.classList.remove('on');
      unsub?.();
      clearInterval(pillTimer);
      scene?.stop();
    },
  };
}
