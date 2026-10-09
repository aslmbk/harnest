// Visual-regression comparison of two baseline tags (from scripts/visual-baseline.mjs).
//
//   node scripts/visual-compare.mjs --base <tag> --test <tag>
//        [--max-diff 0.1]   max % of pixels whose largest RGB difference exceeds the tolerance (default 0.1)
//        [--min-psnr 45]    min PSNR in dB (default 45)
//        [--tol 2]          per-channel tolerance in 0..255 steps (default 2, i.e. 2/255)
//        [--no-images]      skip writing the diff images
//        [--subset]         compare only the shots present in both tags (no MISSING / EXTRA failures)
//
// Per shot: % of differing pixels, max channel difference, mean absolute error (in /255 steps), PSNR, and
// the draw-call / triangle change from the manifests. Diff images go to .shots/compare/<base>-vs-<test>/
// (base dimmed to grey; red = above tolerance, brighter = larger; amber = within tolerance).
// Exit code 1 if any shot fails a threshold or is missing from either side.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareImages, DEFAULTS, passes } from './lib/imagediff.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.base || !args.test || args.base === true || args.test === true) {
  console.error('usage: node scripts/visual-compare.mjs --base <tag> --test <tag> [--max-diff 0.1] [--min-psnr 45] [--tol 2]');
  process.exit(2);
}
const baseTag = String(args.base);
const testTag = String(args.test);
const tol = Number(args.tol ?? DEFAULTS.channelTolerance);
const maxDiffFraction = Number(args['max-diff'] ?? DEFAULTS.maxDiffFraction * 100) / 100;
const minPsnr = Number(args['min-psnr'] ?? DEFAULTS.minPsnr);
const writeImages = !args['no-images'];

const baseDir = resolve('.shots/baseline', baseTag);
const testDir = resolve('.shots/baseline', testTag);
const outDir = resolve('.shots/compare', `${baseTag}-vs-${testTag}`);
for (const d of [baseDir, testDir]) {
  if (!existsSync(resolve(d, 'manifest.json'))) {
    console.error(`no baseline at ${d} (run scripts/visual-baseline.mjs --tag …)`);
    process.exit(2);
  }
}
if (writeImages) mkdirSync(outDir, { recursive: true });

const readManifest = (d) => JSON.parse(readFileSync(resolve(d, 'manifest.json'), 'utf8'));
const mBase = readManifest(baseDir);
const mTest = readManifest(testDir);
const testShots = new Map(mTest.shots.map((s) => [s.file, s]));
const baseFiles = new Set(mBase.shots.map((s) => s.file));

for (const k of ['q', 'freeze', 'width', 'height']) {
  if (mBase.params[k] !== mTest.params[k]) console.warn(`warning: capture params differ: ${k} = ${mBase.params[k]} vs ${mTest.params[k]}`);
}

const fmtPct = (f) => `${(f * 100).toFixed(3)}%`;
const fmtPsnr = (p) => (p === Infinity ? 'inf' : p.toFixed(2));
const delta = (a, b) => (b === a ? '=' : `${b - a > 0 ? '+' : ''}${b - a}`);

const rows = [];
let failed = false;
for (const shot of mBase.shots) {
  const other = testShots.get(shot.file);
  if (!other) {
    if (args.subset) continue;
    rows.push({ file: shot.file, status: 'MISSING' });
    failed = true;
    continue;
  }
  const a = decodePng(readFileSync(resolve(baseDir, shot.file)));
  const b = decodePng(readFileSync(resolve(testDir, other.file)));
  let r;
  try {
    r = compareImages(a, b, { channelTolerance: tol, diffImage: writeImages });
  } catch (err) {
    rows.push({ file: shot.file, status: `ERROR ${err instanceof Error ? err.message : err}` });
    failed = true;
    continue;
  }
  const ok = passes(r, { maxDiffFraction, minPsnr });
  if (!ok) failed = true;
  if (writeImages && r.diff) writeFileSync(resolve(outDir, shot.file), encodePng({ width: a.width, height: a.height, data: r.diff }));
  rows.push({
    file: shot.file,
    status: ok ? 'ok' : 'FAIL',
    diff: fmtPct(r.diffFraction),
    max: String(r.maxDiff),
    mae: r.mae.toFixed(4),
    psnr: fmtPsnr(r.psnr),
    draws: `${shot.stats.drawCalls}${delta(shot.stats.drawCalls, other.stats.drawCalls) === '=' ? '' : ` ${delta(shot.stats.drawCalls, other.stats.drawCalls)}`}`,
    tris: `${shot.stats.triangles}${delta(shot.stats.triangles, other.stats.triangles) === '=' ? '' : ` ${delta(shot.stats.triangles, other.stats.triangles)}`}`,
    r,
  });
}
if (!args.subset) for (const s of mTest.shots) if (!baseFiles.has(s.file)) rows.push({ file: s.file, status: 'EXTRA (not in base)' });

const cols = [
  ['shot', 'file'],
  ['status', 'status'],
  [`diff>${tol}`, 'diff'],
  ['max', 'max'],
  ['MAE', 'mae'],
  ['PSNR dB', 'psnr'],
  ['draws', 'draws'],
  ['tris', 'tris'],
];
const widths = cols.map(([h, k]) => Math.max(h.length, ...rows.map((r) => String(r[k] ?? '').length)));
const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
console.log(`\n${baseTag} vs ${testTag}   pass: diff ≤ ${fmtPct(maxDiffFraction)} of pixels (channel tolerance ${tol}/255) and PSNR ≥ ${minPsnr} dB\n`);
console.log(line(cols.map(([h]) => h)));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const r of rows) console.log(line(cols.map(([, k]) => r[k] ?? '')));

const measured = rows.filter((r) => r.r);
if (measured.length) {
  const worstDiff = measured.reduce((m, r) => Math.max(m, r.r.diffFraction), 0);
  const worstPsnr = measured.reduce((m, r) => Math.min(m, r.r.psnr), Infinity);
  const worstMax = measured.reduce((m, r) => Math.max(m, r.r.maxDiff), 0);
  console.log(`\nworst: diff ${fmtPct(worstDiff)}, max channel diff ${worstMax}, PSNR ${fmtPsnr(worstPsnr)} dB`);
}
const failures = rows.filter((r) => r.status !== 'ok').length;
console.log(`${rows.length - failures}/${rows.length} shots pass${writeImages ? `; diff images in ${outDir}` : ''}`);
writeFileSync(
  resolve(writeImages ? outDir : testDir, writeImages ? 'report.json' : `compare-vs-${baseTag}.json`),
  JSON.stringify({ base: baseTag, test: testTag, tol, maxDiffFraction, minPsnr, rows: rows.map(({ r, ...rest }) => ({ ...rest, ...(r ? { diffFraction: r.diffFraction, maxDiff: r.maxDiff, mae: r.mae, psnr: r.psnr === Infinity ? null : r.psnr } : {}) })) }, null, 2),
);
process.exitCode = failed ? 1 : 0;
