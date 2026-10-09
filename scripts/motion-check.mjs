// Motion check: drives the robot around each level with real keys (headed Chrome, live clock, automatic
// quality unless `--q`) and checks that the picture keeps changing while it moves.
//
//   node scripts/motion-check.mjs [--levels l1,l2,l3,l4,l5] [--seconds 60] [--url http://127.0.0.1:5173/]
//        [--q low|medium|high]        a fixed preset (URL `q`); default: automatic quality
//        [--setq auto|low|medium|high] the quality in the saved settings (default auto)
//        [--autoq low|medium|high|none] the cached automatic pick `harnest.autoQuality` (default none)
//        [--switch medium,high,auto]  quality switches at the start of play, as the settings menu makes them
//                                     (`auto` returns to the automatic quality), 700 ms apart; `a+b` applies a and b
//                                     in the same task, with no frame between (e.g. `medium+low,medium`: two
//                                     steps of a held arrow key in one slow frame)
//        [--menu]                     start from the main menu (play pressed) instead of `skipMenu`
//        [--mode tour|keys]           tour: BFS over the walkable tiles to every chip, terminal, NPC and the
//                                     far corners (default); keys: hold `--route` (e.g. "KeyW:15000,KeyD:8000")
//        [--uncapped]                 no vsync / frame cap (a fast monitor: the automatic quality steps up)
//        [--latency 150 --down 10 --nocache]  network latency (ms) / bandwidth (Mbit/s) / no HTTP cache
//        [--w 1920 --h 1080 --scale 1] [--headless] [--out .shots/motion/<tag>] [--tag name]
//
// Every 500 ms it records a JPEG hash of the middle of the page (what the compositor shows), the robot's
// tile, the camera, `stats()`, the state, the quality / MSAA / automatic quality and the engine flags
// (paused, dry, blank) into <out>/<level>/timeline.json, with a screenshot every 5 s and at each problem.
// Fails (exit code 1) when, in `playing`: the picture stays identical for ≥ 1 s while the robot or the
// camera moved (frozen), the engine stops counting rendered frames (render stalled), or there is any
// WebGPU validation error, page error or console error. The frozen-shot harness (`?freeze=`) cannot see
// this: nothing moves there and the automatic quality is off.
//
// The page must be served with the game's debug API (`window.__harnest`, also in production builds).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, openPage, waitReady } from './lib/browser.mjs';

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
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const levels = String(args.levels ?? args.level ?? 'l1').split(',').map((s) => s.trim()).filter(Boolean);
const autoq = String(args.autoq ?? 'none');
const setq = String(args.setq ?? 'auto');
const mode = String(args.mode ?? 'tour');
const seconds = Number(args.seconds ?? 60);
const switches = args.switch && args.switch !== true ? String(args.switch).split(',') : [];
const tag = String(args.tag ?? `${mode}-${args.q ? `q${args.q}` : `auto-c${autoq}-s${setq}`}${switches.length ? `-sw${switches.join('')}` : ''}`);
const outRoot = resolve(String(args.out ?? `.shots/motion/${tag}`));
/** Middle of the page: no HUD, no toasts. */
const CLIP = { x: 420, y: 300, width: 1080, height: 640 };

const browser = await launchBrowser({ headless: !!args.headless, extraArgs: args.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [] });
const results = [];
try {
  for (const level of levels) results.push(await runLevel(level));
} finally {
  await browser.close();
}
let failed = 0;
for (const r of results) {
  const bad = r.freezes.length || r.stalls || r.gpuErrors || r.problems.length;
  if (bad) failed++;
  console.log(
    `${bad ? 'FAIL' : 'ok  '} ${r.level}: ${r.samples} samples, cols ${r.span.cols.join('–')} rows ${r.span.rows.join('–')}, ` +
      `quality ${r.qualities.join('/')}, frozen ${r.freezes.length}, stalled ${r.stalls}, GPU errors ${r.gpuErrors}, problems ${r.problems.length}`,
  );
}
console.log(`motion-check ${tag}: ${failed ? `${failed} level(s) failed` : 'all levels ok'} → ${outRoot}`);
process.exitCode = failed ? 1 : 0;

async function runLevel(level) {
  const outDir = resolve(outRoot, level);
  mkdirSync(outDir, { recursive: true });
  const menu = !!args.menu;
  const query = [menu ? null : 'skipMenu=1', `level=${level}`, args.q ? `q=${args.q}` : null].filter(Boolean).join('&');
  const url = `${base}${base.includes('?') ? '&' : '?'}${query}`;
  const { page, problems, logs } = await openPage(browser, { width: Number(args.w ?? 1920), height: Number(args.h ?? 1080), scale: Number(args.scale ?? 1) });
  try {
    if (args.latency || args.down || args.nocache) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      if (args.nocache) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (args.latency || args.down) {
        const bps = (Number(args.down ?? 10) * 1e6) / 8;
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(args.latency ?? 150), downloadThroughput: bps, uploadThroughput: bps });
      }
    }
    // a returning player's storage: the cached automatic pick and the settings
    await page.addInitScript(
      ({ autoq, setq, level }) => {
        try {
          if (sessionStorage.getItem('motion-check')) return;
          sessionStorage.setItem('motion-check', '1');
          if (autoq === 'none') localStorage.removeItem('harnest.autoQuality');
          else localStorage.setItem('harnest.autoQuality', autoq);
          const save = { v: 1, currentLevel: level, levels: {}, codex: [], settings: { master: 0.8, music: 0.6, sfx: 0.8, quality: setq } };
          localStorage.setItem('harnest.save.v1', JSON.stringify(save));
        } catch {
          // storage blocked: defaults
        }
      },
      { autoq, setq, level },
    );
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    if (!(await waitReady(page, undefined, 120000))) throw new Error(`${level}: the game did not get ready`);
    await installSampler(page);
    const grid = await page.evaluate(() => {
      const g = window.__harnest.internals.game.runtime.plan.grid;
      const rows = [];
      for (let r = 0; r < g.height; r++) {
        let s = '';
        for (let c = 0; c < g.width; c++) s += g.walkable(c, r) ? '.' : '#';
        rows.push(s);
      }
      return { rows, spots: window.__harnest.spots() };
    });

    // (menu →) intro → playing
    let played = false;
    for (let i = 0; i < 240; i++) {
      const st = await page.evaluate(() => window.__harnest.state());
      if (st === 'playing') break;
      if (st === 'menu' && !played) {
        played = true;
        await page.waitForTimeout(1500);
        await page.evaluate((id) => window.__harnest.bus.emit('ui:play', { levelId: id }), level); // the menu's play button
      }
      if (st === 'intro') await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    for (const q of switches) {
      await page.evaluate((q) => {
        for (const one of q.split('+')) window.__harnest.internals.engine.setQuality(one);
      }, q);
      await page.waitForTimeout(700);
    }

    const t0 = Date.now();
    const samples = [];
    const freezes = [];
    let stalls = 0;
    let last = null;
    let sameSince = null;
    let shotN = 0;
    const shot = async (name) => {
      const p = resolve(outDir, `${String(shotN++).padStart(3, '0')}-${name}.png`);
      await page.screenshot({ path: p });
      return p;
    };
    const movedBetween = (a, b) => Math.hypot(a.player.col - b.player.col, a.player.row - b.player.row) > 0.05 || a.cam.some((v, i) => Math.abs(v - b.cam[i]) > 0.02);
    const sample = async (note) => {
      const s = await page.evaluate(() => window.__motion.sample());
      const buf = await page.screenshot({ type: 'jpeg', quality: 40, clip: CLIP });
      s.hash = createHash('sha1').update(buf).digest('hex').slice(0, 12);
      s.note = note;
      s.wall = Date.now() - t0;
      samples.push(s);
      if (last && s.state === 'playing' && last.state === 'playing' && s.frames === last.frames && s.infoFrame !== last.infoFrame) {
        stalls++;
        console.log(`${level} RENDER STALLED at ${s.t} ms: frames ${s.frames}, paused=${s.paused} dry=${s.dry} blank=${s.blank}`);
      }
      if (last && s.hash === last.hash) {
        sameSince ??= last;
        if (s.state === 'playing' && s.t - sameSince.t >= 1000 && movedBetween(s, sameSince) && !freezes.some((f) => f.from === sameSince.t)) {
          const f = { from: sameSince.t, at: s.t, startPlayer: sameSince.player, player: s.player, quality: s.quality, gpuErrors: s.gpuErrors };
          freezes.push(f);
          f.shot = await shot(`frozen-${s.player.col}-${s.player.row}`);
          console.log(`${level} FROZEN since ${sameSince.t} ms: robot ${JSON.stringify(sameSince.player)} → ${JSON.stringify(s.player)}, quality ${s.quality}, GPU errors ${s.gpuErrors}`);
        }
      } else sameSince = null;
      last = s;
      return s;
    };
    let nextSample = Date.now();
    const tick = async (note) => {
      if (Date.now() < nextSample) return;
      nextSample = Math.max(nextSample + 500, Date.now() - 250);
      const s = await sample(note);
      if (samples.length % 10 === 1) await shot(`t${Math.round(s.wall / 1000)}-${s.player.col}-${s.player.row}`);
    };

    const held = new Set();
    const setKeys = async (want) => {
      for (const k of [...held]) {
        if (want.has(k)) continue;
        await page.keyboard.up(k);
        held.delete(k);
      }
      for (const k of want) {
        if (held.has(k)) continue;
        await page.keyboard.down(k);
        held.add(k);
      }
    };
    const end = Date.now() + seconds * 1000;
    if (mode === 'keys') {
      const parts = String(args.route ?? 'KeyW:15000,KeyD:8000,KeyS:15000,KeyA:8000').split(',').map((p) => p.split(':'));
      outer: while (Date.now() < end) {
        for (const [k, ms] of parts) {
          await setKeys(new Set(k.split('+')));
          const until = Date.now() + Number(ms);
          while (Date.now() < until) {
            if (Date.now() >= end) break outer;
            await tick(k);
            await page.waitForTimeout(50);
          }
        }
      }
    } else {
      await tour(page, grid, end, setKeys, tick);
    }
    await setKeys(new Set());
    await page.waitForTimeout(600);
    await sample('end');
    await shot('end');

    const extra = await page.evaluate(() => ({ gpuErrors: window.__motion.gpuErrors.slice(0, 20), pageErrors: window.__motion.pageErrors.slice(0, 20) }));
    const visited = samples.map((s) => s.player);
    const span = {
      cols: [Math.min(...visited.map((p) => p.col)), Math.max(...visited.map((p) => p.col))],
      rows: [Math.min(...visited.map((p) => p.row)), Math.max(...visited.map((p) => p.row))],
    };
    const report = {
      level,
      url,
      autoq,
      setq,
      switches,
      mode,
      seconds,
      samples: samples.length,
      span,
      qualities: [...new Set(samples.map((s) => s.quality))],
      freezes,
      stalls,
      gpuErrors: samples.at(-1)?.gpuErrors ?? 0,
      problems: problems.slice(0, 20),
      extra,
      engineLogs: logs.filter((l) => /\[engine\]|\[level\]|\[game\]/.test(l)).slice(0, 60),
    };
    writeFileSync(resolve(outDir, 'timeline.json'), JSON.stringify({ ...report, samples }, null, 1));
    return report;
  } finally {
    await page.context().close();
  }
}

/** Per-sample state read in the page; GPU validation errors and page errors are counted from here on. */
async function installSampler(page) {
  await page.evaluate(async () => {
    const h = window.__harnest;
    const engine = h.internals.engine;
    const game = h.internals.game;
    // dev server only: the reflection gate's flags (module state)
    let ground = null;
    if (location.port === '5173') {
      try {
        ground = await import(/* @vite-ignore */ '/src/render/ground.ts');
      } catch {
        ground = null;
      }
    }
    const gpuErrors = [];
    const prev = engine.renderer.onError;
    engine.renderer.onError = (info) => {
      gpuErrors.push(`${Math.round(performance.now())} ${info.type}: ${info.message}`.slice(0, 300));
      prev?.call(engine.renderer, info);
    };
    const pageErrors = [];
    addEventListener('error', (e) => pageErrors.push(`${Math.round(performance.now())} ${e.message}`.slice(0, 300)));
    window.__motion = {
      gpuErrors,
      pageErrors,
      sample() {
        const cam = engine.rig.active.position;
        const auto = engine.auto;
        return {
          t: Math.round(performance.now()),
          player: h.player(),
          cam: [cam.x, cam.y, cam.z].map((v) => Math.round(v * 100) / 100),
          state: h.state(),
          quality: engine.preset.level,
          msaa: engine.msaa,
          pendingMsaa: engine.pendingMsaa,
          auto: auto ? { level: auto.level, held: auto.held, changes: auto.changes } : null,
          frames: engine.stats.frames,
          fps: engine.stats.fps,
          drawCalls: engine.stats.drawCalls,
          infoFrame: engine.renderer.info.frame,
          paused: engine.paused,
          blank: engine.blank,
          dry: engine.dry !== null,
          reflection: ground ? { ...ground.reflectionControl } : null,
          shadowMap: game.atmosphere.key.shadow.mapSize.x,
          lights: game.runtime?.built.lights.active ?? -1,
          gpuErrors: gpuErrors.length,
          pageErrors: pageErrors.length,
        };
      },
    };
  });
}

/** Drives a nearest-neighbour tour (BFS over walkable tiles) to every chip, terminal, NPC and far corner, repeated. */
async function tour(page, grid, end, setKeys, tick) {
  const W = grid.rows[0].length;
  const H = grid.rows.length;
  const walkable = (c, r) => r >= 0 && r < H && c >= 0 && c < W && grid.rows[r][c] === '.';
  const bfs = (from, to) => {
    const key = (c, r) => r * W + c;
    const prev = new Map([[key(from.col, from.row), null]]);
    const queue = [[from.col, from.row]];
    while (queue.length) {
      const [c, r] = queue.shift();
      if (c === to.col && r === to.row) break;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (!walkable(nc, nr) || prev.has(key(nc, nr))) continue;
        prev.set(key(nc, nr), [c, r]);
        queue.push([nc, nr]);
      }
    }
    if (!prev.has(key(to.col, to.row))) return null;
    const path = [];
    for (let cur = [to.col, to.row]; cur; cur = prev.get(key(cur[0], cur[1]))) path.unshift({ col: cur[0], row: cur[1] });
    return path;
  };
  const walk = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (walkable(c, r)) walk.push({ col: c, row: r });
  const sp = grid.spots;
  const targets = [...Object.values(sp.chips), ...Object.values(sp.terminals), ...Object.values(sp.npcs)].map((p) => ({ col: Math.round(p.col), row: Math.round(p.row) }));
  const most = (f) => walk.reduce((a, b) => (f(b) > f(a) ? b : a));
  targets.push(most((p) => p.col), most((p) => -p.col), most((p) => p.row), most((p) => -p.row), most((p) => p.col + p.row), most((p) => p.col - p.row), most((p) => p.row - p.col), most((p) => -p.col - p.row));
  const player = () => page.evaluate(() => window.__harnest.player());
  let pos = await player();
  const order = [];
  let cur = { col: Math.round(pos.col), row: Math.round(pos.row) };
  const left = targets.filter((p) => walkable(p.col, p.row));
  while (left.length) {
    left.sort((a, b) => Math.hypot(a.col - cur.col, a.row - cur.row) - Math.hypot(b.col - cur.col, b.row - cur.row));
    cur = left.shift();
    order.push(cur);
  }
  for (let ti = 0; Date.now() < end; ti++) {
    const target = order[ti % order.length];
    pos = await player();
    const path = bfs({ col: Math.round(pos.col), row: Math.round(pos.row) }, target);
    if (!path) continue;
    let wp = 1;
    let escapes = 0;
    const started = Date.now();
    let lastMove = Date.now();
    let lastPos = pos;
    while (wp < path.length && Date.now() < end) {
      pos = await player();
      const p = path[wp];
      const dc = p.col - pos.col;
      const dr = p.row - pos.row;
      if (Math.hypot(dc, dr) < 0.45) {
        wp++;
        escapes = 0;
        continue;
      }
      const want = new Set();
      if (dc > 0.2) want.add('KeyD');
      if (dc < -0.2) want.add('KeyA');
      if (dr > 0.2) want.add('KeyS');
      if (dr < -0.2) want.add('KeyW');
      await setKeys(want);
      if (Math.hypot(pos.col - lastPos.col, pos.row - lastPos.row) > 0.15) {
        lastMove = Date.now();
        lastPos = pos;
      } else if (Date.now() - lastMove > 900) {
        // stuck on a prop: sidestep across the way, then go on; skip the waypoint after a few tries
        escapes++;
        await setKeys(new Set([Math.abs(dc) > Math.abs(dr) ? (escapes % 2 ? 'KeyW' : 'KeyS') : escapes % 2 ? 'KeyA' : 'KeyD']));
        for (let k = 0; k < 6; k++) {
          await tick('sidestep');
          await page.waitForTimeout(80);
        }
        if (escapes > 4) {
          wp++;
          escapes = 0;
        }
        lastMove = Date.now();
        if (Date.now() - started > 25000) break;
      }
      await tick(`→${target.col},${target.row}`);
      await page.waitForTimeout(40);
    }
  }
}
