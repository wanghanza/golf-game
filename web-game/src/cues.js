// Audio + vibration cues. While swinging, the player cannot read the screen,
// so every state change also has a sound and a vibration pattern.
import { vibrate } from './platform.js';

let ctx = null;

/** Must be called from a user gesture (button press) to unlock audio. */
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) {
    ctx = null;
  }
}

function tone(freq, start, dur, gain = 0.25, type = 'sine') {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.setValueAtTime(gain, t0 + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(c) {
  if (!c.__noiseBuf) {
    c.__noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
    const d = c.__noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
  }
  const src = c.createBufferSource();
  src.buffer = c.__noiseBuf;
  return src;
}

function decayGain(c, t0, peak, decay) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  return g;
}

// Synthesised club-on-ball impact, no audio files.
//   driver/woods: bright "ping" (thin titanium face rings at 2-4 kHz)
//   irons/wedge:  short, dense "click" with a low turf thump
// Louder with more power; a poor strike (low quality) is duller and shorter.
const IMPACT_VOICES = {
  wood: { band: 4200, q: 1.4, click: 0.035, rings: [[2350, 0.16], [3950, 0.11], [5600, 0.06]], thump: 0 },
  iron: { band: 2800, q: 2.2, click: 0.025, rings: [[1650, 0.05], [3100, 0.035]], thump: 0.12 },
};

/** Schedule an impact sound on any (realtime or offline) AudioContext. */
export function synthImpact(c, dest, { club = 'iron7', power = 1, quality = 1 } = {}, when = 0) {
  const v = club === 'driver' || club === 'wood3' ? IMPACT_VOICES.wood : IMPACT_VOICES.iron;
  const p = Math.max(0.25, Math.min(1.1, power));
  const qf = Math.max(0, Math.min(1, quality));
  const dull = 0.55 + 0.45 * qf; // 1 = pure strike
  const t0 = c.currentTime + when + 0.001;
  const out = c.createGain();
  out.gain.value = 0.9 * p;
  out.connect(dest);

  // Contact transient: band-passed noise burst.
  const n = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = v.band * dull;
  bp.Q.value = v.q;
  n.connect(bp).connect(decayGain(c, t0, 1.2, v.click)).connect(out);
  n.start(t0);
  n.stop(t0 + 0.2);

  // Face ring.
  for (const [f, dur] of v.rings) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * (0.97 + 0.03 * dull);
    o.connect(decayGain(c, t0, 0.22 * dull, dur * dull)).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // Turf / body thump for irons (and any mishit).
  const thump = v.thump + (1 - qf) * 0.08;
  if (thump > 0) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(70, t0 + 0.08);
    o.connect(decayGain(c, t0, 0.5 * thump * 4, 0.09)).connect(out);
    o.start(t0);
    o.stop(t0 + 0.12);
  }
}

export const cues = {
  impact(opts) {
    if (ctx) synthImpact(ctx, ctx.destination, opts);
  },
  tick() {
    tone(660, 0, 0.08, 0.18);
  },
  ready() {
    // "삐-삐-" rising: swing now.
    tone(880, 0, 0.12);
    tone(1320, 0.15, 0.25);
    vibrate(220);
  },
  reminder() {
    tone(880, 0, 0.08, 0.12);
  },
  rejected() {
    tone(220, 0, 0.35, 0.25, 'square');
    vibrate(350);
  },
};
