// User settings persisted in localStorage.
import { DEFAULT_GAME_CONFIG } from '../../physics-engine/src/game-config.js';

const KEY = 'gsr.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  club: 'iron7',
  units: 'm',
  sensorRateHz: 200,
  participantId: 'P01',
  safetyAccepted: false,
  invertFace: false,
  invertPath: false,
  swingDirection: 1,
  addressSeconds: 3,
  diagPanel: true,
  course: 'autumn',
  game: { ...DEFAULT_GAME_CONFIG },
});

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...s, game: { ...DEFAULT_SETTINGS.game, ...(s.game || {}) } };
  } catch (e) {
    return { ...DEFAULT_SETTINGS, game: { ...DEFAULT_SETTINGS.game } };
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    /* storage may be unavailable */
  }
}

export function fmtDist(m) {
  if (!Number.isFinite(m)) return '-';
  return settings.units === 'yd' ? `${(m / 0.9144).toFixed(1)} yd` : `${m.toFixed(1)} m`;
}
