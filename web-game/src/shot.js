// Analysis result -> virtual club -> ball flight.
import { swingToShot } from '../../physics-engine/src/shot-model.js';
import { simulateShot } from '../../physics-engine/src/flight.js';
import { featureValues } from '../../swing-engine/src/analyze.js';
import { settings } from './settings.js';

export function shotFromAnalysis(result, club = settings.club) {
  const f = featureValues(result);
  const swing = {
    peakOmega: f.peakOmegaInPlane,
    faceRollDeg: (settings.invertFace ? -1 : 1) * (f.faceRollDeg ?? 0),
    planeShiftDeg: (settings.invertPath ? -1 : 1) * (f.planeShiftDeg ?? 0),
    qualityScore: f.qualityScore,
  };
  const shot = swingToShot(swing, club, settings.game);
  const flight = simulateShot(shot.launch, { sampleEvery: 4 });
  return { shot, flight, features: f };
}
