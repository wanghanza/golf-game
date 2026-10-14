#!/usr/bin/env node
// Write synthetic sample recordings (CSV + JSON metadata) to a directory.
// Usage: node data-tools/src/cli.js <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSwing, SWING_TYPES } from './synth.js';
import { analyzeSwing, toCSV, makeMetadata } from '../../swing-engine/src/index.js';

const outDir = process.argv[2] ?? 'sample-data';
mkdirSync(outDir, { recursive: true });
const index = [];
for (const type of Object.keys(SWING_TYPES)) {
  const { meta, samples } = generateSwing({ type, seed: 1 });
  const analysis = analyzeSwing(samples);
  const id = `synthetic_${type}`;
  const md = makeMetadata({
    id,
    participantId: 'synthetic',
    createdAt: '2026-01-01T00:00:00.000Z',
    swingType: type,
    samples,
    analysis,
    synthetic: true,
    device: { model: 'synthetic generator' },
    notes: '합성(가상) 데이터입니다. 실제 측정값이 아닙니다.',
  });
  md.generator = meta;
  // Signals are for plotting only; keep the sidecar small.
  if (md.analysis) delete md.analysis.signals;
  writeFileSync(join(outDir, `${id}.csv`), toCSV(samples));
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(md, null, 2) + '\n');
  index.push({ id, type, label: meta.swingTypeLabel, valid: analysis.valid, reason: analysis.reason });
  console.log(`${id}: ${samples.length} samples, valid=${analysis.valid}${analysis.reason ? ` (${analysis.reason})` : ''}`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ synthetic: true, recordings: index }, null, 2) + '\n');
