// Audio checks in a headless browser.
//
//   node scripts/audio-check.mjs [--url http://127.0.0.1:5173] [--browser chrome|msedge] [--json out.json]
//
// 1. Realtime smoke test: the real createAudio() in a page — no context before the first gesture,
//    a click unlocks it, a burst of game events plays, dispose() closes the context.
// 2. Offline renders (OfflineAudioContext, real engine): every one-shot, the ambience and music bed of
//    every scene, the motor and a stress mix. Asserts: not silent, peak < 1.0, sensible durations,
//    balance (one-shots over the beds, key far below challengeDone), ducking; prints a level table.
// 3. No console errors.
//
// By default it serves the page from a private Vite instance (HMR and file watching off, own
// dependency cache): edits by others to shared modules make Vite reload every page of the shared
// dev server, which would kill a running check. --url uses an existing server instead.
import { writeFileSync } from 'node:fs';
import { launchBrowser, openPage } from './lib/browser.mjs';

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

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

const db = (x) => (x === undefined || x === null ? '' : Number.isFinite(x) ? x.toFixed(1) : '-inf');

function printTable(rows) {
  const cols = [
    ['group', (r) => r.group, 'l'],
    ['name', (r) => r.name, 'l'],
    ['dur s', (r) => r.duration.toFixed(2), 'r'],
    ['peak dBFS', (r) => db(r.peakDb), 'r'],
    ['rms dBFS', (r) => db(r.rmsDb), 'r'],
    ['50ms rms', (r) => db(r.maxRmsDb), 'r'],
    ['raw peak', (r) => db(r.rawPeakDb), 'r'],
  ];
  const cells = rows.map((r) => cols.map(([, get]) => String(get(r))));
  const widths = cols.map(([title], i) => Math.max(title.length, ...cells.map((c) => c[i].length)));
  const line = (vals) => vals.map((v, i) => (cols[i][2] === 'l' ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join('  ');
  console.log(line(cols.map(([t]) => t)));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  let group = rows[0]?.group;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].group !== group) {
      group = rows[i].group;
      console.log('');
    }
    console.log(line(cells[i]));
  }
}

const args = parseArgs(process.argv.slice(2));
let origin = args.url ? String(args.url).replace(/\/$/, '') : '';
let server = null;
if (origin) {
  if (!(await reachable(`${origin}/audio-dev.html`))) {
    console.log(`[audio-check] ${origin}/audio-dev.html does not answer`);
    process.exit(1);
  }
} else {
  const { createServer } = await import('vite');
  server = await createServer({
    server: { port: 5199, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    cacheDir: 'node_modules/.vite-audio-check',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'warn',
  });
  await server.listen();
  origin = server.resolvedUrls.local[0].replace(/\/$/, '');
}

/** One full run. Throws on page-level errors (crash, reload). */
async function runOnce(browser) {
  const failures = [];
  const { page, problems } = await openPage(browser, { width: 800, height: 600 });
  try {
    await page.goto(`${origin}/audio-dev.html?check=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__audioDev?.ready === true', undefined, { timeout: 30000 });

    // ── realtime smoke ──
    const pre = await page.evaluate('window.__audioDev.smokeStart()');
    if (pre.runtimeBeforeGesture) failures.push('smoke: an AudioContext existed before the first user gesture');
    await page.mouse.click(20, 20);
    const smoke = await page.evaluate('window.__audioDev.smokeRun()');
    console.log(
      `realtime smoke: context ${smoke.running} → ${smoke.closed} after dispose · output rms ${db(smoke.rmsDb)} dBFS, ` +
        `peak ${db(smoke.peakDb)} dBFS · stats ${JSON.stringify(smoke.stats)}`,
    );
    if (!smoke.ok) failures.push(`smoke: ${smoke.detail ?? `context ${smoke.running} → ${smoke.closed}`}`);

    // ── offline renders ──
    const t0 = Date.now();
    const report = await page.evaluate('window.__audioDev.runChecks()');
    console.log(`\noffline renders: ${report.rows.length} rows, ${report.results.length} checks, ${report.ms} ms (wall ${Date.now() - t0} ms) @ ${report.sampleRate} Hz\n`);
    printTable(report.rows);
    console.log('');
    for (const r of report.results) if (!r.ok) failures.push(`${r.name}: ${r.detail}`);
    console.log(`${report.results.filter((r) => r.ok).length}/${report.results.length} offline checks passed`);

    if (problems.length) failures.push(...problems.map((p) => `console: ${p}`));
    if (args.json) writeFileSync(String(args.json), JSON.stringify({ smoke, report, problems }, null, 2));
    return failures;
  } finally {
    await page.context().close();
  }
}

// A reload of the shared dev server page (another agent saving a file) is not an audio failure: retry once.
const TRANSIENT = /context was destroyed|navigation|Target crashed|Target page, context or browser has been closed/i;
let failures = [];
const browser = await launchBrowser({ browser: args.browser, webgpu: false });
try {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      failures = await runOnce(browser);
      break;
    } catch (err) {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      if (attempt === 1 && TRANSIENT.test(message)) {
        console.log(`[audio-check] page was reloaded or crashed (${message.split('\n')[0]}) — retrying once`);
        continue;
      }
      failures = [`crashed: ${message}`];
      break;
    }
  }
} finally {
  await browser.close();
  await server?.close();
}

if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log('\nall audio checks passed');
}
