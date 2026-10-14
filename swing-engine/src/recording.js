// Recording file formats.
//
// CSV: one row per sample, units in the header.
// JSON: metadata sidecar (schema golf-swing-reader/recording@1).

export const CSV_HEADER = ['t_s', 'ax_mps2', 'ay_mps2', 'az_mps2', 'gx_radps', 'gy_radps', 'gz_radps'];
const KEYS = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'];

export function toCSV(samples, digits = 5) {
  const lines = [CSV_HEADER.join(',')];
  for (const s of samples) lines.push(KEYS.map((k) => Number(s[k]).toFixed(k === 't' ? 5 : digits)).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Parse a recording CSV. Accepts this app's header, or any header containing
 * columns that start with t, ax, ay, az, gx, gy, gz.
 */
export function fromCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = KEYS.map((k) => header.findIndex((h) => h === k || h.startsWith(`${k}_`)));
  if (idx.some((i) => i < 0)) throw new Error(`CSV header missing columns: ${KEYS.filter((_, j) => idx[j] < 0).join(', ')}`);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const s = {};
    KEYS.forEach((k, j) => {
      s[k] = Number(cols[idx[j]]);
    });
    out.push(s);
  }
  return out;
}

export const SWING_LABELS = Object.freeze({
  normal: '정상 스윙',
  draw: '드로를 의도한 스윙',
  fade: '페이드를 의도한 스윙',
  slow: '느린 스윙',
  fast: '빠른 스윙',
  incomplete: '불완전한 스윙',
  nonswing: '스윙이 아닌 손동작',
  unknown: '미지정',
});

export function makeMetadata({
  id,
  participantId = 'anonymous',
  createdAt = new Date().toISOString(),
  swingType = 'unknown',
  samples,
  analysis = null,
  device = {},
  synthetic = false,
  notes = '',
}) {
  const n = samples.length;
  const duration = n > 1 ? samples[n - 1].t - samples[0].t : 0;
  return {
    schema: 'golf-swing-reader/recording@1',
    id,
    participantId,
    createdAt,
    synthetic,
    swingType,
    swingTypeLabel: SWING_LABELS[swingType] ?? swingType,
    // Intention is what the player tried to do; it is NOT a measured ball flight.
    intentionNote: 'swingType는 사용자가 의도한 스윙 유형이며 실제 구질 측정값이 아님',
    sampleCount: n,
    durationSeconds: duration,
    measuredRateHz: analysis?.sourceRateHz ?? (duration > 0 ? (n - 1) / duration : null),
    units: { t: 's', accel: 'm/s^2 (includes gravity)', gyro: 'rad/s' },
    coordinateSystem: 'Android device frame (x right, y up along long edge, z out of screen)',
    device,
    quality: analysis
      ? { gaps: analysis.gaps ?? [], saturation: analysis.saturation ?? [], hasAddress: analysis.hasAddress ?? null }
      : null,
    analysis: analysis
      ? {
          valid: analysis.valid,
          reason: analysis.reason,
          phases: analysis.phases ?? null,
          features: analysis.features ?? null,
        }
      : null,
    notes,
  };
}
