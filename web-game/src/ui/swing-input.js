// Phone-swing input shared by the driving range and the course round:
// sensor start/stop, the real-time detector, the full-screen cue overlay with
// sound/vibration, the touch lock, and the live impact sound.
import { h, $ } from '../util.js';
import { sensors } from '../sensors.js';
import { SwingDetector } from '../../../swing-engine/src/realtime.js';
import { keepScreenOn } from '../platform.js';
import { cues, unlockAudio } from '../cues.js';
import { settings } from '../settings.js';

export const STATE_TEXT = {
  idle: ['스윙 준비를 누르세요', '휴대폰을 세로로 세워 긴 쪽이 샤프트 방향이 되게 양손으로 쥐고, 손목 스트랩을 착용하세요'],
  countdown: ['휴대폰을 그립처럼 쥐세요', '잠시 뒤 어드레스 확인을 시작합니다'],
  waitStill: ['어드레스 자세로 멈추세요', '움직이지 않으면 준비됩니다'],
  ready: ['준비 완료 — 스윙하세요', '"삐-삐" 소리와 진동이 신호입니다'],
  swinging: ['스윙 감지 중…', ''],
  cooldown: ['분석 완료', ''],
};

// Putting strokes are small: relaxed thresholds for detection and analysis.
export const PUTT_DETECTOR = { startOmega: 0.9, endOmega: 0.5, liveMinPeakOmega: 0.6, liveMinBackswingRad: 0.08 };
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
      <div class="cue"><div class="cue-big"></div><div class="cue-sub"></div><div class="cue-bar"><i></i></div></div>
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
    onState: (s) => {
      const [a, b] = STATE_TEXT[s] ?? [s, ''];
      if (s !== 'cooldown') o.setStatus(a, b);
      if (s === 'ready') {
        readySince = performance.now();
        cues.ready();
      }
      if (s === 'countdown') lastTick = null;
      lock.classList.toggle('on', ['countdown', 'waitStill', 'ready', 'swinging'].includes(s));
      update();
      for (const fn of listeners) fn(s);
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

  function update() {
    const st = detector.state;
    cue.className = `cue ${st}`;
    if (st === 'countdown') {
      const left = Math.ceil(detector.countdownLeft ?? 0);
      cueBig.textContent = String(Math.max(1, left));
      cueSub.textContent = isPutt() ? '퍼터처럼 쥐고 공 앞에 서세요' : '휴대폰을 그립처럼 쥐고 어드레스 자세를 잡으세요';
      cueBar.style.width = '0%';
      if (left !== lastTick && left > 0) {
        lastTick = left;
        cues.tick();
      }
    } else if (st === 'waitStill') {
      const p = detector.stillProgress;
      cueBig.textContent = p > 0 ? '그대로…' : '멈추세요';
      cueSub.textContent = '공 앞에서 어드레스 자세로 움직이지 마세요';
      cueBar.style.width = `${Math.round(p * 100)}%`;
    } else if (st === 'ready') {
      cueBig.textContent = isPutt() ? '퍼팅!' : '스윙!';
      cueSub.textContent = isPutt() ? '시계추처럼 작게 — 세게 칠수록 멀리 굴러갑니다' : '작고 부드럽게 — 세게 휘둘러도 거리는 늘지 않습니다';
      cueBar.style.width = '100%';
      if (performance.now() - readySince > 6000) {
        readySince = performance.now();
        cues.reminder();
      }
    } else if (st === 'swinging') {
      cueBig.textContent = '';
      cueSub.textContent = '';
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
      if (isPutt()) {
        detector.cfg = { ...detector.cfg, ...PUTT_DETECTOR };
        detector.analysis = { ...base, ...PUTT_ANALYSIS };
      } else {
        detector.cfg = { ...detector.cfg, startOmega: 2.0, endOmega: 1.0, liveMinPeakOmega: 3.0, liveMinBackswingRad: 0.6 };
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
