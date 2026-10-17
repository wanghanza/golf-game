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
  };
}

/** Short Korean description of the wrist action for the result card. */
export function wristText(wrist, faceAngle = 0) {
  if (!wrist) return '';
  const rel = wrist.release >= 0.8 ? '래그 유지' : wrist.release >= 0.4 ? '약간 이른 릴리스' : '이른 릴리스(캐스팅)';
  const face = faceAngle < -1 ? '페이스 닫힘(손목 굽힘·로테이션 많음)' : faceAngle > 1 ? '페이스 열림(손목 펴짐·로테이션 부족)' : '페이스 스퀘어';
  return `${rel} · ${face}`;
}

export function shotFromAnalysis(result, club = settings.club) {
  const f = featureValues(result);
  const shot = swingToShot(swingFromFeatures(f), club, settings.game);
  const flight = simulateShot(shot.launch, { sampleEvery: 4 });
  return { shot, flight, features: f };
}
