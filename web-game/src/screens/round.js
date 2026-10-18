// Course round: 18 holes on one of the courses (course-engine/src/courses).
import { h, $, esc } from '../util.js';
import { sensors } from '../sensors.js';
import { REASON_TEXT } from '../../../swing-engine/src/analyze.js';
import { featureValues } from '../../../swing-engine/src/analyze.js';
import { CLUBS, CLUB_ORDER } from '../../../physics-engine/src/clubs.js';
import { swingToShot } from '../../../physics-engine/src/shot-model.js';
import { simulateShot } from '../../../physics-engine/src/flight.js';
import { createCourse, headingTo } from '../../../course-engine/src/terrain.js';
import { COURSES } from '../../../course-engine/src/courses/index.js';
import { Round, scoreName, PUTT_MAX_DISTANCE } from '../../../course-engine/src/round.js';
import { settings, saveSettings, fmtDist } from '../settings.js';
import { cues, unlockAudio } from '../cues.js';
import { swingFromFeatures, explainRealShot } from '../shot.js';
import { createSwingInput, STATE_TEXT } from '../ui/swing-input.js';
import { CourseScene } from '../course/scene.js';
import { createCourseHud } from '../course/hud.js';

// Putting: in-plane angular velocity (rad/s) that rolls the ball PUTT_MAX_DISTANCE.
const PUTT_FULL_OMEGA = 5;

const CLUB_LABEL = (k) => (k === 'putter' ? '퍼터' : CLUBS[k].label);

export function createRoundScreen(app) {
  const el = h(`
  <section class="screen" id="screen-round">
    <div id="round-canvas-host" style="position:absolute;inset:0"></div>
    <div class="topbar">
      <button data-act="back">← 메뉴</button>
      <span class="title" data-el="title">코스</span>
      <select data-act="club">${[...CLUB_ORDER, 'putter'].map((k) => `<option value="${k}">${CLUB_LABEL(k)}</option>`).join('')}</select>
      <span class="pill" data-el="sensor">센서 꺼짐</span>
    </div>
    <div class="hole-card" data-el="hole"></div>
    <div class="game-status" data-el="status"></div>
    <div class="toast" data-el="toast"></div>
    <div class="game-actions">
      <button class="primary" data-act="arm">스윙 준비</button>
      <button data-act="virtual">가상 스윙</button>
      <button data-act="card">스코어카드</button>
      <button data-act="preview">홀 보기</button>
    </div>
    <div class="aim-pad">
      <button data-act="left">◀</button>
      <span class="aim-read" data-el="aimread"></span>
      <button data-act="pin">핀</button>
      <button data-act="right">▶</button>
    </div>
    <div class="modal" data-el="modal"></div>
    <div class="loading" data-el="loading"><div><b data-el="load-title">코스</b><span data-el="load-text">코스를 준비하고 있습니다…</span><div class="cue-bar"><i data-el="load-bar"></i></div></div></div>
  </section>`);

  const status = $(el, '[data-el=status]');
  const holeCard = $(el, '[data-el=hole]');
  const toast = $(el, '[data-el=toast]');
  const modal = $(el, '[data-el=modal]');
  const clubSel = $(el, '[data-act=club]');
  const armBtn = $(el, '[data-act=arm]');
  const sensorPill = $(el, '[data-el=sensor]');
  const loading = $(el, '[data-el=loading]');
  let course = null;
  let scene = null;
  let round = null;
  const hud = createCourseHud(el);
  let club = 'driver';
  let aim = 0;
  let busy = false;
  let pillTimer = null;
  let toastTimer = null;

  const setStatus = (main, sub = '') => {
    status.innerHTML = `${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  };
  const showToast = (html, ms = 4000) => {
    toast.innerHTML = html;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  };

  const input = createSwingInput(el, {
    setStatus,
    getClub: () => club,
    canArm: () => {
      if (settings.safetyAccepted) return true;
      app.show('safety', { next: 'round' });
      return false;
    },
    onResult: (r, info) => handleSwing(r, info),
  });
  input.onState((s) => {
    armBtn.textContent = s === 'idle' ? '스윙 준비' : '중지';
  });

  function playsLike() {
    const pinY = course.heightAt(round.pin.x, round.pin.z);
    return round.distanceToPin + (pinY - round.ball.y);
  }

  function renderHud() {
    const hole = round.hole;
    const totals = round.totals();
    const toPar = totals.toPar === 0 ? 'E' : totals.toPar > 0 ? `+${totals.toPar}` : String(totals.toPar);
    holeCard.innerHTML = `
      <div class="hc-top"><span class="hc-no">${hole.number}</span><div><b>Par ${hole.par}</b> · ${fmtDist(hole.yardage)}<small>${esc(hole.name)}</small></div></div>
      <div class="hc-player"><span class="hc-name">PLAYER</span><span class="hc-score ${totals.toPar > 0 ? 'over' : totals.toPar < 0 ? 'under' : ''}">${toPar}</span></div>
      <div class="hc-row">핀까지 <b>${fmtDist(round.distanceToPin)}</b> <small>체감 ${fmtDist(playsLike())}</small> · ${round.strokes + 1}번째 샷</div>
      `;
    // Aim readout: offset from the pin line.
    const toPin = headingTo(round.ball, round.pin);
    const off = ((aim - toPin + 540) % 360) - 180;
    $(el, '[data-el=aimread]').innerHTML = Math.abs(off) < 0.5 ? '핀 방향<small>조준</small>' : `${off > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(off).toFixed(0)}°<small>핀 기준</small>`;
    hud.el.classList.toggle('near-green', round.distanceToPin < 60);
    const hz = hud.update({ hole, ball: round.ball, pin: round.pin, aim, aimDistance: aimDistance(), club, wind: round.wind(), lie: round.lie });
    scene.setHazardLine(hz, round.ball);
  }

  // Floating distance/height label over the flag while aiming.
  function onFrame() {
    if (!round || scene.mode !== 'aim' || busy) {
      hud.flagLabel(null);
      return;
    }
    const pin = round.pin;
    const py = course.heightAt(pin.x, pin.z);
    const pos = scene.project(pin.x, py + 2.6, pin.z);
    if (!pos || pos.x < 0 || pos.x > pos.w || pos.y < 0 || pos.y > pos.h) {
      hud.flagLabel(null);
      return;
    }
    hud.flagLabel(pos, round.distanceToPin, py - round.ball.y);
  }

  function aimDistance() {
    if (club === 'putter') return Math.max(1, round.distanceToPin);
    return Math.min(round.carries[club] ?? 150, round.distanceToPin + 5);
  }

  function updateAim() {
    scene.setAim(aim, aimDistance());
    renderHud();
  }

  function setClub(k, { auto = false } = {}) {
    club = k;
    clubSel.value = k;
    if (input.active) input.configure();
    if (auto) aim = club === 'putter' ? round.defaultAim() : round.defaultAim(club);
    updateAim();
  }

  function prepareShot({ flyover = false } = {}) {
    scene.setBall(round.ball);
    setClub(round.suggestClub(), { auto: true });
    setStatus(...STATE_TEXT.idle);
    if (flyover) {
      busy = true;
      scene.flyover(round.hole);
      scene.fly.onDone = () => {
        busy = false;
        scene.setAim(aim, aimDistance());
      };
    }
  }

  function startHole() {
    hud.setHole(round.hole);
    modal.classList.remove('show');
    showToast(`<b>${round.hole.number}번 홀 · 파${round.hole.par}</b><br>${esc(round.hole.name)} · ${fmtDist(round.hole.yardage)}`, 3500);
    prepareShot({ flyover: true });
  }

  function handleSwing(r, info = {}) {
    if (busy || !round || round.holed) return;
    if (!r.valid) {
      setStatus('발사하지 않음', REASON_TEXT[r.reason] ?? r.reason);
      return;
    }
    const f = featureValues(r);
    if (club === 'putter') {
      const strength = Math.max(0.02, f.peakOmegaInPlane / PUTT_FULL_OMEGA);
      if (!info.impactPlayed) cues.impact({ club: 'putter', power: 0.3 });
      execute(() => round.playPutt(strength, aim), `퍼팅 ${fmtDist(strength * PUTT_MAX_DISTANCE)} 세기`);
      return;
    }
    const swing = swingFromFeatures(f);
    const shot = swingToShot(swing, club, settings.game);
    explainRealShot(input, swing, club);
    if (!info.impactPlayed) cues.impact({ club, power: shot.delivery.power, quality: shot.delivery.strikeQuality });
    execute(() => round.playShot(shot.launch, aim), `${CLUB_LABEL(club)} · ${shot.shape.label} · 파워 ${(shot.delivery.power * 100).toFixed(0)}%`);
  }

  function execute(play, title) {
    busy = true;
    scene.setHazardLine(null);
    const entry = play();
    setStatus(title, '');
    scene.playShot(entry.result, () => afterShot(entry));
  }

  function afterShot(entry) {
    busy = false;
    const r = entry.result;
    const where = entry.penalty ? '' : ` · ${esc(course.surfaceAt(round.ball.x, round.ball.z).label)}`;
    const dist = entry.kind === 'putt' ? `굴러간 거리 ${fmtDist(r.total)}` : `캐리 ${fmtDist(r.carry)} · 총 ${fmtDist(r.total)}`;
    showToast(`${dist}${where}${entry.note ? `<br><b>${esc(entry.note)}</b>` : ''}`);
    if (round.holed) {
      holeDone();
      return;
    }
    prepareShot();
  }

  function scoreCardHtml() {
    const holes = course.holes;
    const row = (from, to, name) => {
      const hs = holes.slice(from, to);
      const sc = round.scores.slice(from, to);
      const par = hs.reduce((a, x) => a + x.par, 0);
      const tot = sc.reduce((a, x) => a + (x ?? 0), 0);
      return `
        <tr><th>홀</th>${hs.map((x) => `<td>${x.number}</td>`).join('')}<th>${name}</th></tr>
        <tr><th>파</th>${hs.map((x) => `<td>${x.par}</td>`).join('')}<th>${par}</th></tr>
        <tr><th>타수</th>${sc.map((s, i) => `<td class="${s === null ? '' : s < hs[i].par ? 'under' : s > hs[i].par ? 'over' : 'even'}">${s ?? ''}</td>`).join('')}<th>${tot || ''}</th></tr>`;
    };
    const t = round.totals();
    return `<table class="card-table">${row(0, 9, 'OUT')}${row(9, 18, 'IN')}</table>
      <div class="hc-row">합계 ${t.strokes}타 / 파 ${t.par} (${t.toPar >= 0 ? '+' : ''}${t.toPar})</div>`;
  }

  function holeDone() {
    const s = round.scores[round.holeIndex];
    const last = round.holeIndex === course.holes.length - 1;
    cues.ready();
    modal.innerHTML = `
      <div class="modal-box">
        <div class="big-score">${esc(scoreName(s, round.hole.par))}</div>
        <div class="hc-row">${round.hole.number}번 홀 · 파${round.hole.par} · ${s}타</div>
        ${scoreCardHtml()}
        <div class="row" style="margin-top:10px">
          ${last ? '<button class="primary" data-act="restart">새 라운드</button>' : '<button class="primary" data-act="next">다음 홀 →</button>'}
        </div>
      </div>`;
    modal.classList.add('show');
  }

  // Virtual swing (no sensors): a reasonable shot toward the current aim.
  let vSeed = 1;
  function rand() {
    vSeed = (vSeed * 16807) % 2147483647;
    return vSeed / 2147483647;
  }
  function virtualSwing() {
    if (scene.mode === 'flyover') {
      scene.skipFlyover();
      return;
    }
    if (busy || round.holed) return;
    unlockAudio();
    if (club === 'putter') {
      const d = round.distanceToPin * (0.95 + rand() * 0.2) + 0.3;
      cues.impact({ club: 'putter', power: 0.3 });
      execute(() => round.playPutt(d / PUTT_MAX_DISTANCE, aim + (rand() - 0.5) * 2), '가상 퍼팅');
      return;
    }
    const target = Math.min(aimDistance(), playsLike());
    let lo = 0.25;
    let hi = 1.05;
    for (let i = 0; i < 16; i++) {
      const m = (lo + hi) / 2;
      const c = simulateShot(swingToShot({ peakOmega: (settings.game.referenceOmega || 11) * m, qualityScore: 1 }, club, settings.game).launch, { sampleEvery: 1000 }).carry;
      if (c > target * 0.93) hi = m;
      else lo = m;
    }
    const p = (lo + hi) / 2;
    const shot = swingToShot({ peakOmega: (settings.game.referenceOmega || 11) * p, faceRollDeg: (rand() - 0.5) * 6, planeShiftDeg: (rand() - 0.5) * 5, qualityScore: 0.85 + rand() * 0.15 }, club, settings.game);
    cues.impact({ club, power: shot.delivery.power });
    input.diag.clearCompare();
    execute(() => round.playShot(shot.launch, aim), `가상 스윙 · ${CLUB_LABEL(club)} · ${shot.shape.label}`);
  }

  async function arm() {
    if (scene?.mode === 'flyover') scene.skipFlyover();
    if (input.active) {
      input.stop();
      return;
    }
    const r = await input.start();
    if (r.blocked) return;
    if (!r.ok) setStatus('센서를 사용할 수 없습니다', `${r.error} — "가상 스윙"으로 플레이할 수 있습니다`);
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !round) {
      if (act === 'back') app.show('home');
      return;
    }
    if (act === 'back') app.show('home');
    if (act === 'arm') arm();
    if (act === 'virtual') virtualSwing();
    if (act === 'left' || act === 'right') {
      const step = club === 'putter' ? 0.5 : 2;
      aim = (aim + (act === 'left' ? -step : step) + 360) % 360;
      updateAim();
    }
    if (act === 'pin') {
      aim = headingTo(round.ball, round.pin);
      updateAim();
    }
    if (act === 'card') {
      modal.innerHTML = `<div class="modal-box">${scoreCardHtml()}<div class="row" style="margin-top:10px"><button data-act="close">닫기</button></div></div>`;
      modal.classList.add('show');
    }
    if (act === 'close') modal.classList.remove('show');
    if (act === 'preview' && !busy) prepareShot({ flyover: true });
    if (act === 'next') {
      round.nextHole();
      startHole();
    }
    if (act === 'restart') {
      round = new Round(course, { gameConfig: settings.game });
      startHole();
    }
  });
  clubSel.addEventListener('change', () => setClub(clubSel.value));

  let courseId = null;
  async function ensureWorld(id) {
    if (scene && courseId === id && scene.quality === settings.graphics) return;
    if (scene) {
      scene.dispose();
      scene = null;
    }
    courseId = id;
    const def = COURSES[id];
    $(el, '[data-el=title]').textContent = def.name;
    $(el, '[data-el=load-title]').textContent = def.name;
    loading.classList.add('show');
    course = createCourse(def);
    hud.setCourse(course);
    scene = new CourseScene($(el, '#round-canvas-host'), course, {
      quality: settings.graphics || 'high',
      onProgress: (p, text) => {
        $(el, '[data-el=load-bar]').style.width = `${Math.round(p * 100)}%`;
        $(el, '[data-el=load-text]').textContent = `${text}…`;
      },
    });
    await scene.build();
    scene.onFrame = onFrame;
    round = new Round(course, { gameConfig: settings.game });
    loading.classList.remove('show');
    scene.start();
    startHole();
  }

  // Inspection hook for automated UI tests.
  el.__goto = (n) => {
    round.startHole(n - 1);
    startHole();
  };
  el.__state = () => ({ mode: scene?.mode, busy, holed: round?.holed, fps: scene?.fps, hole: round?.hole.number, strokes: round?.strokes });

  return {
    el,
    async enter(params = {}) {
      document.body.classList.add('wants-landscape');
      const id = COURSES[params.course] ? params.course : courseId ?? (COURSES[settings.course] ? settings.course : 'autumn');
      if (settings.course !== id) {
        settings.course = id;
        saveSettings();
      }
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
      if (scene && courseId === id && scene.quality === settings.graphics) scene.start();
      await ensureWorld(id);
    },
    leave() {
      document.body.classList.remove('wants-landscape');
      input.leave();
      clearInterval(pillTimer);
      scene?.stop();
    },
  };
}

