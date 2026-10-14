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

export const cues = {
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
  launched() {
    tone(1046, 0, 0.1, 0.2);
    tone(1568, 0.1, 0.2, 0.2);
  },
  rejected() {
    tone(220, 0, 0.35, 0.25, 'square');
    vibrate(350);
  },
};
