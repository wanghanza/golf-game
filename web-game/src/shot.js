// Analysis result -> virtual club -> ball flight.
import { swingToShot } from '../../physics-engine/src/shot-model.js';
import { simulateShot } from '../../physics-engine/src/flight.js';
import { featureValues } from '../../swing-engine/src/analyze.js';
import { settings, saveSettings, fmtDist } from './settings.js';
import { compareToIdeal } from '../../physics-engine/src/shot-compare.js';

/** Feature values (from featureValues) -> swing input for swingToShot. */
export function swingFromFeatures(f) {
  const faceSign = settings.invertFace ? -1 : 1;
  return {
    peakOmega: f.peakOmegaInPlane,
    faceRollDeg: faceSign * (f.faceRollDeg ?? 0),
    planeShiftDeg: (settings.invertPath ? -1 : 1) * (f.planeShiftDeg ?? 0),
    qualityScore: f.qualityScore,
    lagRetention: f.lagRetention,
    accelPeakPhase: f.accelPeakPhase,
    transitionRotation: f.transitionRotation,
    transitionDropAccel: f.transitionDropAccel,
    dropLeadMs: f.dropLeadMs,
    squareProgress: f.squareProgress,
  };
}

/** Short Korean descriptions of transition, acceleration zone and face. */
export function wristText(wrist, faceAngle = 0) {
  if (!wrist) return '';
  const tr = wrist.steep >= 0.5 ? '탑에서 던짐(가파름)' : wrist.steep >= 0.2 ? '전환 약간 급함' : '자연스러운 낙하';
  const acc = wrist.early >= 0.3 ? '가속 이름(캐스팅)' : wrist.late >= 0.3 ? '가속 늦음' : '가속 타이밍 좋음';
  const face = wrist.lateSquare >= 0.3 ? '페이스 늦게 닫힘(플립)' : faceAngle < -1 ? '페이스 닫힘' : faceAngle > 1 ? '페이스 열림' : '페이스 스퀘어';
  return `${tr} · ${acc} · ${face}`;
}

export function shotFromAnalysis(result, club = settings.club) {
  const f = featureValues(result);
  const shot = swingToShot(swingFromFeatures(f), club, settings.game);
  const flight = simulateShot(shot.launch, { sampleEvery: 4 });
  return { shot, flight, features: f };
}

/**
 * After a real (sensor) swing: explain the shot against a clean virtual
 * swing in the verdict panel, and offer to make this player's typical swing
 * the 100% reference when they swing much faster than it.
 */
export function explainRealShot(input, swing, club) {
  input.recordPeak(swing.peakOmega);
  const cmp = compareToIdeal(swing, club, settings.game);
  const typical = input.typicalPeak();
  const ref = settings.game.referenceOmega || 11;
  const calibrate =
    typical && Math.abs(typical - ref) / ref > 0.25
      ? {
          omega: typical,
          apply: () => {
            settings.game.referenceOmega = Math.round(typical * 10) / 10;
            saveSettings();
            input.diag.clearCompare();
          },
        }
      : null;
  input.diag.showCompare(cmp, { fmtDist: (m) => fmtDist(m), calibrate });
  return cmp;
}
