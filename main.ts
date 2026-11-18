// Token Launch Radar — entry point.
//
// Reads the frozen DefiLlama snapshot (the sealed /input/snapshot.json when
// the grader mounts it, otherwise the copy in data/), fits the model in
// lib/model.ts, and writes the entry's outputs: board.json, data.js, the
// dashboard/ and screenshots/ copies, and dossier.json from the vendored
// buildDossier, byte for byte as the gate rebuilds it.
//
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts        (outside the grader)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardRows, buildRadar, parseSnapshot } from './lib/model.ts';
import { dataScript } from './lib/render.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', existsSync('/input/snapshot.json') ? '/input' : join(here, 'data'));
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the board fails the gate: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows(radar) })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images, the gate wants 3 or 4\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: bad image name\n`);
    process.exit(1);
  }
}

const dossier = buildDossier(out, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(out, 'dossier.json'), dossier);

const rep = radar.report;
process.stdout.write(
  [
    `token radar: ${snapshot.protocols.length} protocols, watchlist ${snapshot.watchlist.length}, board ${radar.board.length} rows`,
    `comparables: ${radar.comps.rows.length} standalone traded tokens (of ${radar.comps.recordedTokens} recording a token, ${radar.comps.tradedRows} carry a positive cap; ${radar.comps.droppedSymbolOnly} symbol-only dropped, ${radar.comps.droppedDeployments} per-token deployments dropped, ${radar.comps.droppedCategory} set aside by the fit-pool category filter)`,
    `model: LOO x${rep.loo.toFixed(2)}, walk-forward x${rep.wf.toFixed(2)} (flat 0.25x rule: x${rep.flatLoo.toFixed(2)} / x${rep.flatWf.toFixed(2)})`,
    ...rep.ladder.map((s) => `  gate ${s.kept ? 'KEPT   ' : 'REJECT '} ${s.term} (pass ${s.round}): LOO x${s.looBefore.toFixed(2)} -> x${s.looAfter.toFixed(2)}, WF x${s.wfBefore.toFixed(2)} -> x${s.wfAfter.toFixed(2)}`),
    `launch odds: ${radar.odds.adopted ? 'ADOPTED' : 'NOT adopted'} (held-out Brier ${radar.odds.brierModel.toFixed(4)} vs base rate ${radar.odds.brierBase.toFixed(4)} on ${radar.odds.testN} protocols listed since ${radar.odds.splitAt})`,
    `bands out-of-fold: P25-P75 held ${(radar.holds.hold2575 * 100).toFixed(0)}%, P10-P90 held ${(radar.holds.hold1090 * 100).toFixed(0)}% of ${radar.holds.tested} held-out caps`,
    `wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length}), dossier.json (${dossier.length} bytes)`,
  ].join('\n') + '\n',
);
