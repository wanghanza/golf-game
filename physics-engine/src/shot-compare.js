// Why did this swing fly differently from a clean (virtual) swing?
//
// The ideal reference is the same club at the same power with a square face,
// neutral path, held lag, a well-timed acceleration zone, a natural transition
// and a centred strike. Each measured factor is then applied on its own to
// that reference and its effect on carry and side distance is reported, so
// the player sees which part of the swing cost the most. Effects are from the
// game model (estimated), not measured ball data.

import { swingToShot } from './shot-model.js';
import { simulateShot } from './flight.js';
import { resolveGameConfig } from './game-config.js';

const IDEAL = Object.freeze({
  faceRollDeg: 0,
  planeShiftDeg: 0,
  qualityScore: 1,
  lagRetention: 0.96,
  accelPeakPhase: 0.75,
  transitionRotation: 0.08,
  transitionDropAccel: 2,
  dropLeadMs: 150,
  squareProgress: 0.8,
});

const FACTORS = [
  { key: 'power', label: '스윙 속도', fields: ['peakOmega'] },
  { key: 'face', label: '페이스 각 (손목 회전)', fields: ['faceRollDeg'] },
  { key: 'path', label: '스윙 경로', fields: ['planeShiftDeg'] },
  { key: 'lag', label: '래그 (임팩트 속도 유지)', fields: ['lagRetention'] },
  { key: 'accel', label: '가속 타이밍', fields: ['accelPeakPhase'] },
  { key: 'transition', label: '탑 전환 (손 먼저 낙하)', fields: ['transitionRotation', 'transitionDropAccel', 'dropLeadMs'] },
  { key: 'square', label: '페이스 스퀘어 타이밍', fields: ['squareProgress'] },
  { key: 'strike', label: '스윙 완성도', fields: ['qualityScore'] },
];

function fly(swing, club, cfg) {
  const shot = swingToShot(swing, club, cfg);
  const f = simulateShot(shot.launch, { sampleEvery: 1000 });
  return { shot, carry: f.carry, lateral: f.totalLateral };
}

function advice(key, swing, cfg, d) {
  const ref = cfg.referenceOmega;
  switch (key) {
    case 'power':
      if (swing.peakOmega > ref * cfg.maxPowerRatio * 1.15) return `최대 각속도 ${swing.peakOmega.toFixed(1)} rad/s는 100% 기준(${ref} rad/s)보다 훨씬 빠릅니다. 파워는 105%에서 막히니 힘을 빼고, 거리는 클럽으로 맞추세요(또는 "내 스윙을 100% 기준으로").`;
      if (d.dCarry < -3) return `스윙 속도가 기준의 ${Math.round((100 * swing.peakOmega) / ref)}%입니다. 다운스윙을 조금 더 빠르게 하세요.`;
      return '';
    case 'face':
      if (swing.faceRollDeg > 0 && Number.isFinite(swing.squareProgress) && swing.squareProgress < 0.6)
        return '임팩트 때 화면(페이스)이 열려 있습니다 — 공이 오른쪽으로 갑니다. 탑에서 내려오기 시작할 때 손목을 비틀어(Twist) 허리 높이에서 화면이 목표를 보게(Square) 하세요.';
      return swing.faceRollDeg > 0
        ? '임팩트 때 화면(페이스)이 열려 있습니다 — 공이 오른쪽으로 갑니다. 내려올 때 왼팔뚝을 조금 더 돌려(로테이션) 화면이 목표를 보게 하세요.'
        : '임팩트 때 화면(페이스)이 닫혀 있습니다 — 공이 왼쪽으로 갑니다. 손목을 덜 돌리고 화면이 목표를 보게 유지하세요.';
    case 'path':
      return swing.planeShiftDeg > 0
        ? '다운스윙이 안쪽에서 바깥으로(인-아웃) 지나갑니다. 백스윙과 같은 길로 내려오세요.'
        : '다운스윙이 바깥에서 안쪽으로(아웃-인, 엎어 치기) 지나갑니다. 탑에서 손을 먼저 아래로 떨어뜨린 뒤 휘두르세요.';
    case 'lag':
      return '임팩트 전에 이미 속도가 줄었습니다(래그를 일찍 풂). 손목 각을 조금 더 오래 유지하다가 공 근처에서 풀어 주세요.';
    case 'accel':
      return swing.accelPeakPhase < 0.6
        ? '다운스윙 초반에 힘을 다 썼습니다(가속이 이름). 처음엔 천천히 내려오다가 공 근처에서 가장 빠르게 하세요.'
        : '가속이 너무 늦어 임팩트에 속도가 다 실리지 않았습니다. 공 조금 전부터 가속을 시작하세요.';
    case 'transition':
      return Number.isFinite(swing.dropLeadMs) && swing.dropLeadMs < 40
        ? '몸이 먼저 돌았습니다. 탑에서 몸통을 돌리기 전에 손(손목)이 먼저 수직으로 떨어지게 하세요.'
        : '탑에서 바로 클럽을 던졌습니다. 탑에서 잠깐 멈춘 뒤 손이 먼저 아래로 떨어지게(수직 낙하) 하세요.';
    case 'square':
      return '페이스(화면)를 임팩트 직전에 뒤집어 닫았습니다. 다운스윙 시작에서 손목을 비틀어(Twist) 허리 높이에서 이미 화면이 목표를 보게(Square) 하세요.';
    case 'strike':
      return '스윙 리듬(템포)이나 부드러운 가속이 부족했습니다. 백:다운 시간 약 3:1로, 끊김 없이 휘두르세요.';
    default:
      return '';
  }
}

/**
 * @param {Object} swing  the swing input given to swingToShot (measured features)
 * @param {string} club
 * @param {Object} [configOverrides]
 */
export function compareToIdeal(swing, club, configOverrides = {}) {
  const cfg = resolveGameConfig(configOverrides);
  const powerOmega = Math.min(swing.peakOmega ?? cfg.referenceOmega, cfg.referenceOmega * cfg.maxPowerRatio);
  const ideal = { ...IDEAL, peakOmega: cfg.referenceOmega };
  const base = fly(ideal, club, cfg);
  const actual = fly(swing, club, cfg);
  const factors = [];
  for (const fct of FACTORS) {
    if (!fct.fields.some((k) => Number.isFinite(swing[k]))) continue;
    const s = { ...ideal };
    for (const k of fct.fields) if (Number.isFinite(swing[k])) s[k] = fct.key === 'power' ? powerOmega : swing[k];
    const r = fly(s, club, cfg);
    const d = { dCarry: r.carry - base.carry, dLateral: r.lateral - base.lateral };
    const size = Math.abs(d.dCarry) + 1.5 * Math.abs(d.dLateral);
    factors.push({ key: fct.key, label: fct.label, ...d, size });
  }
  factors.sort((a, b) => b.size - a.size);
  // Technique flags even when this one shot did not suffer much from them.
  const w = actual.shot.delivery.wrist ?? {};
  const flagged = { square: (w.lateSquare ?? 0) >= 0.3, transition: (w.steep ?? 0) >= 0.4, accel: (w.early ?? 0) + (w.late ?? 0) >= 0.3 };
  for (const f of factors) {
    f.hurts = f.dCarry < -3 || Math.abs(f.dLateral) > 3 || !!flagged[f.key];
    f.advice = f.hurts || (f.key === 'power' && (swing.peakOmega ?? 0) > cfg.referenceOmega * cfg.maxPowerRatio * 1.15) ? advice(f.key, swing, cfg, f) : '';
  }
  return {
    ideal: { carry: base.carry, lateral: base.lateral },
    actual: { carry: actual.carry, lateral: actual.lateral },
    factors,
    overPower: (swing.peakOmega ?? 0) > cfg.referenceOmega * cfg.maxPowerRatio * 1.15,
  };
}
