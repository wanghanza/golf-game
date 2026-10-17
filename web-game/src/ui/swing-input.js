// Phone-swing input shared by the driving range and the course round:
// sensor start/stop, the real-time detector, the full-screen cue overlay with
// sound/vibration, the touch lock, and the live impact sound.
import { h, $ } from '../util.js';
import { sensors } from '../sensors.js';
import { SwingDetector, DEFAULT_DETECTOR, PUTT_PHASES } from '../../../swing-engine/src/realtime.js';
import { keepScreenOn } from '../platform.js';
import { cues, unlockAudio } from '../cues.js';
import { settings } from '../settings.js';

export const STATE_TEXT = {
  idle: ['스윙 준비를 누르세요', '휴대폰 끝이 공 쪽(비스듬히 아래)을 향하게 그립처럼 쥐고, 손목 스트랩을 착용하세요'],
  countdown: ['휴대폰을 그립처럼 쥐세요', '곧 어드레스 확인을 시작합니다'],
  waitStill: ['어드레스 — 3초간 그대로', '휴대폰 끝을 비스듬히 아래로 향하고 움직이지 마세요'],
  ready: ['준비 완료 — 백스윙을 시작하세요', '휴대폰 뒷면 쪽으로 들어 올리세요'],
  backswing: ['백스윙', ''],
  top: ['탑', '잠깐 멈췄다가 내려오세요'],
  downswing: ['다운스윙', ''],
  follow: ['임팩트!', ''],
  cooldown: ['분석 완료', ''],
};

const PHASES = [
  ['waitStill', '어드레스'],
  ['backswing', '백스윙'],
  ['top', '탑'],
  ['downswing', '다운스윙'],
  ['follow', '임팩트'],
];
const PHASE_INDEX = { countdown: -1, waitStill: 0, ready: 0.5, backswing: 1, top: 2, downswing: 3, follow: 4, cooldown: 5 };

// Putting strokes are small: relaxed thresholds for the offline analysis.
export const PUTT_ANALYSIS = { activeOmega: 0.5, minBackswingDeg: 5, minPeakOmega: 0.6, maxReversals: 6, minBackswingSeconds: 0.12 };

/**
 * @param {HTMLElement} root   screen element; the overlay is appended to it
 * @param {Object} o
 * @param {(r: Object, info: {impactPlayed: boolean}) => void} o.onResult
 * @param {(main: string, sub?: string) => void} o.setStatus
 * @param {() => string} o.getClub
 * @param {() => boolean} [o.canArm]  return false to block arming (e.g. safety not accepted)
 */
export function createSwingInput(root, o) {
  const lock = h(`
    <div class="touch-lock">
      <div class="cue"><div class="phase-row">${PHASES.map(([k, l]) => `<span data-phase="${k}">${l}</span>`).join('<b>›</b>')}</div><div class="cue-big"></div><div class="cue-sub"></div><div class="cue-bar"><i></i></div></div>
      <button class="unlock">길게 눌러 잠금 해제</button>
    </div>`);
  root.appendChild(lock);
  const cue = $(lock, '.cue');
  const cueBig = $(lock, '.cue-big');
  const cueSub = $(lock, '.cue-sub');
  const cueBar = $(lock, '.cue-bar i');
  let lastTick = null;
  let readySince = 0;
  let impactPlayed = false;
  let timer = null;
  let unsub = null;
  const listeners = new Set();

  const isPutt = () => o.getClub() === 'putter';

  const detector = new SwingDetector({
    onState: (st) => {
      const [main, sub] = STATE_TEXT[st] ?? [st, ''];
      if (st !== 'cooldown') o.setStatus(main, detector.hint || sub);
      if (st === 'ready') {
        readySince = performance.now();
        cues.ready();
      }
      if (st === 'countdown') lastTick = null;
      lock.classList.toggle('on', st in PHASE_INDEX && st !== 'cooldown');
      update();
      for (const fn of listeners) fn(st);
    },
    onHint: (h) => {
      if (h) o.setStatus((STATE_TEXT[detector.state] ?? [''])[0], h);
      update();
    },
    onSwing: (r) => {
      const info = { impactPlayed };
      impactPlayed = false;
      if (!r.valid) cues.rejected();
      o.onResult(r, info);
    },
    onImpact: (e) => {
      const club = o.getClub();
      const ref = club === 'putter' ? 3 : settings.game.referenceOmega || 11;
      cues.impact({ club, power: e.peakOmega / ref });
      impactPlayed = true;
    },
  });

  const phaseEls = PHASES.map(([k]) => $(lock, `[data-phase=${k}]`));

  function update() {
    const st = detector.state;
    cue.className = `cue ${st}`;
    const idx = PHASE_INDEX[st] ?? -1;
    phaseEls.forEach((e, i) => {
      e.className = i < idx ? 'done' : i === Math.floor(idx) && idx >= 0 ? 'now' : '';
    });
    const hint = detector.hint;
    if (st === 'countdown') {
      const left = Math.ceil(detector.countdownLeft ?? 0);
      cueBig.textContent = String(Math.max(1, left));
      cueSub.textContent = isPutt() ? '퍼터처럼 쥐고 공 앞에 서세요' : '휴대폰 끝을 비스듬히 아래로 향해 그립처럼 쥐세요';
      cueBar.style.width = '0%';
      if (left !== lastTick && left > 0) {
        lastTick = left;
        cues.tick();
      }
    } else if (st === 'waitStill') {
      const p = detector.stillProgress;
      const total = detector.cfg.stillSeconds;
      cueBig.textContent = p > 0 ? `${Math.max(0, total * (1 - p)).toFixed(1)}초` : '어드레스';
      cueSub.textContent = hint || '휴대폰 끝을 비스듬히 아래로 향하고 그대로 멈추세요';
      cueBar.style.width = `${Math.round(p * 100)}%`;
    } else if (st === 'ready') {
      cueBig.textContent = isPutt() ? '퍼팅!' : '백스윙!';
      cueSub.textContent = hint || (isPutt() ? '시계추처럼 뒤로 뺐다가 밀어 주세요' : '휴대폰 뒷면 쪽으로 들어 올리세요 · 작고 부드럽게');
      cueBar.style.width = '100%';
      if (performance.now() - readySince > 6000) {
        readySince = performance.now();
        cues.reminder();
      }
    } else if (st === 'backswing') {
      cueBig.textContent = '백스윙 ↑';
      cueSub.textContent = `${Math.round(detector.backswingDeg)}°`;
    } else if (st === 'top') {
      cueBig.textContent = '탑';
      cueSub.textContent = `${Math.round(detector.backswingDeg)}° · 이제 내려오세요`;
    } else if (st === 'downswing') {
      cueBig.textContent = '다운스윙 ↓';
      cueSub.textContent = '';
    } else if (st === 'follow') {
      cueBig.textContent = '임팩트!';
      cueSub.textContent = '';
    } else {
      cueBig.textContent = '';
      cueSub.textContent = hint || '';
    }
  }

  // Long-press to unlock touches while armed.
  const unlockBtn = $(lock, '.unlock');
  let pressTimer = null;
  unlockBtn.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(() => api.stop(), 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => unlockBtn.addEventListener(ev, () => clearTimeout(pressTimer)));

  const api = {
    detector,
    get active() {
      return detector.state !== 'idle';
    },
    onState(fn) {
      listeners.add(fn);
    },
    /** Start sensors and arm. Returns { ok, error }. */
    async start() {
      unlockAudio();
      if (o.canArm && !o.canArm()) return { ok: false, blocked: true };
      const r = await sensors.start(settings.sensorRateHz);
      if (!r.ok) return r;
      keepScreenOn(true);
      api.configure();
      detector.arm({ delaySeconds: 3 });
      return { ok: true };
    },
    /** Apply putting or full-swing thresholds for the current club. */
    configure() {
      const base = sensors.analysisOptions();
      const common = { direction: settings.swingDirection === -1 ? -1 : 1, stillSeconds: settings.addressSeconds || 3 };
      if (isPutt()) {
        detector.cfg = { ...DEFAULT_DETECTOR, ...PUTT_PHASES, ...common };
        detector.analysis = { ...base, ...PUTT_ANALYSIS };
      } else {
        detector.cfg = { ...DEFAULT_DETECTOR, ...common };
        detector.analysis = base;
      }
    },
    stop() {
      detector.disarm();
      sensors.stop();
      keepScreenOn(false);
      lock.classList.remove('on');
      o.setStatus(...STATE_TEXT.idle);
    },
    enter() {
      unsub = sensors.onSample((s) => detector.push(s));
      timer = setInterval(update, 100);
    },
    leave() {
      api.stop();
      unsub?.();
      clearInterval(timer);
    },
  };
  return api;
}
