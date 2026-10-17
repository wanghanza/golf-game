// Analysis result -> virtual club -> ball flight.
import { swingToShot } from '../../physics-engine/src/shot-model.js';
import { simulateShot } from '../../physics-engine/src/flight.js';
import { featureValues } from '../../swing-engine/src/analyze.js';
import { settings } from './settings.js';

/** Feature values (from featureValues) -> swing input for swingToShot. */
export function swingFromFeatures(f) {
  const faceSign = settings.invertFace ? -1 : 1;
  return {
    peakOmega: f.peakOmegaInPlane,
    faceRollDeg: faceSign * (f.faceRollDeg ?? 0),
    planeShiftDeg: (settings.invertPath ? -1 : 1) * (f.planeShiftDeg ?? 0),
    qualityScore: f.qualityScore,
    lagRetention: f.lagRetention,
    // Roll rate relative to swing speed; same sign convention as faceRollDeg.
    rollRatio: f.omegaAtImpact > 0 && Number.isFinite(f.forearmRollRate) ? (faceSign * f.forearmRollRate) / f.omegaAtImpact : undefined,
  };
}

/** Short Korean description of the wrist action for the result card. */
export function wristText(wrist) {
  if (!wrist) return '';
  const rel = wrist.release >= 0.8 ? '래그 유지' : wrist.release >= 0.4 ? '약간 이른 릴리스' : '이른 릴리스(캐스팅)';
  const r = wrist.rollFaceDeg;
  const roll = r < -1 ? '로테이션 빠름 → 페이스 닫힘' : r > 1 ? '로테이션 억제 → 페이스 열림' : '로테이션 보통';
  return `${rel} · ${roll}`;
}

export function shotFromAnalysis(result, club = settings.club) {
  const f = featureValues(result);
  const shot = swingToShot(swingFromFeatures(f), club, settings.game);
  const flight = simulateShot(shot.launch, { sampleEvery: 4 });
  return { shot, flight, features: f };
}
