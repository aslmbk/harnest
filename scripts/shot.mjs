// Screenshot of a running page, with console errors reported.
//
//   node scripts/shot.mjs --out .shots/a.png [--url http://127.0.0.1:5173/?skipMenu=1]
//        [--wait 1500]            ms to wait after the page is ready (default 1500)
//        [--ready "<js expr>"]    readiness condition (default: window.__harnest?.ready === true)
//        [--eval "<js>"]          run in the page before the screenshot (after ready)
//        [--keys "KeyW:800,KeyW+KeyD:400"]  hold keys in order (KeyboardEvent.code : ms)
//        [--w 1280 --h 720] [--scale 1] [--browser chrome|msedge] [--no-webgpu] [--logs]
//
// For multi-step scenarios write your own script on top of scripts/lib/browser.mjs.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { holdKeys, launchBrowser, openPage, waitReady } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? 'http://127.0.0.1:5173/';
const outPath = resolve(String(args.out ?? '.shots/shot.png'));
mkdirSync(dirname(outPath), { recursive: true });

const browser = await launchBrowser({ browser: args.browser, webgpu: !args['no-webgpu'] });
try {
  const { page, problems, logs } = await openPage(browser, {
    width: Number(args.w ?? 1280),
    height: Number(args.h ?? 720),
    scale: Number(args.scale ?? 1),
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitReady(page, args.ready ? String(args.ready) : undefined);
  let evalResult;
  if (args.eval) evalResult = await page.evaluate(String(args.eval));
  if (args.keys) await holdKeys(page, String(args.keys));
  await page.waitForTimeout(Number(args.wait ?? 1500));
  await page.screenshot({ path: outPath });
  const backend = await page.evaluate('window.__harnest?.backend ?? null').catch(() => null);
  console.log(JSON.stringify({ out: outPath, ready, backend, evalResult, problems }, null, 2));
  if (args.logs) console.log(logs.join('\n'));
  process.exitCode = ready && problems.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
