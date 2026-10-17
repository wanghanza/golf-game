// Mode A: swing game.
import { h, $, fmt, tag, esc } from '../util.js';
import { RangeScene } from '../game/scene.js';
import { sensors } from '../sensors.js';
import { REASON_TEXT } from '../../../swing-engine/src/analyze.js';
import { generateSwing } from '../../../data-tools/src/synth.js';
import { analyzeSwing } from '../../../swing-engine/src/analyze.js';
import { CLUBS, CLUB_ORDER } from '../../../physics-engine/src/clubs.js';
import { settings, saveSettings, fmtDist } from '../settings.js';
import { shotFromAnalysis, wristText } from '../shot.js';
import { cues, unlockAudio } from '../cues.js';
import { createSwingInput, STATE_TEXT } from '../ui/swing-input.js';

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
  </section>`);

  const status = $(el, '[data-el=status]');
  const result = $(el, '[data-el=result]');
  const sensorPill = $(el, '[data-el=sensor]');
  const banner = $(el, '[data-el=banner]');
  const clubSel = $(el, '[data-act=club]');
  const armBtn = $(el, '[data-act=arm]');
  let scene = null;
  let pillTimer = null;

  const setStatus = (main, sub = '') => {
    status.innerHTML = `${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  };

  const input = createSwingInput(el, {
    setStatus,
    getClub: () => settings.club,
    canArm: () => {
      if (settings.safetyAccepted) return true;
      app.show('safety', { next: 'game' });
      return false;
    },
    onResult: (r, info) => handleResult(r, null, info),
  });
  input.onState((s) => {
    armBtn.textContent = s === 'idle' ? '스윙 준비' : '중지';
  });

  function handleResult(r, label, info = {}) {
    if (!r.valid) {
      setStatus('발사하지 않음', REASON_TEXT[r.reason] ?? r.reason);
      return;
    }
    const { shot, flight, features } = shotFromAnalysis(r, settings.club);
    // Live swings already heard the contact; replays hear it at launch.
    if (!info.impactPlayed) cues.impact({ club: settings.club, power: shot.delivery.power, quality: shot.delivery.strikeQuality });
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
      ${D.wrist ? `<div class="muted">손목: ${esc(wristText(D.wrist, D.faceAngle))} (게임 모델 추정)</div>` : ''}
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
        <span class="k">래그 유지율</span><span class="v">${fmt((f.lagRetention ?? 0) * 100, 0)}%</span>${tag('derived')}
        <span class="k">릴리스 시점</span><span class="v">임팩트 ${fmt(Math.abs(f.releaseTimingMs ?? 0), 0)} ms ${(f.releaseTimingMs ?? 0) <= 0 ? '전' : '후'}</span>${tag('derived')}
        <span class="k">전완 회전 속도 (참고)</span><span class="v">${fmt(f.forearmRollRate)} rad/s</span>${tag('derived')}
        <span class="k">템포 (백:다운)</span><span class="v">${fmt(f.tempoRatio)} : 1</span>${tag('derived')}
        <span class="k">백스윙 회전각</span><span class="v">${fmt(f.backswingAngle, 0)}°</span>${tag('derived')}
        <span class="k">스윙 완성도</span><span class="v">${fmt(f.qualityScore * 100, 0)}점</span>${tag('estimated')}
        <span class="k">샘플링</span><span class="v">${fmt(f.sampleRateHz, 0)} Hz</span>${tag('measured')}
      </div>
      <div class="legend">측정 = 센서 원값 · 측정유래 = 센서값을 계산한 값 · 추정 = 가상 클럽/물리 모델 결과 (실제 공·클럽을 측정한 값이 아님)</div>`;
    result.classList.add('show');
  }

  async function arm() {
    if (input.active) {
      input.stop();
      return;
    }
    const r = await input.start();
    if (r.blocked) return;
    if (!r.ok) {
      setStatus('센서를 사용할 수 없습니다', `${r.error} — "샘플 스윙"으로 테스트할 수 있습니다`);
      return;
    }
    result.classList.remove('show');
    banner.classList.remove('show');
    scene.resetBall();
  }

  let sampleSeed = 1;
  function sampleSwing() {
    unlockAudio();
    const types = ['normal', 'draw', 'fade', 'cast', 'half', 'fast'];
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
    if (input.active) input.configure(); // club-specific address lean / impact
  });
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
      input.enter();
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
      input.leave();
      clearInterval(pillTimer);
      scene?.stop();
    },
  };
}
