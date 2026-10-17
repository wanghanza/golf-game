// Round logic for the 18-hole course: aiming, club suggestion, strokes,
// penalties, putting and the scorecard. Pure and deterministic, so a bot can
// play the whole course in tests.

import { simulateOnTerrain, simulatePutt, puttSpeedFor, CUP_RADIUS } from '../../physics-engine/src/terrain-flight.js';
import { simulateShot } from '../../physics-engine/src/flight.js';
import { swingToShot } from '../../physics-engine/src/shot-model.js';
import { CLUB_ORDER, CLUBS } from '../../physics-engine/src/clubs.js';
import { headingTo, pointAlong } from './terrain.js';
import { pathDistance } from './layout.js';

export const GIMME_DISTANCE = 0.6; // m: holed automatically with one more stroke
export const MAX_STROKES = 10; // pick up after this many (net double par style cap)
export const PUTT_MAX_DISTANCE = 25; // m reached by a full putting stroke

/** Expected flat-ground carry (m) for each club at 100% power. */
export function clubCarries(gameConfig = {}) {
  const out = {};
  for (const key of CLUB_ORDER) {
    const shot = swingToShot({ peakOmega: gameConfig.referenceOmega ?? 11, qualityScore: 1 }, key, gameConfig);
    out[key] = simulateShot(shot.launch, { sampleEvery: 1000 }).carry;
  }
  return out;
}

export function scoreName(strokes, par) {
  const d = strokes - par;
  if (strokes === 1) return '홀인원';
  return { '-3': '알바트로스', '-2': '이글', '-1': '버디', 0: '파', 1: '보기', 2: '더블 보기', 3: '트리플 보기' }[d] ?? `+${d}`;
}

export class Round {
  constructor(course, { gameConfig = {}, startHole = 1 } = {}) {
    this.course = course;
    this.gameConfig = gameConfig;
    this.carries = clubCarries(gameConfig);
    this.scores = new Array(course.holes.length).fill(null);
    this.startHole(startHole - 1);
  }

  startHole(index) {
    this.holeIndex = index;
    this.hole = this.course.holes[index];
    this.strokes = 0;
    this.penalties = 0;
    const t = this.hole.tee;
    this.ball = { x: t.x, y: this.course.heightAt(t.x, t.z), z: t.z };
    this.lie = this.course.surfaceAt(t.x, t.z);
    this.holed = false;
    this.history = [];
  }

  get pin() {
    return this.hole.pin;
  }

  get distanceToPin() {
    return Math.hypot(this.pin.x - this.ball.x, this.pin.z - this.ball.z);
  }

  get onGreen() {
    return this.lie.name === 'green';
  }

  /** Default aim: the pin, or the dogleg corner if the pin is out of reach. */
  defaultAim(club = this.suggestClub()) {
    if (this.onGreen) return headingTo(this.ball, this.pin);
    const reach = this.carries[club] * 1.12;
    const path = this.hole.path;
    if (path.length > 2 && this.distanceToPin > reach) {
      const here = pathDistance(this.ball.x, this.ball.z, path);
      const corner = path[1];
      const toCorner = Math.hypot(corner.x - this.ball.x, corner.z - this.ball.z);
      const cornerS = pathDistance(corner.x, corner.z, path).s;
      if (here.s < cornerS - 0.02 && toCorner > 40) {
        // Aim a bit past the corner along the second leg when the corner is close.
        const target = toCorner < reach * 0.8 ? pointAlong(path, Math.min(1, cornerS + 0.12)) : corner;
        return headingTo(this.ball, target);
      }
    }
    return headingTo(this.ball, this.pin);
  }

  /** Longest club that does not fly well past the pin; putter on the green. */
  suggestClub() {
    if (this.onGreen) return 'putter';
    const d = this.distanceToPin;
    const order = [...CLUB_ORDER].reverse(); // shortest first
    for (const k of order) if (this.carries[k] >= d * 0.95) return k;
    return this.lie.name === 'tee' ? 'driver' : 'wood3';
  }

  wind() {
    // Gentle autumn sea breeze per hole (deterministic), m/s world vector.
    const a = (this.holeIndex * 47) % 360;
    const s = (1.5 + ((this.holeIndex * 7) % 5) * 0.6) * (this.course.windScale ?? 1);
    return [Math.sin((a * Math.PI) / 180) * s, 0, Math.cos((a * Math.PI) / 180) * s];
  }

  /**
   * Play a full shot.
   * @param {Object} launch  ball launch (from swingToShot)
   * @param {number} heading compass aim (deg)
   */
  playShot(launch, heading) {
    const lieFactor = this.lie.lie ?? 1;
    const adjusted = { ...launch, ballSpeed: launch.ballSpeed * lieFactor };
    const result = simulateOnTerrain(adjusted, {
      origin: [this.ball.x, this.ball.y, this.ball.z],
      heading,
      terrain: this.course,
      wind: this.wind(),
      cup: this.pin,
      sampleEvery: 4,
    });
    return this.applyResult(result, { kind: 'shot', lie: this.lie.name, lieFactor });
  }

  /** Putt with a 0..~1 stroke strength (1 = PUTT_MAX_DISTANCE on flat ground). */
  playPutt(strength, heading) {
    const speed = puttSpeedFor(Math.max(0, strength) * PUTT_MAX_DISTANCE, this.lie.rollingResistance ?? 0.06);
    const result = simulatePutt({
      origin: [this.ball.x, this.ball.y, this.ball.z],
      heading,
      speed,
      terrain: this.course,
      cup: this.pin,
    });
    return this.applyResult(result, { kind: 'putt' });
  }

  applyResult(result, meta) {
    this.strokes += 1;
    const from = { ...this.ball };
    let penalty = 0;
    let note = null;
    const rest = result.rest;
    const out =
      rest.x < this.course.bounds.minX || rest.x > this.course.bounds.maxX ||
      rest.z < this.course.bounds.minZ || rest.z > this.course.bounds.maxZ;
    if (result.water || out) {
      // Stroke and distance: one penalty stroke, replay from the previous spot.
      penalty = 1;
      this.penalties += 1;
      this.strokes += 1;
      note = result.water ? '바다에 빠졌습니다 (1벌타, 원위치)' : 'OB (1벌타, 원위치)';
    } else {
      this.ball = { x: rest.x, y: this.course.heightAt(rest.x, rest.z), z: rest.z };
      this.lie = this.course.surfaceAt(rest.x, rest.z);
    }
    if (result.holed) {
      this.holed = true;
      note = scoreName(this.strokes, this.hole.par);
    } else if (!penalty && this.onGreen && this.distanceToPin <= GIMME_DISTANCE) {
      this.strokes += 1;
      this.holed = true;
      note = `컨시드 (OK) — ${scoreName(this.strokes, this.hole.par)}`;
    } else if (this.strokes >= MAX_STROKES) {
      this.holed = true;
      note = '최대 타수 — 다음 홀로';
    }
    if (this.holed) this.scores[this.holeIndex] = this.strokes;
    const entry = { ...meta, from, result, penalty, note, strokes: this.strokes, lie: this.lie.name };
    this.history.push(entry);
    return entry;
  }

  nextHole() {
    if (this.holeIndex + 1 >= this.course.holes.length) return false;
    this.startHole(this.holeIndex + 1);
    return true;
  }

  get finished() {
    return this.scores.every((s) => s !== null);
  }

  totals() {
    let strokes = 0;
    let par = 0;
    this.scores.forEach((s, i) => {
      if (s !== null) {
        strokes += s;
        par += this.course.holes[i].par;
      }
    });
    return { strokes, par, toPar: strokes - par };
  }
}

export { CUP_RADIUS, CLUBS };
