// Plain-language verdict for one swing attempt: did it launch, and if not,
// why, with the numbers behind it and what to try next.

import { REASON_TEXT } from './analyze.js';

const DEG = 180 / Math.PI;
const G = 9.80665;
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : '–');
const r1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const f = (result, k) => result?.features?.[k]?.value;

const TIPS = {
  incomplete_swing: '처음 어드레스한 자리(가상의 공)를 지나 팔로스루까지 끝까지 휘두르세요.',
  too_slow: '조금 더 빠르게, 끊지 말고 한 번에 휘두르세요.',
  irregular_tempo: '백스윙은 천천히, 다운스윙은 한 번에 — 백:다운 시간이 약 3:1이 되게 해 보세요.',
  shake: '손목만 흔들지 말고, 뒤로 올렸다가 한 번 내려오는 동작으로 하세요.',
  no_backswing: '화면 반대쪽(휴대폰 뒷면 쪽)으로 충분히 들어 올리세요.',
  shock: '휴대폰이 무언가에 부딪혔거나 손에서 미끄러졌습니다. 주변을 확인하고 스트랩을 조이세요.',
  sensor_saturated: '힘을 70% 정도로 줄여 부드럽게 휘두르세요. 최대 파워는 그 정도로도 충분히 나옵니다.',
  data_gap: '다른 앱을 닫고, 절전 모드를 끈 뒤 다시 해 보세요.',
  too_few_samples: '센서가 켜져 있는지 확인하세요.',
  no_motion: '스윙 동작이 감지되지 않았습니다.',
};

/** Live-detector rejections (before any analysis). */
const REJECTS = {
  wrongDirection: { title: '백스윙 방향이 반대', tip: '휴대폰 뒷면 쪽(목표 반대쪽)으로 올리세요. 계속 반대로 잡히면 설정에서 "스윙 방향 반전"을 켜세요.' },
  smallBackswing: { title: '백스윙이 너무 작음', tip: '탑에서 멈추기 전에 더 크게 올리세요.' },
  longTop: { title: '탑에서 너무 오래 멈춤', tip: '탑에서는 잠깐(1초 이내)만 멈추고 내려오세요.' },
  moving: { title: '어드레스 중 움직임', tip: '"백스윙!" 신호가 나올 때까지 가만히 있으세요.' },
};

/**
 * @param {Object} result  analyzeSwing result (with livePhases from the detector)
 * @param {Object} [ctx]
 * @param {number} [ctx.gyroRange]   rad/s, from the sensor (if known)
 * @param {number} [ctx.accelRange]  m/s^2
 * @param {number} [ctx.minBackswingDeg]
 */
export function diagnoseSwing(result, ctx = {}) {
  const lp = result.livePhases ?? {};
  const s = result.sensor ?? {};
  const rows = [];
  const bs = f(result, 'backswingAngle') ?? lp.backswingDeg;
  const ds = f(result, 'downswingDuration');
  const peak = f(result, 'peakOmegaInPlane');
  rows.push({ label: '어드레스', value: lp.addressStart != null || result.hasAddress ? '확인' : '없음', status: lp.addressStart != null || result.hasAddress ? 'ok' : 'warn' });
  rows.push({ label: '백스윙', value: `${r0(bs)}°`, status: Number.isFinite(bs) ? (bs >= (ctx.minBackswingDeg ?? 30) ? 'ok' : 'bad') : 'na' });
  rows.push({ label: '탑', value: lp.top != null || result.phases?.top != null ? '통과' : '–', status: lp.top != null || result.phases?.top != null ? 'ok' : 'na' });
  rows.push({ label: '다운스윙', value: Number.isFinite(ds) ? `${r0(ds * 1000)} ms · 최대 ${r1(peak)} rad/s` : lp.downswingStart != null ? '시작함' : '–', status: lp.downswingStart != null || Number.isFinite(ds) ? 'ok' : 'na' });
  const impactLive = lp.impact != null;
  const dsDeg = lp.downswingDeg;
  let impactText = impactLive ? '감지' : '안 됨';
  const need = lp.impactNeedDeg ?? lp.backswingDeg;
  if (!impactLive && Number.isFinite(dsDeg) && Number.isFinite(need)) impactText = `안 됨 (${r0(dsDeg)}° / 필요 ${r0(need)}°)`;
  rows.push({ label: '임팩트', value: impactText, status: impactLive ? 'ok' : lp.downswingStart != null ? 'bad' : 'na' });

  // Face (phone screen) rotation: open at the top -> hip height -> impact.
  const fTop = f(result, 'faceRollTopDeg');
  const fDel = f(result, 'faceRollDeliveryDeg');
  const fImp = f(result, 'faceRollDeg');
  if (Number.isFinite(fTop) && Number.isFinite(fDel) && Number.isFinite(fImp)) {
    const sg = (x) => `${x >= 0 ? '+' : ''}${r0(x)}°`;
    const prog = f(result, 'squareProgress');
    rows.push({ label: '페이스 회전', value: `탑 ${sg(fTop)} → 허리 ${sg(fDel)} → 임팩트 ${sg(fImp)}`, status: Number.isFinite(prog) && prog < 0.45 ? 'warn' : Math.abs(fImp) > 8 ? 'warn' : 'ok' });
  }
  const lead = f(result, 'dropLeadMs');
  if (Number.isFinite(lead)) {
    rows.push({ label: '손 먼저', value: lead >= 40 ? `손이 ${r0(lead)} ms 먼저 낙하` : `몸이 먼저 돎 (${r0(lead)} ms)`, status: lead >= 40 ? 'ok' : 'warn' });
  }

  // Sensor range use.
  const gyroRange = ctx.gyroRange ?? s.gyroRange ?? s.gyroClipLevel;
  const accelRange = ctx.accelRange ?? s.accelRange ?? s.accelClipLevel;
  if (Number.isFinite(s.peakOmega)) {
    const pct = gyroRange ? ` / 범위 ${r0(gyroRange * DEG)}°/s (${r0((100 * s.peakOmega) / gyroRange)}%)` : '';
    const clip = s.gyroClipSeconds > 0 ? ` · ${r0(s.gyroClipSeconds * 1000)} ms 초과${result.reason === 'sensor_saturated' ? '' : '(보정함)'}` : '';
    rows.push({ label: '회전 센서', value: `최대 ${r0(s.peakOmega * DEG)}°/s${pct}${clip}`, status: result.reason === 'sensor_saturated' ? 'bad' : s.gyroClipSeconds > 0 ? 'warn' : 'ok' });
  }
  if (Number.isFinite(s.peakAccel)) {
    const pct = accelRange ? ` / 범위 ${r1(accelRange / G)}g` : '';
    const clip = s.accelClipSeconds > 0 ? ' · 범위 초과(판정에 영향 없음)' : '';
    rows.push({ label: '가속도 센서', value: `최대 ${r1(s.peakAccel / G)}g${pct}${clip}`, status: s.accelClipSeconds > 0 ? 'warn' : 'ok' });
  }
  if (Number.isFinite(f(result, 'sampleRateHz'))) {
    const hz = f(result, 'sampleRateHz');
    rows.push({ label: '샘플링', value: `${r0(hz)} Hz`, status: hz >= 90 ? 'ok' : 'warn' });
  }

  if (result.valid) {
    return { ok: true, title: '발사 성공', detail: '', rows, tip: result.warnings?.includes('gyro_clipped') ? '회전 센서가 잠깐 범위를 넘었지만 보정해서 발사했습니다. 파워는 최대치로 계산됩니다.' : '' };
  }
  const reason = result.reason;
  let detail = REASON_TEXT[reason] ?? reason;
  if (reason === 'incomplete_swing' && Number.isFinite(dsDeg) && Number.isFinite(need)) {
    detail = `다운스윙이 어드레스 위치까지 돌아오지 않았습니다 (${r0(dsDeg)}° 내려옴, ${r0(need)}° 필요).`;
  } else if (reason === 'sensor_saturated') {
    detail = `회전 센서가 ${r0(s.gyroClipSeconds * 1000)} ms 동안 최대치(${r0((gyroRange ?? 0) * DEG)}°/s)에 걸려 스윙 각도를 믿을 수 없습니다.`;
  } else if (reason === 'too_slow' && Number.isFinite(peak)) {
    detail = `스윙 최대 회전 속도 ${r1(peak)} rad/s — 최소 기준보다 느립니다.`;
  } else if (reason === 'irregular_tempo') {
    const b = f(result, 'backswingDuration');
    detail = `템포가 비정상: 백스윙 ${r0(b * 1000)} ms, 다운스윙 ${r0(ds * 1000)} ms.`;
  }
  return { ok: false, title: '발사 안 함', detail, rows, tip: TIPS[reason] ?? '' };
}

/** A rejection by the live detector (the swing was not analysed). */
export function diagnoseReject(code, info = {}) {
  const r = REJECTS[code] ?? { title: code, tip: '' };
  const rows = [];
  if (Number.isFinite(info.backswingDeg)) rows.push({ label: '백스윙', value: `${r0(info.backswingDeg)}°${info.minBackswingDeg ? ` / 최소 ${info.minBackswingDeg}°` : ''}`, status: code === 'smallBackswing' ? 'bad' : 'ok' });
  if (Number.isFinite(info.topSeconds)) rows.push({ label: '탑 정지', value: `${r1(info.topSeconds)} s / 최대 ${info.maxTopSeconds} s`, status: 'bad' });
  return { ok: false, title: '다시 어드레스', detail: r.title, rows, tip: r.tip };
}
