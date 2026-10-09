// HARNEST performance benchmark: frame time (CPU vs GPU, per render pass), stalls with their cause,
// load-time breakdown, renderer.info counts, optional CPU profile / allocation profile / Chrome trace.
//
// Measure against a production build, not the hot-reloading dev server:
//   npx vite build --outDir .perf-dist --sourcemap
//   npx vite preview --outDir .perf-dist --port 4174 --strictPort
//
//   node scripts/perf.mjs [options]
//     --url <base>         game URL (default http://127.0.0.1:4174/)
//     --level <id>         level (default l1)
//     --q <low|medium|high|auto>  quality preset (default high; auto = the game's own picker, starts at medium)
//     --w 1920 --h 1080    viewport (CSS px)          --scale <dpr>   device pixel ratio (default 1)
//     --no-webgpu          force the WebGL2 fallback  --headless      no window (default: headed — headless
//                          Chrome composites differently: slower and with a deeper GPU queue, not representative)
//     --uncapped           no vsync / frame-rate limit (--disable-frame-rate-limit --disable-gpu-vsync)
//     --scenario <name>    frames (default) | events | features | soak | load
//         frames   : load → intro → playing, then --idle s standing, --drive s driving (WASD pattern)
//         events   : first move, terminal open/close, dialog, chip, gate, level exit → next level,
//                    quality changes high→medium→low→high (every stall listed with its nearest event)
//         features : GPU / frame cost of each feature at the current preset (toggled at runtime)
//         soak     : --minutes of driving + 3 level switches; JS heap and renderer.info.memory over time
//         load     : only the load (navigation → ready → playing) breakdown
//     --idle 8 --drive 20  segment lengths in seconds (frames scenario)
//     --minutes 5          soak length
//     --reload             load scenario: load twice in the same browser and report the second (warm shader caches)
//     --profile            frames scenario: + CPU profile (100 µs sampling) over the drive and allocation
//                          sampling idle vs drive (top functions mapped through the source maps)
//     --profile-load       CPU profile (500 µs) from navigation to `playing`: top functions overall, inside the
//                          longest load frames and inside each async compile phase
//     --trace              Chrome trace over the measured part: GC counts, main / GPU thread busy time,
//                          what the GPU process did during each stall
//     --no-gpu-timer       skip the GPU-timestamp segment. GPU timestamps + the per-frame submit→done probe load
//                          Chrome's GPU process noticeably, so they run in their own segment ('idle-gputimer',
//                          per-pass GPU ms); every other segment runs without them
//     --bare               same as --no-gpu-timer
//     --no-proc            do not sample per-thread CPU time of Chrome's GPU / renderer processes (Windows only;
//                          gives GPU-process main-thread ms per frame without tracing overhead)
//     --categories <list>  extra trace categories, comma separated (e.g. disabled-by-default-gpu.dawn)
//     --noui               no DOM UI (default: real UI + autoui answering intro / dialogs / terminals)
//     --out <file.json>    raw results (frames, stalls, events, profiles summaries)
//     --artifacts <dir>    where .cpuprofile / trace summaries go (default: next to --out, else none)
//     --browser chrome|msedge
//
// Prints: frame-time table (p50/p90/p99/max per segment, engine CPU split update/render, GPU per pass),
// stalls > 50 ms with timestamps, nearest game event and a cause, load timings, renderer.info counts.
// Exit code 1 on page errors / console errors or when the game never reaches `playing`.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { launchBrowser, openPage, waitReady } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
const cfg = {
  url: String(args.url ?? 'http://127.0.0.1:4174/'),
  level: String(args.level ?? 'l1'),
  q: String(args.q ?? 'high'),
  w: Number(args.w ?? 1920),
  h: Number(args.h ?? 1080),
  scale: Number(args.scale ?? 1),
  webgpu: !args['no-webgpu'],
  headed: !args.headless,
  uncapped: !!args.uncapped,
  scenario: String(args.scenario ?? 'frames'),
  idle: Number(args.idle ?? 8),
  drive: Number(args.drive ?? 20),
  minutes: Number(args.minutes ?? 5),
  profile: !!args.profile,
  profileLoad: !!args['profile-load'],
  reload: !!args.reload,
  trace: !!args.trace,
  gpuTimer: !args['no-gpu-timer'] && !args.bare,
  proc: !args['no-proc'] && process.platform === 'win32',
  categories: args.categories ? String(args.categories).split(',') : [],
  noui: !!args.noui,
  out: args.out ? resolve(String(args.out)) : null,
  browser: args.browser ? String(args.browser) : undefined,
};
const artifacts = args.artifacts ? resolve(String(args.artifacts)) : cfg.out ? dirname(cfg.out) : null;
const tag = cfg.out ? basename(cfg.out).replace(/\.json$/, '') : `perf-${cfg.level}-${cfg.q}`;

// ───────────────────────────── page-side instrumentation ─────────────────────────────
// Runs before any page script (addInitScript). Hooks the engine through `window.__harnest.internals`
// the moment the game attaches it (before the first level compiles). Everything is recorded into
// preallocated typed arrays so the recorder itself allocates (almost) nothing per frame.
function pageInstrument(opts) {
  const now = () => performance.now();
  const S = 16; // engine record stride
  const P = {
    opts,
    raf: new Float64Array(1 << 19),
    nRaf: 0,
    rec: new Float64Array(S * (1 << 17)),
    nRec: 0,
    gpu: new Float64Array(3 * (1 << 20)),
    nGpu: 0,
    lat: new Float32Array(1 << 17).fill(-1),
    labels: [],
    labelIdx: new Map(),
    passKey: new Map(),
    events: [],
    logs: [],
    marks: [],
    loaf: [],
    longtasks: [],
    pipeLog: [],
    nodeLog: [],
    compile: [],
    readyAt: null,
    phase: '',
    inLoop: false,
    gpuOn: false,
    hooked: false,
    hookError: null,
    totals: { nodeBuilds: 0, nodeBuildMs: 0, pipesSync: 0, pipesAsync: 0, pipeMs: 0, programs: 0, programMs: 0, tex: 0, texMs: 0 },
  };
  window.__perf = P;
  P.mark = (name) => P.marks.push([name, now()]);
  const intern = (s) => {
    let i = P.labelIdx.get(s);
    if (i === undefined) {
      i = P.labels.length;
      P.labels.push(s);
      P.labelIdx.set(s, i);
    }
    return i;
  };
  P.resetLabels = () => P.passKey.clear();
  const tick = (t) => {
    if (P.nRaf < P.raf.length) P.raf[P.nRaf++] = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        P.loaf.push({
          start: e.startTime,
          dur: e.duration,
          block: e.blockingDuration,
          render: e.renderStart,
          style: e.styleAndLayoutStart,
          scripts: (e.scripts || []).map((s) => ({ start: s.startTime, dur: s.duration, inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: s.sourceURL, pos: s.sourceCharPosition, layout: s.forcedStyleAndLayoutDuration })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longtasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  for (const k of ['info', 'log', 'warn']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      if (typeof a[0] === 'string' && a[0][0] === '[') P.logs.push([now(), k, a[0].slice(0, 240)]);
      return orig(...a);
    };
  }

  let api;
  Object.defineProperty(window, '__harnest', {
    configurable: true,
    enumerable: true,
    get: () => api,
    set: (v) => {
      api = v;
      try {
        onApi(v);
      } catch (e) {
        P.hookError = String((e && e.stack) || e);
      }
    },
  });

  function onApi(v) {
    if (!v || typeof v !== 'object') return;
    const bus = v.bus;
    if (bus && typeof bus.emit === 'function') {
      const emit = bus.emit;
      bus.emit = function (type, payload) {
        if (type !== 'player:motion') {
          const e = { t: now(), type };
          if (payload && typeof payload === 'object') {
            for (const k of ['ratio', 'label', 'from', 'to', 'levelId', 'terminalId', 'npcId', 'chipId', 'name', 'kind', 'backend']) if (k in payload) e[k] = payload[k];
          }
          P.events.push(e);
        }
        return emit.call(this, type, payload);
      };
    }
    let ready = v.ready;
    Object.defineProperty(v, 'ready', {
      configurable: true,
      enumerable: true,
      get: () => ready,
      set: (x) => {
        ready = x;
        if (x && P.readyAt === null) P.readyAt = now();
      },
    });
    let internals = v.internals;
    Object.defineProperty(v, 'internals', {
      configurable: true,
      enumerable: true,
      get: () => internals,
      set: (x) => {
        internals = x;
        if (x && x.engine && !P.hooked) {
          P.hooked = true;
          try {
            hookEngine(x.engine, x.game);
          } catch (e) {
            P.hookError = String((e && e.stack) || e);
          }
        }
      },
    });
  }

  function hookEngine(engine, game) {
    const r = engine.renderer;
    const be = r.backend;
    P.backend = be.isWebGPUBackend ? 'webgpu' : 'webgl2';
    const T = P.totals;
    const cur = { nb: 0, nbMs: 0, ps: 0, pa: 0, pMs: 0, pr: 0, prMs: 0, tx: 0, txMs: 0, upd: 0, ren: 0 };

    // sync node builds (TSL → WGSL/GLSL) that happen outside the async precompile
    const nodes = r._nodes;
    if (nodes && typeof nodes.getForRender === 'function') {
      const orig = nodes.getForRender;
      nodes.getForRender = function (ro, useAsync) {
        const d = this.get(ro);
        if (d.nodeBuilderState !== undefined || useAsync) return orig.call(this, ro, useAsync);
        const size = this.nodeBuilderCache.size;
        const a = now();
        const res = orig.call(this, ro, useAsync);
        if (this.nodeBuilderCache.size > size) {
          const dt = now() - a;
          cur.nb++;
          cur.nbMs += dt;
          T.nodeBuilds++;
          T.nodeBuildMs += dt;
          if (P.nodeLog.length < 5000) {
            const m = ro.material;
            P.nodeLog.push({
              t: a,
              ms: Math.round(dt * 10) / 10,
              phase: P.phase,
              mat: (m && (m.name || m.type)) || '?',
              shadowPass: !!(m && m.isShadowPassMaterial),
              obj: (ro.object && (ro.object.name || ro.object.type)) || '?',
              type: ro.object ? ro.object.type : '?',
              ctx: ro.context ? ro.context.id : -1,
              depth: r._callDepth,
            });
          }
        }
        return res;
      };
    }
    // new GPU pipelines (sync = created inside a frame, async = precompile)
    const pipes = r._pipelines;
    if (pipes && typeof pipes._getRenderPipeline === 'function') {
      const orig = pipes._getRenderPipeline;
      pipes._getRenderPipeline = function (ro, sv, sf, key, promises) {
        const a = now();
        const res = orig.call(this, ro, sv, sf, key, promises);
        const dt = now() - a;
        const sync = !promises;
        if (sync) {
          cur.ps++;
          T.pipesSync++;
        } else {
          cur.pa++;
          T.pipesAsync++;
        }
        cur.pMs += dt;
        T.pipeMs += dt;
        if (P.pipeLog.length < 20000) {
          const m = ro.material;
          P.pipeLog.push({
            t: a,
            ms: Math.round(dt * 100) / 100,
            sync,
            inLoop: P.inLoop,
            phase: P.phase,
            mat: (m && (m.name || m.type)) || '?',
            obj: (ro.object && (ro.object.name || ro.object.type)) || '?',
            ctx: ro.context ? ro.context.id : -1,
            samples: ro.context ? ro.context.sampleCount : 0,
          });
        }
        return res;
      };
    }
    if (typeof be.createProgram === 'function') {
      const orig = be.createProgram;
      be.createProgram = function (prog) {
        const a = now();
        try {
          return orig.call(this, prog);
        } finally {
          const dt = now() - a;
          cur.pr++;
          cur.prMs += dt;
          T.programs++;
          T.programMs += dt;
        }
      };
    }
    const tex = r._textures;
    if (tex && typeof tex.updateTexture === 'function') {
      const orig = tex.updateTexture;
      tex.updateTexture = function (t, o) {
        const d = this.get(t);
        if (d.initialized === true && d.version === t.version) return orig.call(this, t, o);
        const a = now();
        try {
          return orig.call(this, t, o);
        } finally {
          const dt = now() - a;
          cur.tx++;
          cur.txMs += dt;
          T.tex++;
          T.texMs += dt;
        }
      };
    }
    // pass labels for the GPU timestamps (uid = r:<call>:<context>:f<frame>)
    if (typeof be.beginRender === 'function') {
      const orig = be.beginRender;
      be.beginRender = function (ctx) {
        if (P.gpuOn) {
          try {
            const uid = this.get(ctx).timestampUID;
            if (uid) {
              const parts = uid.split(':');
              const key = parts[1] + ':' + parts[2];
              if (!P.passKey.has(key)) {
                const rt = ctx.renderTarget;
                const lbl = rt
                  ? `${(rt.texture && rt.texture.name) || 'rt'} ${rt.width}x${rt.height}${rt.samples > 1 ? ' msaa' + rt.samples : ''} d${r._callDepth}`
                  : `canvas ${ctx.width}x${ctx.height} d${r._callDepth}`;
                P.passKey.set(key, intern(lbl));
              }
            }
          } catch {}
        }
        return orig.call(this, ctx);
      };
    }
    let pending = false;
    const pollGpu = () => {
      if (pending) return;
      pending = true;
      r.resolveTimestampsAsync('render')
        .then(() => {
          const pool = be.timestampQueryPool && be.timestampQueryPool.render;
          if (!pool || !pool.timestamps) return;
          for (const [uid, ms] of pool.timestamps) {
            const parts = uid.split(':');
            const frame = Number(parts[3].slice(1));
            const key = parts[1] + ':' + parts[2];
            let li = P.passKey.get(key);
            if (li === undefined) li = intern('ctx' + parts[2] + '#' + parts[1]);
            if (P.nGpu * 3 + 3 <= P.gpu.length) {
              const o = P.nGpu++ * 3;
              P.gpu[o] = frame;
              P.gpu[o + 1] = li;
              P.gpu[o + 2] = ms;
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    P.setGpu = (on) => {
      P.gpuOn = !!on;
      be.trackTimestamp = !!on;
      return be.trackTimestamp;
    };
    if (opts.gpuTimerAtLoad) P.setGpu(true);

    // engine loop: total, game update, render (CPU side, includes nested passes)
    if (game && typeof game.update === 'function') {
      const u = game.update;
      game.update = function (dt) {
        const a = now();
        try {
          return u.call(this, dt);
        } finally {
          cur.upd += now() - a;
        }
      };
    }
    const post = engine.post;
    if (post && typeof post.render === 'function') {
      const pr = post.render;
      post.render = function () {
        const a = now();
        try {
          return pr.call(this);
        } finally {
          cur.ren += now() - a;
        }
      };
    }
    const dev = be.device || null;
    const origSAL = r.setAnimationLoop.bind(r);
    r.setAnimationLoop = (cb) =>
      origSAL(
        cb
          ? (time, xr) => {
              const a = now();
              P.inLoop = true;
              cur.nb = cur.nbMs = cur.ps = cur.pa = cur.pMs = cur.pr = cur.prMs = cur.tx = cur.txMs = cur.upd = cur.ren = 0;
              try {
                cb(time, xr);
              } finally {
                P.inLoop = false;
                const b = now();
                if (P.nRec * S + S <= P.rec.length) {
                  const o = P.nRec++ * S;
                  const R = P.rec;
                  R[o] = time;
                  R[o + 1] = a;
                  R[o + 2] = b;
                  R[o + 3] = cur.upd;
                  R[o + 4] = cur.ren;
                  R[o + 5] = cur.nb;
                  R[o + 6] = cur.nbMs;
                  R[o + 7] = cur.ps;
                  R[o + 8] = cur.pa;
                  R[o + 9] = cur.pMs;
                  R[o + 10] = cur.pr;
                  R[o + 11] = cur.prMs;
                  R[o + 12] = cur.tx;
                  R[o + 13] = cur.txMs;
                  R[o + 14] = r.info.render.drawCalls;
                  R[o + 15] = r.info.frame;
                }
                if (P.gpuOn) pollGpu();
                // submit → GPU done latency of this frame (how far the GPU queue runs behind)
                if (dev && P.gpuOn && P.nRec > 0) {
                  const idx = P.nRec - 1;
                  const s0 = now();
                  dev.queue.onSubmittedWorkDone().then(() => {
                    if (idx < P.lat.length) P.lat[idx] = now() - s0;
                  });
                }
              }
            }
          : cb,
      );
    // load phases
    const wrapAsync = (obj, name, label) => {
      const f = obj && obj[name];
      if (typeof f !== 'function') return;
      obj[name] = async function (...a) {
        const t0 = now();
        const prev = P.phase;
        P.phase = label;
        try {
          return await f.apply(this, a);
        } finally {
          P.phase = prev;
          P.compile.push({ label, start: t0, end: now() });
        }
      };
    };
    wrapAsync(engine, 'compile', 'engine.compile');
    wrapAsync(post, 'compileAsync', 'scenePass.compileAsync');
    wrapAsync(post, 'compilePass', 'nested.compilePass');
    wrapAsync(engine, 'gpuIdle', 'gpuIdle');
    if (game) {
      wrapAsync(game, 'buildLevel', 'game.buildLevel');
      wrapAsync(game, 'enterLevel', 'game.enterLevel');
    }
    P.snapshot = () => ({
      pipelines: r._pipelines ? r._pipelines.caches.size : null,
      vertexShaders: r._pipelines ? r._pipelines.programs.vertex.size : null,
      fragmentShaders: r._pipelines ? r._pipelines.programs.fragment.size : null,
      nodeBuilderStates: r._nodes && r._nodes.nodeBuilderCache ? r._nodes.nodeBuilderCache.size : null,
      renderContexts: r._renderContexts ? Object.keys(r._renderContexts._renderContexts || {}).length : null,
      render: { ...r.info.render },
      memory: { ...r.info.memory },
      pixelRatio: r.getPixelRatio(),
      canvas: [r.domElement.width, r.domElement.height],
      preset: engine.preset ? engine.preset.level : null,
    });
  }
}

// ───────────────────────────── helpers (node side) ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? x : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? x : Math.round(x * 100) / 100);
function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, mean: r2(mean), p50: r2(pct(v, 0.5)), p90: r2(pct(v, 0.9)), p99: r2(pct(v, 0.99)), max: r2(v[v.length - 1]) };
}

// ── source maps (tiny VLQ decoder, no dependencies) ──
const B64 = new Int8Array(128).fill(-1);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => (B64[c.charCodeAt(0)] = i));
function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let genCol = 0;
  let src = 0;
  let sLine = 0;
  let sCol = 0;
  let name = 0;
  let seg = [];
  let value = 0;
  let shift = 0;
  const flush = () => {
    if (!seg.length) return;
    genCol += seg[0];
    const s = [genCol];
    if (seg.length >= 4) {
      src += seg[1];
      sLine += seg[2];
      sCol += seg[3];
      s.push(src, sLine, sCol);
      if (seg.length >= 5) {
        name += seg[4];
        s.push(name);
      }
    }
    line.push(s);
    seg = [];
  };
  for (let i = 0; i < mappings.length; i++) {
    const c = mappings.charCodeAt(i);
    if (c === 44) {
      flush();
      continue;
    }
    if (c === 59) {
      flush();
      lines.push(line);
      line = [];
      genCol = 0;
      continue;
    }
    const d = B64[c];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      seg.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  flush();
  lines.push(line);
  return lines;
}
const mapCache = new Map();
async function loadMap(url) {
  if (mapCache.has(url)) return mapCache.get(url);
  let m = null;
  try {
    const js = await (await fetch(url)).text();
    const lineStarts = [0];
    for (let i = 0; i < js.length; i++) if (js.charCodeAt(i) === 10) lineStarts.push(i + 1);
    const ref = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(js)?.[1];
    let json = null;
    if (ref?.startsWith('data:')) json = JSON.parse(Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64').toString());
    else if (ref) {
      const res = await fetch(new URL(ref, url));
      if (res.ok) json = await res.json();
    }
    m = { lineStarts, map: json ? { lines: decodeMappings(json.mappings), sources: json.sources, names: json.names ?? [] } : null };
  } catch {
    m = null;
  }
  mapCache.set(url, m);
  return m;
}
/** Class enclosing each line of three's bundled builds (three.webgpu.js / three.core.js). */
const threeClassIndex = new Map();
function threeClassAt(file, line) {
  const name = basename(file);
  if (!/^three\.(webgpu|core|module)\.js$/.test(name)) return null;
  let idx = threeClassIndex.get(name);
  if (!idx) {
    idx = [];
    const p = resolve(ROOT, 'node_modules/three/build', name);
    if (existsSync(p)) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((l, i) => {
        const m = /^(?:class|function) (\w+)/.exec(l);
        if (m) idx.push([i + 1, m[1]]);
      });
    }
    threeClassIndex.set(name, idx);
  }
  let lo = 0;
  let hi = idx.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx[mid][0] <= line) {
      best = idx[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
/** Maps a generated (url, 0-based line, 0-based column) to the original source. */
async function mapPos(url, line, col) {
  if (!url || !/^https?:/.test(url)) return null;
  const m = await loadMap(url);
  if (!m?.map) return null;
  const segs = m.map.lines[line];
  if (!segs?.length) return null;
  let lo = 0;
  let hi = segs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][0] <= col) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0 || segs[best].length < 4) return null;
  const s = segs[best];
  let source = m.map.sources[s[1]] ?? '?';
  source = source.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
  const res = { source, line: s[2] + 1, col: s[3], name: s.length >= 5 ? m.map.names[s[4]] : null };
  const cls = threeClassAt(source, res.line);
  if (cls) res.cls = cls;
  return res;
}
async function mapCharPos(url, pos) {
  if (!url || pos === undefined || pos < 0) return null;
  const m = await loadMap(url);
  if (!m) return null;
  let lo = 0;
  let hi = m.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m.lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return mapPos(url, lo, pos - m.lineStarts[lo]);
}

/** Category of a mapped function, for grouping CPU / allocation profiles. */
function categorize(fn, mapped, url) {
  if (fn === '(garbage collector)') return 'GC';
  if (fn === '(idle)') return 'idle';
  if (fn === '(program)') return 'browser native (program)';
  if (fn === '(root)') return 'root';
  const src = mapped?.source ?? '';
  if (!url) return 'native/API calls (WebGPU, DOM, builtins)';
  if (/node_modules\/three\//.test(src)) {
    const c = mapped?.cls ?? '';
    if (/^(Renderer|RenderList|RenderLists|RenderContext|RenderContexts|RenderObjects?|RenderBundles?|ClippingContext)$/.test(c)) return 'three: renderer core (render lists, culling, draw loop)';
    if (/^(Bindings|Uniforms?Group|NodeUniformsGroup|UniformBuffer|Buffer|Uniform|\w*Uniform|NodeSampler|Sampler|SampledTexture|Binding)$/.test(c)) return 'three: bindings / uniform updates';
    if (/^(Pipelines|Pipeline|RenderPipeline|ProgrammableStage|ComputePipeline)$/.test(c)) return 'three: pipelines';
    if (/^(Geometries|Attributes|Info|DataMap|ChainMap|Textures)$/.test(c)) return 'three: geometry/attribute/texture bookkeeping';
    if (/^WebGPU|^WebGL|Backend$/.test(c)) return 'three: backend (WebGPU/WebGL)';
    if (/^(Object3D|Matrix[34]|Vector[234]|Quaternion|Euler|Frustum|Sphere|Box3|Plane|Ray|Color|Layers|Mesh|InstancedMesh|BatchedMesh|Camera|PerspectiveCamera|OrthographicCamera|Light|PointLight|DirectionalLight|Scene|Group|BufferGeometry|BufferAttribute)$/.test(c)) return `three: scene graph / math (${c})`;
    if (/Node|^NodeFrame$|^NodeManager$|Lighting|Lights/.test(c)) return 'three: nodes (NodeFrame / uniforms / lights)';
    return `three: other (${c || basename(src)})`;
  }
  if (/node_modules\//.test(src)) return `lib: ${src.split('node_modules/')[1].split('/')[0]}`;
  if (/^src\/ui\//.test(src)) return 'game: UI (DOM)';
  if (/^src\/audio\//.test(src)) return 'game: audio';
  if (/^src\/(world|engine|render|core|content|dev)\//.test(src)) return `game: ${src.split('/')[1]}`;
  if (/^src\//.test(src)) return 'game: other';
  return mapped ? `other (${src})` : `unmapped (${basename(url)})`;
}

// ───────────────────────────── CPU / allocation profile ─────────────────────────────
/**
 * Self / inclusive time per function, grouped by category. `win` = { from, to, pageAtStart } limits it to
 * a page-time window (pageAtStart: performance.now() when the profiler started).
 */
async function summarizeCpuProfile(profile, topN = 25, win = null) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const { samples, timeDeltas } = profile;
  let tUs = 0;
  for (let i = 0; i < samples.length; i++) {
    tUs += timeDeltas[i] ?? 0;
    if (win) {
      const page = tUs / 1000 + win.pageAtStart;
      if (page < win.from || page > win.to) continue;
    }
    const dt = (timeDeltas[i + 1] ?? timeDeltas[i] ?? 0) / 1000;
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  // aggregate by function (url:line:col)
  const byFn = new Map();
  const keyOf = (n) => `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}|${n.callFrame.columnNumber}`;
  for (const [id, ms] of self) {
    const n = nodes.get(id);
    if (!n) continue;
    const k = keyOf(n);
    const e = byFn.get(k) ?? { cf: n.callFrame, self: 0, incl: 0 };
    e.self += ms;
    byFn.set(k, e);
  }
  // inclusive time per function (recursion counted once)
  const inclusive = new Map();
  const childrenOf = (n) => (n.children ?? []).map((c) => nodes.get(c)).filter(Boolean);
  const root = profile.nodes[0];
  const onStack = new Map();
  const walk = (n) => {
    let t = self.get(n.id) ?? 0;
    const k = keyOf(n);
    onStack.set(k, (onStack.get(k) ?? 0) + 1);
    for (const c of childrenOf(n)) t += walk(c);
    onStack.set(k, onStack.get(k) - 1);
    if (!onStack.get(k)) inclusive.set(k, (inclusive.get(k) ?? 0) + t);
    return t;
  };
  walk(root);
  for (const [k, e] of byFn) e.incl = inclusive.get(k) ?? e.self;
  const rows = [];
  for (const e of byFn.values()) {
    const { functionName, url, lineNumber, columnNumber } = e.cf;
    const mapped = await mapPos(url, lineNumber, columnNumber);
    rows.push({
      fn: mapped?.name && functionName && mapped.name !== functionName ? `${functionName} (${mapped.name})` : functionName || mapped?.name || '(anonymous)',
      where: mapped ? `${mapped.cls ? mapped.cls + ' @ ' : ''}${mapped.source}:${mapped.line}` : url ? `${basename(url)}:${lineNumber + 1}:${columnNumber + 1}` : '(native)',
      category: categorize(functionName, mapped, url),
      selfMs: e.self,
      inclMs: e.incl,
    });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  const groups = new Map();
  for (const r of rows) groups.set(r.category, (groups.get(r.category) ?? 0) + r.selfMs);
  const durationMs = (profile.endTime - profile.startTime) / 1000;
  return {
    durationMs: r1(durationMs),
    sampledMs: r1(total),
    top: rows.slice(0, topN).map((r) => ({ ...r, selfMs: r1(r.selfMs), selfPct: r1((100 * r.selfMs) / total), inclMs: r1(r.inclMs) })),
    topInclusive: [...rows].sort((a, b) => b.inclMs - a.inclMs).filter((r) => !/^\((root|program|idle)\)$/.test(r.fn)).slice(0, 25).map((r) => ({ fn: r.fn, where: r.where, inclMs: r1(r.inclMs), inclPct: r1((100 * r.inclMs) / total) })),
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([category, ms]) => ({ category, ms: r1(ms), pct: r1((100 * ms) / total), msPerSec: r1((1000 * ms) / durationMs) })),
  };
}

async function summarizeHeapProfile(profile, seconds, frames) {
  const byFn = new Map();
  let total = 0;
  const walk = (n) => {
    if (n.selfSize) {
      const cf = n.callFrame;
      const k = `${cf.functionName}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
      const e = byFn.get(k) ?? { cf, bytes: 0 };
      e.bytes += n.selfSize;
      byFn.set(k, e);
      total += n.selfSize;
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(profile.head);
  const rows = [];
  for (const e of byFn.values()) {
    const mapped = await mapPos(e.cf.url, e.cf.lineNumber, e.cf.columnNumber);
    rows.push({
      fn: e.cf.functionName || mapped?.name || '(anonymous)',
      where: mapped ? `${mapped.cls ? mapped.cls + ' @ ' : ''}${mapped.source}:${mapped.line}` : e.cf.url ? basename(e.cf.url) : '(native)',
      category: categorize(e.cf.functionName, mapped, e.cf.url),
      bytes: e.bytes,
    });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  const groups = new Map();
  for (const r of rows) groups.set(r.category, (groups.get(r.category) ?? 0) + r.bytes);
  return {
    seconds,
    allocatedMB: r2(total / 1048576),
    MBperSec: r2(total / 1048576 / seconds),
    KBperFrame: frames ? r1(total / 1024 / frames) : null,
    top: rows.slice(0, 15).map((r) => ({ ...r, KBperSec: r1(r.bytes / 1024 / seconds) })),
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([category, b]) => ({ category, KBperSec: r1(b / 1024 / seconds) })),
  };
}

// ───────────────────────────── trace summary ─────────────────────────────
function summarizeTrace(trace, syncOffsetMs, windows) {
  const events = trace.traceEvents ?? trace;
  const threadName = new Map();
  const procName = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name);
    if (e.ph === 'M' && e.name === 'process_name') procName.set(e.pid, e.args?.name);
  }
  // the renderer main thread with the most events is the page
  const count = new Map();
  for (const e of events) if (e.ph === 'X') count.set(`${e.pid}:${e.tid}`, (count.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const pick = (name) => [...threadName.entries()].filter(([, n]) => n === name).map(([k]) => k).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))[0];
  const main = pick('CrRendererMain');
  const gpuMain = pick('CrGpuMain');
  const viz = pick('VizCompositorThread');
  const comp = pick('Compositor');
  const toPage = (ts) => ts / 1000 - syncOffsetMs;
  const threadEvents = (key) =>
    events
      .filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === key && e.dur !== undefined)
      .map((e) => ({ s: toPage(e.ts), e: toPage(e.ts + e.dur), name: e.name, cat: e.cat, args: e.args }))
      .sort((a, b) => a.s - b.s);
  const busy = (list, s, e) => {
    // union of intervals clipped to [s, e]
    let total = 0;
    let curS = -Infinity;
    let curE = -Infinity;
    for (const ev of list) {
      const a = Math.max(ev.s, s);
      const b = Math.min(ev.e, e);
      if (b <= a) continue;
      if (a > curE) {
        if (curE > curS) total += curE - curS;
        curS = a;
        curE = b;
      } else curE = Math.max(curE, b);
    }
    if (curE > curS) total += curE - curS;
    return total;
  };
  const threads = { main, gpuMain, viz, comp };
  const lists = {};
  for (const [k, key] of Object.entries(threads)) lists[k] = key ? threadEvents(key) : [];
  const out = { threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, v ? threadName.get(v) + ' pid ' + v.split(':')[0] : null])), windows: [] };
  const topNames = (list, s, e, n = 8) => {
    const m = new Map();
    for (const ev of list) {
      const a = Math.max(ev.s, s);
      const b = Math.min(ev.e, e);
      if (b <= a) continue;
      m.set(ev.name, (m.get(ev.name) ?? 0) + (b - a));
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([name, ms]) => ({ name, ms: r1(ms) }));
  };
  // self time per event (duration minus direct children), for every thread of the GPU process
  const gpuPid = gpuMain ? gpuMain.split(':')[0] : null;
  const gpuThreads = new Map();
  if (gpuPid) {
    for (const e of events) {
      if (e.ph !== 'X' || String(e.pid) !== gpuPid || e.dur === undefined) continue;
      const k = `${e.pid}:${e.tid}`;
      if (!gpuThreads.has(k)) gpuThreads.set(k, []);
      gpuThreads.get(k).push({ s: toPage(e.ts), e: toPage(e.ts + e.dur), name: e.name, self: e.dur / 1000 });
    }
    for (const list of gpuThreads.values()) {
      list.sort((a, b) => a.s - b.s || b.e - a.e);
      const stack = [];
      for (const ev of list) {
        while (stack.length && stack.at(-1).e <= ev.s) stack.pop();
        if (stack.length) stack.at(-1).self -= ev.e - ev.s;
        stack.push(ev);
      }
    }
  }
  const gpuProcessThreads = (s, e) =>
    [...gpuThreads.entries()]
      .map(([k, list]) => {
        const selfBy = new Map();
        for (const ev of list) {
          const ov = Math.min(ev.e, e) - Math.max(ev.s, s);
          if (ov <= 0) continue;
          const frac = ov / Math.max(1e-6, ev.e - ev.s);
          selfBy.set(ev.name, (selfBy.get(ev.name) ?? 0) + Math.max(0, ev.self) * frac);
        }
        return {
          thread: threadName.get(k) ?? k,
          busyMs: r1(busy(list, s, e)),
          topSelf: [...selfBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, ms]) => ({ name, ms: r1(ms) })),
        };
      })
      .filter((t) => t.busyMs > 0 && t.thread !== 'GpuVSyncThread')
      .sort((a, b) => b.busyMs - a.busyMs)
      .slice(0, 6);
  for (const w of windows) {
    const len = w.end - w.start;
    const gcs = lists.main.filter((ev) => /^(MinorGC|MajorGC)$/.test(ev.name) && ev.s >= w.start && ev.s < w.end);
    const gcSum = (name) => gcs.filter((g) => g.name === name);
    const freed = gcs.reduce((a, g) => a + Math.max(0, (g.args?.usedHeapSizeBefore ?? 0) - (g.args?.usedHeapSizeAfter ?? 0)), 0);
    const minor = gcSum('MinorGC');
    const major = gcSum('MajorGC');
    out.windows.push({
      name: w.name,
      seconds: r1(len / 1000),
      busyMsPerSec: Object.fromEntries(Object.keys(threads).map((k) => [k, r1((busy(lists[k], w.start, w.end) * 1000) / len)])),
      gc: {
        minorCount: minor.length,
        minorMs: r1(minor.reduce((a, g) => a + (g.e - g.s), 0)),
        majorCount: major.length,
        majorMs: r1(major.reduce((a, g) => a + (g.e - g.s), 0)),
        perMinute: { count: r1(((minor.length + major.length) * 60000) / len), ms: r1(((minor.reduce((a, g) => a + (g.e - g.s), 0) + major.reduce((a, g) => a + (g.e - g.s), 0)) * 60000) / len) },
        longestMs: r1(Math.max(0, ...gcs.map((g) => g.e - g.s))),
        freedMBperSec: r2(freed / 1048576 / (len / 1000)),
      },
      topMain: topNames(lists.main, w.start, w.end),
      topGpuMain: topNames(lists.gpuMain, w.start, w.end),
      gpuProcessThreads: gpuProcessThreads(w.start, w.end),
    });
  }
  return { out, lists, busy, topNames, gpuProcessThreads };
}

// ───────────────────────────── driving ─────────────────────────────
const DRIVE_PATTERN = [
  ['KeyW', 2500],
  ['KeyD', 1100],
  ['KeyW', 2200],
  ['KeyA', 1100],
  ['KeyS', 1800],
  ['KeyW+KeyD', 1500],
  ['KeyS+KeyA', 1500],
  ['KeyW+KeyA', 1400],
];
async function drive(page, seconds) {
  const end = Date.now() + seconds * 1000;
  for (let i = 0; Date.now() < end; i++) {
    const [keys, ms] = DRIVE_PATTERN[i % DRIVE_PATTERN.length];
    const list = keys.split('+');
    for (const k of list) await page.keyboard.down(k);
    await sleep(Math.min(ms, Math.max(50, end - Date.now())));
    for (const k of [...list].reverse()) await page.keyboard.up(k);
  }
}

// ───────────────────────────── per-thread CPU of Chrome's processes (Windows) ─────────────────────────────
const ps = (script) =>
  new Promise((res) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 1 << 24 }, (err, out) => {
      if (err) return res(null);
      try {
        res(JSON.parse(out));
      } catch {
        res(null);
      }
    });
  });
async function discoverProcs(runId) {
  const list = await ps(
    "$all = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | Select-Object ProcessId, ParentProcessId, CommandLine; " +
      "$b = $all | Where-Object { $_.CommandLine -like '*" + runId + "*' -and $_.CommandLine -notlike '*--type=*' }; $out = @(); " +
      "foreach ($x in $b) { foreach ($k in ($all | Where-Object { $_.ParentProcessId -eq $x.ProcessId })) { if ($k.CommandLine -match '--type=([a-z-]+)') { $out += [pscustomobject]@{ pid = $k.ProcessId; type = $Matches[1] } } } }; " +
      'ConvertTo-Json -Compress -InputObject @($out)',
  );
  return Array.isArray(list) ? list.filter((p) => p.type === 'gpu-process' || p.type === 'renderer') : [];
}
async function sampleProcs(procs) {
  if (!procs.length) return null;
  return ps(
    '$o = @(Get-Process -Id ' + procs.map((p) => p.pid).join(',') + ' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid = $_.Id; cpu = $_.TotalProcessorTime.TotalMilliseconds; th = @($_.Threads | ForEach-Object { try { ,@($_.Id, $_.TotalProcessorTime.TotalMilliseconds) } catch { ,@($_.Id, 0) } }) } }); ' +
      'ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); p = $o })',
  );
}
/** CPU ms/s of the busiest thread (≈ main thread) and of the whole process, per process type. */
function procDelta(procs, a, b) {
  if (!a || !b) return null;
  const dt = b.t - a.t;
  const out = {};
  for (const pb of b.p ?? []) {
    const pa = (a.p ?? []).find((x) => x.pid === pb.pid);
    if (!pa) continue;
    const type = procs.find((x) => x.pid === pb.pid)?.type ?? '?';
    const thA = new Map();
    for (const t of pa.th ?? []) thA.set(t[0], t[1]);
    const deltas = (pb.th ?? []).map(([id, ms]) => ms - (thA.get(id) ?? ms)).sort((x, y) => y - x);
    const e = { pid: pb.pid, totalMsPerSec: r1(((pb.cpu - pa.cpu) * 1000) / dt), mainMsPerSec: r1((deltas[0] * 1000) / dt), next: deltas.slice(1, 4).map((d) => r1((d * 1000) / dt)), seconds: r1(dt / 1000) };
    // the busiest renderer is the page
    if (!out[type] || out[type].totalMsPerSec < e.totalMsPerSec) out[type] = e;
  }
  return out;
}

// ───────────────────────────── main ─────────────────────────────
const gameUrl = (() => {
  const u = new URL(cfg.url);
  u.searchParams.set('skipMenu', '1');
  u.searchParams.set('autoui', '1');
  u.searchParams.set('level', cfg.level);
  if (cfg.q !== 'auto') u.searchParams.set('q', cfg.q);
  if (cfg.noui) u.searchParams.set('noui', '1');
  return u.toString();
})();

const RUN_ID = `harnest-perf-${process.pid}-${Date.now()}`;
// unquantized GPU timestamps; the unknown switch marks our Chrome processes for the per-thread CPU sampler
const extraArgs = ['--enable-webgpu-developer-features', `--${RUN_ID}`];
if (cfg.uncapped) extraArgs.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
const browser = await launchBrowser({ browser: cfg.browser, headless: !cfg.headed, webgpu: cfg.webgpu, extraArgs });
const result = { config: { ...cfg, gameUrl }, problems: [] };
let exitCode = 0;
try {
  const { page, problems } = await openPage(browser, { width: cfg.w, height: cfg.h, scale: cfg.scale });
  await page.addInitScript(pageInstrument, { gpuTimerAtLoad: false });
  const cdp = await page.context().newCDPSession(page);
  const api = (body) => page.evaluate(`(() => { const H = window.__harnest; const P = window.__perf; ${body} })()`);
  const waitFor = async (expr, timeout = 10000) => {
    try {
      await page.waitForFunction(expr, undefined, { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const mark = (name) => page.evaluate((n) => window.__perf.mark(n), name);

  let traceSync = null;
  const startTrace = async () => {
    await browser.startTracing(page, {
      categories: ['devtools.timeline', 'toplevel', 'gpu', 'v8', 'blink.user_timing', 'disabled-by-default-devtools.timeline', ...cfg.categories],
    });
    await sleep(100);
    await syncTrace();
  };
  // a TimeStamp event carrying performance.now() of the current document: aligns trace time with page time
  const syncTrace = async () => {
    traceSync = await page.evaluate(() => {
      const t = performance.now();
      console.timeStamp(`perfsync:${t}`);
      return t;
    });
  };
  const stopTrace = async () => {
    const buf = await browser.stopTracing();
    const trace = JSON.parse(buf.toString('utf8'));
    const events = trace.traceEvents ?? trace;
    const ev = events
      .filter((e) => e.name === 'TimeStamp' && String(e.args?.data?.message ?? '').startsWith('perfsync:'))
      .sort((x, y) => x.ts - y.ts)
      .at(-1);
    const pageT = ev ? Number(String(ev.args.data.message).split(':')[1]) : traceSync;
    const offset = ev ? ev.ts / 1000 - pageT : null;
    return { trace, offset, bytes: buf.length };
  };

  // ── load ──
  const traceLoad = cfg.trace && (cfg.scenario === 'load' || cfg.scenario === 'events');
  if (traceLoad) {
    await page.goto('about:blank');
    await startTrace();
  }
  const navStart = Date.now();
  let loadProfile = null;
  if (cfg.profileLoad) {
    // CPU profile from the navigation commit to `playing` (500 µs sampling)
    await page.goto(gameUrl, { waitUntil: 'commit', timeout: 120000 });
    const s = await page.context().newCDPSession(page);
    await s.send('Profiler.enable');
    await s.send('Profiler.setSamplingInterval', { interval: 500 });
    await s.send('Profiler.start');
    const pageAtStart = (await s.send('Runtime.evaluate', { expression: 'performance.now()', returnByValue: true })).result.value;
    loadProfile = { session: s, pageAtStart };
    await page.waitForLoadState('load', { timeout: 120000 });
  } else {
    await page.goto(gameUrl, { waitUntil: 'load', timeout: 120000 });
  }
  const ready = await waitReady(page, undefined, 240000);
  const playing = ready && (await waitFor(`window.__harnest?.state() === 'playing'`, 120000));
  result.wallMs = { ready: Date.now() - navStart };
  if (loadProfile) {
    const { profile } = await loadProfile.session.send('Profiler.stop');
    if (artifacts) {
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(resolve(artifacts, `${tag}.load.cpuprofile`), JSON.stringify(profile));
    }
    loadProfile.profile = profile;
  }
  if (!playing) {
    problems.push(`[perf] never reached playing (ready=${ready}, state=${await api('return H?.state?.()').catch(() => '?')})`);
    throw new Error('not playing');
  }
  const hookError = await api('return P.hookError');
  if (hookError) console.warn('[perf] hook error:', hookError);
  result.gpu = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter?.();
    const i = a?.info ?? {};
    return { vendor: i.vendor, architecture: i.architecture, description: i.description, backend: window.__harnest.backend, ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] };
  });
  result.snapshotAtPlaying = await api('return P.snapshot()');
  if (traceLoad) await syncTrace();
  await mark('playing');

  // ── scenarios ──
  const segments = [];
  const procs = cfg.proc ? await discoverProcs(RUN_ID) : [];
  result.procs = procs;
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const seg = async (name, fn, opts = {}) => {
    const sampleCpu = opts.proc && procs.length;
    const pa = sampleCpu ? await sampleProcs(procs) : null;
    await mark(`${name}:start`);
    const t0 = await page.evaluate(() => performance.now());
    await fn();
    const t1 = await page.evaluate(() => performance.now());
    await mark(`${name}:end`);
    const pb = sampleCpu ? await sampleProcs(procs) : null;
    const entry = { name, start: t0, end: t1 };
    if (pa && pb) entry.proc = { ...procDelta(procs, pa, pb), from: pa.t - timeOrigin, to: pb.t - timeOrigin };
    segments.push(entry);
  };
  const gpuTimer = (on) => page.evaluate((v) => window.__perf.setGpu?.(v), on);
  const featureRows = [];
  const soakRows = [];

  if (cfg.scenario === 'load' && cfg.reload) {
    // second load in the same browser: warm shader caches (Dawn / Chrome GPU disk cache), like a returning player
    result.firstLoad = await page.evaluate(() => {
      const P = window.__perf;
      const st = (to) => P.events.find((e) => e.type === 'state:changed' && e.to === to)?.t;
      let longest = 0;
      for (let i = 1; i < P.nRaf; i++) longest = Math.max(longest, P.raf[i] - P.raf[i - 1]);
      return { readyAt: P.readyAt, playingAt: st('playing'), longestFrame: longest, phases: P.compile.map((c) => ({ label: c.label, ms: Math.round(c.end - c.start) })), totals: P.totals };
    });
    await page.goto(gameUrl, { waitUntil: 'load', timeout: 120000 });
    if (!(await waitReady(page, undefined, 240000)) || !(await waitFor(`window.__harnest?.state() === 'playing'`, 120000))) throw new Error('reload never reached playing');
    console.log(`[perf] first load: ready ${Math.round(result.firstLoad.readyAt)} ms, playing ${Math.round(result.firstLoad.playingAt)} ms, longest frame ${Math.round(result.firstLoad.longestFrame)} ms; the report below is the second (warm) load`);
  }
  if (cfg.scenario === 'frames' || cfg.scenario === 'load') {
    await seg('settle', () => sleep(3000));
    if (cfg.scenario === 'frames') {
      if (cfg.gpuTimer) {
        // GPU timestamps per pass (+ submit→done latency): own segment, they load the GPU process
        await gpuTimer(true);
        await seg('idle-gputimer', () => sleep(5000));
        await gpuTimer(false);
        await sleep(1000);
      }
      if (cfg.trace && !cfg.profile) await startTrace();
      await seg('idle', () => sleep(cfg.idle * 1000), { proc: true });
      await seg('drive', () => drive(page, cfg.drive), { proc: true });
      if (cfg.profile) {
        // CPU profile over a second drive (the clean drive above stays uninstrumented)
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
        await seg('drive-cpuprofile', () => drive(page, cfg.drive));
        const { profile } = await cdp.send('Profiler.stop');
        if (artifacts) {
          mkdirSync(artifacts, { recursive: true });
          writeFileSync(resolve(artifacts, `${tag}.cpuprofile`), JSON.stringify(profile));
        }
        result.cpuProfile = await summarizeCpuProfile(profile);
        // allocation sampling (objects collected by GC included), idle vs drive, + trace for GC counts
        await cdp.send('HeapProfiler.enable');
        const alloc = async (name, fn) => {
          await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
          const f0 = await api('return P.nRaf');
          const t0 = Date.now();
          await seg(name, fn);
          const secs = (Date.now() - t0) / 1000;
          const f1 = await api('return P.nRaf');
          const { profile: hp } = await cdp.send('HeapProfiler.stopSampling');
          return summarizeHeapProfile(hp, secs, f1 - f0);
        };
        if (cfg.trace) await startTrace();
        result.allocIdle = await alloc('idle-alloc', () => sleep(Math.max(8, cfg.idle) * 1000));
        result.allocDrive = await alloc('drive-alloc', () => drive(page, cfg.drive));
        // heap growth (no forced GC) idle vs drive
        const heapSlope = async (name, fn, secs) => {
          const pts = [];
          const t0 = Date.now();
          const sampler = (async () => {
            while (Date.now() - t0 < secs * 1000) {
              const h = await cdp.send('Runtime.getHeapUsage');
              pts.push([(Date.now() - t0) / 1000, h.usedSize]);
              await sleep(250);
            }
          })();
          await seg(name, fn);
          await sampler;
          // allocation between GCs: sum of positive steps
          let up = 0;
          for (let i = 1; i < pts.length; i++) up += Math.max(0, pts[i][1] - pts[i - 1][1]);
          return { seconds: secs, growthMBperSec: r2(up / 1048576 / secs), heapMB: r1(pts.at(-1)[1] / 1048576) };
        };
        result.heapIdle = await heapSlope('idle-heap', () => sleep(10000), 10);
        result.heapDrive = await heapSlope('drive-heap', () => drive(page, 10), 10);
      }
    }
  } else if (cfg.scenario === 'events') {
    const spots = await api('return H.spots()');
    const lessons = await api(`const lv = H.internals.game.runtime.def; return { terminals: lv.lessons.terminals.map((t) => ({ id: t.id, requires: t.requires ?? [] })), npcs: lv.lessons.npcs.map((n) => n.id), chips: lv.lessons.chips.map((c) => c.id) };`);
    const state = () => api('return H.state()');
    // stable = the page is drawing and no frame in the last 1.5 s took > 50 ms
    const STABLE = `(() => { const P = window.__perf; const n = P.nRaf; const now = performance.now(); if (n < 2 || now - P.raf[n - 1] > 100) return false; for (let i = n - 1; i > 0 && P.raf[i] > now - 1500; i--) if (P.raf[i] - P.raf[i - 1] > 50) return false; return true; })()`;
    const stable = (timeout = 30000) => waitFor(STABLE, timeout);
    const step = (name, fn) =>
      seg(name, async () => {
        await fn();
        await sleep(300);
        await stable();
      });
    await step('settle', () => sleep(2000));
    // the first key press unlocks audio: CPU profile around it
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await step('first-move', () => drive(page, 1.2));
    const { profile: firstInput } = await cdp.send('Profiler.stop');
    result.firstInputProfile = await summarizeCpuProfile(firstInput, 15);
    const term = lessons.terminals.find((t) => !t.requires.length);
    if (term) {
      await step('teleport-terminal', async () => {
        await api(`H.teleport(${spots.terminals[term.id].col}, ${spots.terminals[term.id].row})`);
        await sleep(900);
      });
      await step('terminal', async () => {
        await waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(term.id)}`, 3000);
        await page.keyboard.press('KeyE');
        await waitFor(`window.__harnest.state() === 'terminal'`, 3000);
        await waitFor(`window.__harnest.state() === 'playing'`, 5000);
        await sleep(1200);
      });
    }
    const npc = lessons.npcs[0];
    if (npc) {
      await step('teleport-npc', async () => {
        await api(`H.teleport(${spots.npcs[npc].col}, ${spots.npcs[npc].row})`);
        await sleep(900);
      });
      await step('dialog', async () => {
        await waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(npc)}`, 3000);
        await page.keyboard.press('KeyE');
        await waitFor(`window.__harnest.state() === 'dialog'`, 3000);
        await waitFor(`window.__harnest.state() === 'playing'`, 5000);
        await sleep(1200);
      });
    }
    const chip = lessons.chips[0];
    if (chip) {
      await step('chip', async () => {
        await api(`H.teleport(${spots.chips[chip].col}, ${spots.chips[chip].row})`);
        await sleep(1500);
      });
    }
    await step('gate-open', async () => {
      await api('H.openGate()');
      await sleep(2000);
    });
    const first = await api('return H.level()');
    await step('exit-to-next-level', async () => {
      await api(`H.teleport(${spots.exit.col}, ${spots.exit.row})`);
      await waitFor(`window.__harnest.level() !== ${JSON.stringify(first)}`, 15000);
      await waitFor(`window.__harnest.state() === 'playing'`, 180000);
    });
    result.nextLevel = await api('return H.level()');
    result.snapshotNextLevel = await api('return P.snapshot()');
    await step('first-move-next-level', () => drive(page, 1.5));
    // the transitions the automatic picker makes (and the settings menu): each one settled before the next
    const from = await api('return H.internals.engine.preset.level');
    for (const q of from === 'high' ? ['medium', 'low', 'medium', 'high'] : ['high', 'medium', 'low', 'medium']) {
      await step(`quality→${q}`, async () => {
        await api(`H.internals.engine.setQuality(${JSON.stringify(q)})`);
        await sleep(500);
      });
    }
    result.state = await state();
  } else if (cfg.scenario === 'features') {
    // stand at the spawn, camera settled; every toggle is measured after a settle, then restored
    const measure = async (name, apply, restore, settle = 1500, secs = 4) => {
      if (apply) await api(apply);
      await page.evaluate(() => window.__perf.resetLabels());
      await sleep(settle);
      if (cfg.gpuTimer) {
        // per-pass GPU time first (the timer loads the GPU process), then frames + thread CPU without it
        await gpuTimer(true);
        await seg(`gpu:${name}`, () => sleep(3000));
        await gpuTimer(false);
        await sleep(600);
      }
      await seg(`feature:${name}`, () => sleep(secs * 1000), { proc: true });
      featureRows.push({ name, start: segments.at(-1).start, end: segments.at(-1).end });
      if (restore) {
        await api(restore);
        await sleep(settle);
      }
    };
    await sleep(2500);
    const B = 'const E = H.internals.engine; const L = H.internals.game.runtime.built; const p = E.preset;';
    await measure('baseline', null, null);
    await api(`${B} window.__levelGroup = L.group; window.__vis = L.group.children.map((c) => [c.name || c.type, c.visible]);`);
    await measure('shadows off', `${B} E.renderer.shadowMap.enabled = false;`, `${B} E.renderer.shadowMap.enabled = p.shadows;`);
    await measure('reflection off', `${B} L.applyPreset({ ...p, reflection: 0 });`, `${B} L.applyPreset(p);`, 3000);
    await measure('bloom scale 0.25', `${B} E.post.bloom.setResolutionScale(0.25);`, `${B} E.post.bloom.setResolutionScale(p.bloomScale);`);
    await measure('bloom scale 1.0', `${B} E.post.bloom.setResolutionScale(1);`, `${B} E.post.bloom.setResolutionScale(p.bloomScale);`);
    await measure('msaa 0', `${B} E.post.setPreset({ ...p, msaa: 0 });`, `${B} E.post.setPreset(p);`, 3000);
    await measure('rain 0', `${B} L.rain.setAmount(0);`, `${B} L.applyPreset(p);`);
    await measure('abyss lights 0 (hidden)', `${B} L.backdrop.children.forEach((c) => { if (c !== L.rain.mesh) c.visible = false; });`, `${B} L.backdrop.children.forEach((c) => (c.visible = true));`);
    await measure('point lights budget 0', `${B} L.lights.setBudget(0);`, `${B} L.lights.setBudget(p.maxPointLights);`);
    await measure('point lights budget 6', `${B} L.lights.setBudget(6);`, `${B} L.lights.setBudget(p.maxPointLights);`);
    await measure('pixel ratio 0.75x', `${B} E.renderer.setPixelRatio(E.renderer.getPixelRatio() * 0.75); E.resize = E.resize; `, `${B} E.resize();`, 2000);
    // every direct child of the level group hidden in turn (static chunks, signs, ground, particles…)
    const kids = await api(`return H.internals.game.runtime.built.group.children.map((c, i) => ({ i, name: c.name || c.type, type: c.type }))`);
    const seen = new Map();
    for (const k of kids) {
      const key = k.name.replace(/[:#].*$/, '');
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(k.i);
    }
    for (const [name, idx] of seen) {
      const sel = `[${idx.join(',')}].map((i) => H.internals.game.runtime.built.group.children[i])`;
      await measure(`hide ${name}${idx.length > 1 ? ` (${idx.length})` : ''}`, `${sel}.forEach((c) => (c.userData.__v = c.visible, c.visible = false));`, `${sel}.forEach((c) => (c.visible = c.userData.__v ?? true));`);
    }
    // static merged group: its children by name
    const statics = await api(`const g = H.internals.game.runtime.built.group.children.find((c) => c.children.some((m) => m.isBatchedMesh || m.isMesh) && /static|merged|chunks/i.test(c.name)); return g ? g.children.map((c, i) => ({ i, name: c.name || c.type })) : []`);
    if (statics.length) {
      const byName = new Map();
      for (const s of statics) {
        const key = s.name.replace(/[-_:#]?\d+$/, '');
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(s.i);
      }
      for (const [name, idx] of byName) {
        const sel = `(() => { const g = H.internals.game.runtime.built.group.children.find((c) => c.children.some((m) => m.isBatchedMesh || m.isMesh) && /static|merged|chunks/i.test(c.name)); return [${idx.join(',')}].map((i) => g.children[i]); })()`;
        await measure(`hide static ${name} (${idx.length})`, `${sel}.forEach((c) => (c.visible = false));`, `${sel}.forEach((c) => (c.visible = true));`);
      }
    }
    await measure('player hidden', `H.internals.game.player.object.visible = false;`, `H.internals.game.player.object.visible = true;`);
    await measure('baseline (end)', null, null);
  } else if (cfg.scenario === 'soak') {
    const sample = async (label) => {
      const h = await cdp.send('Runtime.getHeapUsage');
      const snap = await api('return { ...P.snapshot(), dom: document.getElementsByTagName("*").length, level: H.level(), t: performance.now() }');
      soakRows.push({ label, heapMB: r1(h.usedSize / 1048576), heapTotalMB: r1(h.totalSize / 1048576), gpuMB: r1(snap.memory.total / 1048576), texMB: r1(snap.memory.texturesSize / 1048576), attrMB: r1((snap.memory.attributesSize + snap.memory.indexAttributesSize) / 1048576), geometries: snap.memory.geometries, textures: snap.memory.textures, programs: snap.memory.programs, renderTargets: snap.memory.renderTargets, pipelines: snap.pipelines, nodeStates: snap.nodeBuilderStates, dom: snap.dom, level: snap.level, t: r1(snap.t / 1000) });
    };
    const gcSample = async (label) => {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await sample(`${label} (after GC)`);
    };
    await gcSample('start');
    const end = Date.now() + cfg.minutes * 60000;
    let i = 0;
    await mark('soak-drive:start');
    const t0 = await page.evaluate(() => performance.now());
    while (Date.now() < end) {
      await drive(page, 10);
      if (++i % 3 === 0) await sample(`drive ${Math.round((Date.now() - (end - cfg.minutes * 60000)) / 1000)} s`);
    }
    segments.push({ name: 'soak-drive', start: t0, end: await page.evaluate(() => performance.now()) });
    await gcSample('after drive');
    const order = ['l2', 'l3', cfg.level === 'l1' ? 'l1' : cfg.level];
    for (const id of order) {
      await seg(`switch-${id}`, async () => {
        await api(`H.loadLevel(${JSON.stringify(id)})`);
        await waitFor(`window.__harnest.state() === 'playing' && window.__harnest.level() === ${JSON.stringify(id)}`, 180000);
        await sleep(2000);
      });
      await sample(`level ${id}`);
      await gcSample(`level ${id}`);
    }
  }

  let traceResult = null;
  if (cfg.trace && (traceLoad || cfg.scenario === 'frames' || cfg.scenario === 'features' || cfg.scenario === 'soak')) {
    try {
      traceResult = await stopTrace();
    } catch (e) {
      console.warn('[perf] trace failed', e.message);
    }
  }

  // ── collect ──
  const raw = await page.evaluate(() => {
    const P = window.__perf;
    return {
      raf: Array.from(P.raf.subarray(0, P.nRaf)),
      rec: Array.from(P.rec.subarray(0, P.nRec * 16)),
      lat: Array.from(P.lat.subarray(0, P.nRec)),
      measures: performance.getEntriesByType('measure').map((m) => ({ name: m.name, start: m.startTime, dur: m.duration })),
      gpu: Array.from(P.gpu.subarray(0, P.nGpu * 3)),
      labels: P.labels,
      events: P.events,
      logs: P.logs,
      marks: P.marks,
      loaf: P.loaf,
      longtasks: P.longtasks,
      pipeLog: P.pipeLog,
      nodeLog: P.nodeLog,
      compile: P.compile,
      totals: P.totals,
      readyAt: P.readyAt,
      backend: P.backend,
      nav: performance.getEntriesByType('navigation').map((e) => ({ responseEnd: e.responseEnd, domContentLoaded: e.domContentLoadedEventEnd, load: e.loadEventEnd }))[0],
      resources: performance.getEntriesByType('resource').map((e) => ({ name: e.name.replace(location.origin, ''), start: e.startTime, end: e.responseEnd, dur: e.duration, size: e.encodedBodySize || e.transferSize, type: e.initiatorType })),
      snapshot: window.__perf.snapshot ? window.__perf.snapshot() : null,
    };
  });
  result.snapshotEnd = raw.snapshot;
  result.measures = raw.measures.map((m) => ({ name: m.name, at: r1(m.start), ms: r1(m.dur) }));
  result.backend = raw.backend;

  // frames
  const frames = [];
  for (let i = 1; i < raw.raf.length; i++) frames.push({ t: raw.raf[i - 1], dt: raw.raf[i] - raw.raf[i - 1] });
  const recs = [];
  for (let o = 0; o < raw.rec.length; o += 16) {
    const R = raw.rec;
    recs.push({ lat: raw.lat[o / 16] >= 0 ? raw.lat[o / 16] : undefined, raf: R[o], start: R[o + 1], end: R[o + 2], cpu: R[o + 2] - R[o + 1], upd: R[o + 3], ren: R[o + 4], nb: R[o + 5], nbMs: R[o + 6], ps: R[o + 7], pa: R[o + 8], pMs: R[o + 9], pr: R[o + 10], prMs: R[o + 11], tx: R[o + 12], txMs: R[o + 13], draws: R[o + 14], frame: R[o + 15] });
  }
  const recByRaf = new Map();
  for (const r of recs) if (!recByRaf.has(r.raf)) recByRaf.set(r.raf, r);
  const gpuByFrame = new Map();
  const gpuPassByFrame = new Map();
  for (let o = 0; o < raw.gpu.length; o += 3) {
    const f = raw.gpu[o];
    const li = raw.gpu[o + 1];
    const ms = raw.gpu[o + 2];
    gpuByFrame.set(f, (gpuByFrame.get(f) ?? 0) + ms);
    let m = gpuPassByFrame.get(f);
    if (!m) gpuPassByFrame.set(f, (m = new Map()));
    m.set(li, (m.get(li) ?? 0) + ms);
  }
  const friendly = (label) => {
    if (/^ShadowMap/.test(label)) return 'shadow map';
    if (/^output /.test(label)) return 'scene pass';
    if (/^rt .* d2$/.test(label) || /^rt .*msaa/.test(label)) return 'reflection';
    if (/^UnrealBloomPass\.bright/.test(label)) return 'bloom: bright';
    if (/^UnrealBloomPass\.[hv]/.test(label)) return 'bloom: blur mips';
    if (/^UnrealBloomPass|Bloom/.test(label)) return 'bloom: other';
    if (/^canvas/.test(label)) return 'output (tone map → canvas)';
    return label;
  };
  const segStats = (s) => {
    const fr = frames.filter((f) => f.t >= s.start && f.t + f.dt <= s.end + 0.5);
    const rs = recs.filter((r) => r.raf >= s.start && r.raf <= s.end);
    const gpuF = rs.map((r) => gpuByFrame.get(r.frame)).filter((x) => x !== undefined);
    const passes = new Map();
    let nPassFrames = 0;
    for (const r of rs) {
      const m = gpuPassByFrame.get(r.frame);
      if (!m) continue;
      nPassFrames++;
      for (const [li, ms] of m) {
        const k = friendly(raw.labels[li] ?? String(li));
        passes.set(k, (passes.get(k) ?? 0) + ms);
      }
    }
    const dts = fr.map((f) => f.dt);
    const st = stats(dts);
    let proc;
    if (s.proc) {
      const n = raw.raf.filter((t) => t >= s.proc.from && t <= s.proc.to).length;
      const fps = n / ((s.proc.to - s.proc.from) / 1000);
      proc = { fps: r1(fps) };
      for (const k of ['gpu-process', 'renderer']) {
        const p = s.proc[k];
        if (p) proc[k] = { mainMsPerSec: p.mainMsPerSec, totalMsPerSec: p.totalMsPerSec, mainMsPerFrame: r2(p.mainMsPerSec / fps), totalMsPerFrame: r2(p.totalMsPerSec / fps), otherThreads: p.next };
      }
    }
    return {
      proc,
      name: s.name,
      seconds: r1((s.end - s.start) / 1000),
      frames: { ...st, fps: st.mean ? r1(1000 / st.mean) : null, over50: dts.filter((x) => x > 50).length, over100: dts.filter((x) => x > 100).length, over250: dts.filter((x) => x > 250).length },
      cpu: { loop: stats(rs.map((r) => r.cpu)), update: stats(rs.map((r) => r.upd)), render: stats(rs.map((r) => r.ren)) },
      gpuLatency: stats(rs.map((r) => r.lat).filter((x) => x !== undefined)),
      gpu: { total: stats(gpuF), coverage: rs.length ? r2(gpuF.length / rs.length) : 0, passes: Object.fromEntries([...passes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v / Math.max(1, nPassFrames))])) },
      draws: stats(rs.map((r) => r.draws)).p50,
      syncCompiles: rs.reduce((a, r) => a + r.ps + r.nb, 0),
      textureUploadsPerFrame: rs.length ? r2(rs.reduce((a, r) => a + r.tx, 0) / rs.length) : 0,
      textureUploadMsPerFrame: rs.length ? r2(rs.reduce((a, r) => a + r.txMs, 0) / rs.length) : 0,
    };
  };
  result.segments = segments.map(segStats);

  // stalls
  const stallFrames = frames.filter((f) => f.dt > 50);
  const loafMapped = [];
  const stalls = [];
  for (const f of stallFrames) {
    const s = f.t;
    const e = f.t + f.dt;
    const rec = recByRaf.get(s);
    const evs = raw.events.filter((ev) => ev.t >= s - 150 && ev.t <= e + 30);
    const before = [...raw.events].reverse().find((ev) => ev.t <= s + 1);
    const markBefore = [...raw.marks].reverse().find((m) => m[1] <= e);
    const lo = raw.loaf.filter((l) => l.start < e && l.start + l.dur > s);
    const scripts = lo.flatMap((l) => l.scripts).sort((a, b) => b.dur - a.dur).slice(0, 3);
    const mappedScripts = [];
    for (const sc of scripts) {
      const m = await mapCharPos(sc.url, sc.pos);
      mappedScripts.push({ dur: r1(sc.dur), invoker: sc.inv, fn: sc.fn, where: m ? `${m.source}:${m.line}${m.name ? ' ' + m.name : ''}` : sc.url ? basename(sc.url) : '', layout: r1(sc.layout) });
    }
    const gpuMs = rec ? gpuByFrame.get(rec.frame) : undefined;
    const compilesNear = raw.pipeLog.filter((p) => p.t >= s - 5 && p.t <= e);
    const logsNear = raw.logs.filter((l) => l[0] >= s - 200 && l[0] <= e + 50).map((l) => `${r1(l[0] / 1000)}s ${l[2]}`);
    const phase = raw.compile.find((c) => c.start <= s && c.end >= s);
    let cause;
    const loafScript = scripts[0]?.dur ?? 0;
    if (rec && (rec.ps > 0 || rec.nb > 0)) cause = `sync shader/pipeline build in frame: ${rec.nb} node builds (${r1(rec.nbMs)} ms JS), ${rec.ps} new pipelines (${r1(rec.pMs)} ms JS)${rec.tx ? `, ${rec.tx} texture uploads (${r1(rec.txMs)} ms)` : ''}`;
    else if (rec && rec.cpu > 0.5 * f.dt) cause = `JS in frame ${r1(rec.cpu)} ms (update ${r1(rec.upd)}, render ${r1(rec.ren)})${rec.tx ? `, ${rec.tx} texture uploads (${r1(rec.txMs)} ms)` : ''}`;
    else if (loafScript > 0.4 * f.dt) cause = `JS task ${r1(loafScript)} ms: ${mappedScripts[0]?.fn || mappedScripts[0]?.invoker || '?'} ${mappedScripts[0]?.where ?? ''}`;
    else if (phase) cause = `inside ${phase.label} (async compile; main thread mostly free → GPU process busy)`;
    else if (gpuMs !== undefined && gpuMs > 0.5 * f.dt) cause = `GPU work ${r1(gpuMs)} ms`;
    else {
      const recent = raw.pipeLog.filter((p) => p.sync && p.t >= s - 600 && p.t < s + 1);
      cause = recent.length
        ? `GPU process compiling ${recent.length} pipelines created synchronously just before (CompileShaderDXC on CrGpuMain); main thread idle (${rec ? r1(rec.cpu) : '?'} ms JS)`
        : `main thread idle (${rec ? r1(rec.cpu) : '?'} ms JS) → GPU process / compositor (shader compile on first use, swapchain, texture upload)`;
    }
    stalls.push({
      at: r2(s / 1000),
      ms: r1(f.dt),
      cause,
      nearest: before ? `${before.type}${before.label ? ' ' + before.label : ''}${before.to ? ' →' + before.to : ''} (${r1(s - before.t)} ms before)` : null,
      segment: markBefore?.[0] ?? null,
      events: evs.map((ev) => `${ev.type}${ev.to ? '→' + ev.to : ''}${ev.label ? ' ' + ev.label : ''}${ev.ratio !== undefined ? ' ' + r2(ev.ratio) : ''}`).slice(0, 8),
      frame: rec ? { cpu: r1(rec.cpu), update: r1(rec.upd), render: r1(rec.ren), nodeBuilds: rec.nb, pipelinesSync: rec.ps, pipelinesAsync: rec.pa, programs: rec.pr, textures: rec.tx, gpuMs: r1(gpuMs) } : null,
      compiles: compilesNear.length ? summarizeMats(compilesNear) : undefined,
      loaf: lo.length ? { dur: r1(lo[0].dur), blocking: r1(lo[0].block), scripts: mappedScripts } : undefined,
      logs: logsNear.length ? logsNear.slice(0, 5) : undefined,
    });
    loafMapped.push(...mappedScripts);
  }
  result.stalls = stalls;

  // load breakdown
  const ev = raw.events;
  const firstState = (to) => ev.find((e) => e.type === 'state:changed' && e.to === to)?.t;
  const glbs = raw.resources.filter((r) => /\.glb$/.test(r.name));
  const js = raw.resources.filter((r) => /\.js$/.test(r.name));
  const progress = ev.filter((e) => e.type === 'loading:progress').map((e) => ({ t: r1(e.t), ratio: r2(e.ratio), label: e.label }));
  const compilePhases = raw.compile.map((c) => ({ label: c.label, start: r1(c.start), ms: r1(c.end - c.start) }));
  const precompileLog = raw.logs.filter((l) => /precompiled|\[level\]|\[assets\]|backend/.test(l[2])).map((l) => `${r1(l[0])} ms ${l[2]}`);
  const asyncPipes = raw.pipeLog.filter((p) => !p.sync);
  const syncPipes = raw.pipeLog.filter((p) => p.sync);
  result.load = {
    navResponseEnd: r1(raw.nav?.responseEnd),
    domContentLoaded: r1(raw.nav?.domContentLoaded),
    jsChunks: js.map((r) => ({ name: r.name, kB: Math.round(r.size / 1024), end: r1(r.end) })),
    glb: glbs.map((r) => ({ name: r.name.split('/').pop(), kB: Math.round(r.size / 1024), start: r1(r.start), end: r1(r.end) })),
    glbParsedAt: ev.filter((e) => e.type === 'loading:progress' && /\.glb$/.test(e.label ?? '')).map((e) => ({ file: e.label, t: r1(e.t) })),
    rendererInfoAt: r1(ev.find((e) => e.type === 'renderer:info')?.t),
    progress,
    compilePhases,
    readyAt: r1(raw.readyAt),
    introAt: r1(firstState('intro')),
    playingAt: r1(firstState('playing')),
    log: precompileLog,
    pipelines: {
      async: asyncPipes.length,
      sync: syncPipes.length,
      syncDuringCompile: syncPipes.filter((p) => p.phase).length,
      syncInPlay: syncPipes.filter((p) => !p.phase).length,
      byMaterial: summarizeMats(raw.pipeLog.filter((p) => p.t <= (raw.readyAt ?? Infinity))),
    },
    totals: Object.fromEntries(Object.entries(raw.totals).map(([k, v]) => [k, r1(v)])),
    syncNodeBuilds: (() => {
      // which render objects needed a synchronous TSL build, grouped by material / pass
      const m = new Map();
      for (const n of raw.nodeLog) {
        const k = `${n.phase || 'outside compile'} | ${n.shadowPass ? 'shadow pass' : `ctx ${n.ctx} d${n.depth}`} | ${n.mat}`;
        const e = m.get(k) ?? { key: k, n: 0, ms: 0, objects: new Set() };
        e.n++;
        e.ms += n.ms;
        e.objects.add(n.obj);
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.ms - a.ms).slice(0, 40).map((e) => ({ key: e.key, builds: e.n, ms: r1(e.ms), objects: [...e.objects].slice(0, 5).join(', ') }));
    })(),
    longTasksDuringLoad: raw.longtasks.filter((l) => l[0] < (firstState('playing') ?? Infinity)).sort((a, b) => b[1] - a[1]).slice(0, 8).map((l) => ({ at: r1(l[0]), ms: r1(l[1]) })),
  };
  // the long animation frames during load: which scripts
  const loadLoaf = raw.loaf.filter((l) => l.start < (firstState('playing') ?? Infinity)).sort((a, b) => b.dur - a.dur).slice(0, 8);
  result.load.longFrames = [];
  for (const l of loadLoaf) {
    const sc = [...l.scripts].sort((a, b) => b.dur - a.dur)[0];
    const m = sc ? await mapCharPos(sc.url, sc.pos) : null;
    result.load.longFrames.push({ at: r1(l.start), ms: r1(l.dur), script: sc ? `${r1(sc.dur)} ms ${sc.fn || sc.inv} ${m ? `${m.source}:${m.line}` : ''}` : null });
  }

  if (loadProfile?.profile) {
    const p = loadProfile.profile;
    const at = loadProfile.pageAtStart;
    const playingAt = firstState('playing') ?? Infinity;
    result.loadProfile = { overall: await summarizeCpuProfile(p, 30, { from: 0, to: playingAt, pageAtStart: at }), windows: [] };
    const wins = [
      ...loadLoaf.slice(0, 3).map((l) => ({ name: `long frame @${r1(l.start)} (${r1(l.dur)} ms)`, from: l.start, to: l.start + l.dur })),
      ...raw.compile.filter((c) => /compileAsync|compilePass/.test(c.label)).map((c) => ({ name: `${c.label} @${r1(c.start)} (${r1(c.end - c.start)} ms)`, from: c.start, to: c.end })),
    ];
    for (const w of wins) {
      const s = await summarizeCpuProfile(p, 12, { from: w.from, to: w.to, pageAtStart: at });
      result.loadProfile.windows.push({ name: w.name, sampledMs: s.sampledMs, groups: s.groups.slice(0, 8), top: s.top.slice(0, 12), topInclusive: s.topInclusive.slice(0, 15) });
    }
  }

  if (traceResult) {
    const windows = segments.map((s) => ({ name: s.name, start: s.start, end: s.end }));
    if (traceLoad) {
      windows.unshift({ name: 'load (nav → playing)', start: 0, end: firstState('playing') ?? raw.readyAt ?? 0 });
      for (const c of raw.compile) if (/compileAsync|compilePass|gpuIdle/.test(c.label)) windows.push({ name: c.label, start: c.start, end: c.end });
      for (const l of loadLoaf.slice(0, 3)) windows.push({ name: `long frame @${r1(l.start)}`, start: l.start, end: l.start + l.dur });
    }
    const tr = summarizeTrace(traceResult.trace, traceResult.offset ?? 0, windows);
    result.trace = { bytes: traceResult.bytes, aligned: traceResult.offset !== null, ...tr.out };
    // what each thread did during every stall
    for (const st of result.stalls) {
      const s = st.at * 1000;
      const e = s + st.ms;
      st.trace = {
        mainBusy: r1(tr.busy(tr.lists.main, s, e)),
        gpuMainBusy: r1(tr.busy(tr.lists.gpuMain, s, e)),
        gc: r1(tr.lists.main.filter((x) => /^(MinorGC|MajorGC)$/.test(x.name)).reduce((a, x) => a + Math.max(0, Math.min(x.e, e) - Math.max(x.s, s)), 0)),
        topGpuMain: tr.topNames(tr.lists.gpuMain, s, e, 4),
        topMain: tr.topNames(tr.lists.main, s, e, 4),
      };
    }
    if (artifacts) writeFileSync(resolve(artifacts, `${tag}.trace-summary.json`), JSON.stringify(result.trace, null, 1));
  }

  result.events = raw.events.map((e) => ({ ...e, t: r1(e.t) }));
  result.marks = raw.marks.map(([n, t]) => [n, r1(t)]);
  result.problems = problems;
  if (cfg.scenario === 'features') {
    const base = result.segments.find((s) => s.name === 'feature:baseline');
    const gbase = result.segments.find((s) => s.name === 'gpu:baseline');
    const gpm = (s) => s?.proc?.['gpu-process']?.mainMsPerFrame;
    result.features = result.segments
      .filter((s) => s.name.startsWith('feature:'))
      .map((s) => {
        const g = result.segments.find((x) => x.name === `gpu:${s.name.slice(8)}`);
        return {
          name: s.name.slice(8),
          frameP50: s.frames.p50,
          fps: s.frames.fps,
          gpuMs: g?.gpu.total.mean,
          dGpuMs: gbase && g?.gpu.total.mean !== undefined ? r2(g.gpu.total.mean - gbase.gpu.total.mean) : null,
          cpuMs: s.cpu.loop.mean,
          dCpuMs: base ? r2(s.cpu.loop.mean - base.cpu.loop.mean) : null,
          gpuProcMs: gpm(s),
          dGpuProcMs: base && gpm(s) !== undefined && gpm(base) !== undefined ? r2(gpm(s) - gpm(base)) : null,
          draws: s.draws,
          passes: g?.gpu.passes,
        };
      });
  }
  if (soakRows.length) result.soak = soakRows;
  if (cfg.scenario === 'events') {
    result.steps = segments.map((sg) => {
      const fr = frames.filter((f) => f.t >= sg.start - 1 && f.t < sg.end);
      const rs = recs.filter((r) => r.raf >= sg.start - 1 && r.raf < sg.end);
      const st = fr.filter((f) => f.dt > 50);
      return {
        step: sg.name,
        wallMs: r1(sg.end - sg.start),
        longestFrame: r1(Math.max(0, ...fr.map((f) => f.dt))),
        stallMs: r1(st.reduce((a, f) => a + f.dt, 0)),
        stalls: st.length,
        syncNodeBuilds: rs.reduce((a, r) => a + r.nb, 0),
        nodeBuildMs: r1(rs.reduce((a, r) => a + r.nbMs, 0)),
        syncPipelines: rs.reduce((a, r) => a + r.ps, 0),
        asyncPipelines: raw.pipeLog.filter((p) => !p.sync && p.t >= sg.start && p.t < sg.end).length,
      };
    });
  }

  // ── print ──
  printReport(result);
  if (cfg.out) {
    mkdirSync(dirname(cfg.out), { recursive: true });
    writeFileSync(cfg.out, JSON.stringify({ ...result, raw: { frames: frames.map((f) => [r2(f.t), r2(f.dt)]), pipeLog: raw.pipeLog, logs: raw.logs, loaf: raw.loaf } }, null, 1));
    console.log(`\nwrote ${cfg.out}`);
  }
  if (problems.length) exitCode = 1;
} catch (err) {
  console.error('[perf] failed:', err?.message ?? err);
  result.problems.push(String(err?.message ?? err));
  exitCode = 1;
} finally {
  await browser.close();
}
if (result.problems.length) {
  console.log('\nproblems:');
  for (const p of result.problems.slice(0, 20)) console.log('  ' + p);
}
process.exitCode = exitCode;

function summarizeMats(list) {
  const m = new Map();
  for (const p of list) {
    const k = p.mat;
    const e = m.get(k) ?? { mat: k, n: 0, ms: 0, sync: 0, objects: new Set() };
    e.n++;
    e.ms += p.ms;
    if (p.sync) e.sync++;
    e.objects.add(p.obj);
    m.set(k, e);
  }
  return [...m.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 25)
    .map((e) => ({ mat: e.mat, pipelines: e.n, sync: e.sync, jsMs: r1(e.ms), objects: [...e.objects].slice(0, 4).join(', ') }));
}

function printReport(res) {
  const c = res.config;
  const pad = (s, n) => String(s ?? '').padEnd(n);
  const lp = (s, n) => String(s ?? '').padStart(n);
  console.log(`\n=== HARNEST perf: ${c.level} q=${c.q} ${c.w}x${c.h}@${c.scale} ${res.backend ?? '?'} ${c.uncapped ? 'uncapped' : 'vsync'} ${c.headed ? 'headed' : 'headless'} scenario=${c.scenario}`);
  if (res.gpu) console.log(`gpu: ${res.gpu.vendor} ${res.gpu.architecture} ${res.gpu.description ?? ''} ${res.gpu.ua ?? ''}`);
  const s0 = res.snapshotAtPlaying;
  if (s0) console.log(`at playing: preset ${s0.preset}, canvas ${s0.canvas.join('x')} (pr ${s0.pixelRatio}), ${s0.pipelines} pipelines, ${s0.vertexShaders}+${s0.fragmentShaders} shaders, ${s0.renderContexts} render contexts, draws ${s0.render.drawCalls}, tris ${Math.round(s0.render.triangles / 1000)}k, GPU mem ${Math.round(s0.memory.total / 1048576)} MB (tex ${Math.round(s0.memory.texturesSize / 1048576)} MB)`);
  console.log('\nsegment            s    fps   p50    p90    p99    max  >50 | cpu loop p50/p90  upd   ren | gpu mean/p90  draws | submit→done p50/p90');
  for (const s of res.segments) {
    const f = s.frames;
    console.log(
      `${pad(s.name, 17)} ${lp(s.seconds, 4)} ${lp(f.fps, 5)} ${lp(f.p50, 5)} ${lp(f.p90, 6)} ${lp(f.p99, 6)} ${lp(f.max, 6)} ${lp(f.over50, 4)} | ${lp(s.cpu.loop.p50, 6)}/${pad(s.cpu.loop.p90, 6)} ${lp(s.cpu.update.p50, 5)} ${lp(s.cpu.render.p50, 5)} | ${lp(s.gpu.total.mean, 6)}/${pad(s.gpu.total.p90, 6)} ${lp(s.draws, 5)} | ${lp(s.gpuLatency.p50, 6)}/${s.gpuLatency.p90 ?? ''}`,
    );
  }
  const main = res.segments.find((s) => s.name === 'idle-gputimer') ?? res.segments.find((s) => s.name === 'gpu:baseline') ?? res.segments.find((s) => Object.keys(s.gpu.passes).length);
  if (main && Object.keys(main.gpu.passes).length) console.log(`\nGPU per pass (${main.name}, timestamp queries, ms/frame): total ${main.gpu.total.mean} | ` + Object.entries(main.gpu.passes).map(([k, v]) => `${k} ${v}`).join(' | '));
  const procRows = res.segments.filter((s) => s.proc);
  if (procRows.length) {
    console.log('\nthread CPU (Windows per-thread times, no tracing): ms per frame of the busiest thread / whole process');
    for (const s of procRows) {
      const g = s.proc['gpu-process'];
      const r = s.proc.renderer;
      console.log(`  ${pad(s.name, 30)} fps ${lp(s.proc.fps, 5)} | GPU-process main ${lp(g?.mainMsPerFrame, 6)} ms (${g?.mainMsPerSec} ms/s), process ${g?.totalMsPerFrame} | renderer main ${lp(r?.mainMsPerFrame, 6)} ms (${r?.mainMsPerSec} ms/s), process ${r?.totalMsPerFrame}`);
    }
  }
  if (res.features) {
    console.log('\nfeature                         frame p50  fps   gpu ms  Δgpu   js ms  Δjs  gpuproc ms Δgpuproc draws');
    for (const f of res.features) console.log(`${pad(f.name, 31)} ${lp(f.frameP50, 8)} ${lp(f.fps, 5)} ${lp(f.gpuMs, 7)} ${lp(f.dGpuMs, 6)} ${lp(f.cpuMs, 6)} ${lp(f.dCpuMs, 5)} ${lp(f.gpuProcMs, 9)} ${lp(f.dGpuProcMs, 8)} ${lp(f.draws, 5)}`);
  }
  const L = res.load;
  if (L) {
    console.log(`\nload: DCL ${L.domContentLoaded} ms, renderer ${L.rendererInfoAt} ms, ready ${L.readyAt} ms, intro ${L.introAt} ms, playing ${L.playingAt} ms`);
    console.log(`  GLB: ${L.glb.map((g) => `${g.name} ${g.kB} kB →${g.end}`).join(', ')}`);
    console.log(`  GLB parsed: ${L.glbParsedAt.map((g) => `${g.file}@${g.t}`).join(', ')}`);
    console.log(`  phases: ${L.compilePhases.map((p) => `${p.label} @${p.start} ${p.ms} ms`).join(' | ')}`);
    console.log(`  pipelines: ${L.pipelines.async} async (precompile), ${L.pipelines.sync} sync (${L.pipelines.syncDuringCompile} inside engine.compile, ${L.pipelines.syncInPlay} outside it: first frame / play); node builds sync ${L.totals.nodeBuilds} (${L.totals.nodeBuildMs} ms)`);
    for (const l of L.log) console.log(`  ${l}`);
    if (L.longFrames.length) console.log(`  longest frames during load: ${L.longFrames.slice(0, 5).map((l) => `@${l.at} ${l.ms} ms [${l.script ?? '-'}]`).join(' ; ')}`);
  }
  if (res.steps) {
    console.log('\nstep                       wall ms  longest  stall ms (n)  sync node builds (ms)  sync/async pipelines');
    for (const st of res.steps) console.log(`  ${pad(st.step, 24)} ${lp(st.wallMs, 8)} ${lp(st.longestFrame, 8)} ${lp(st.stallMs, 8)} (${st.stalls})  ${lp(st.syncNodeBuilds, 5)} (${st.nodeBuildMs})  ${st.syncPipelines}/${st.asyncPipelines}`);
  }
  if (res.measures?.length) console.log(`\nuser timing: ${res.measures.map((m) => `${m.name} @${m.at} ${m.ms} ms`).join(' | ')}`);
  if (res.stalls.length) {
    console.log(`\nstalls > 50 ms (${res.stalls.length}):`);
    for (const s of res.stalls.slice(0, 40)) {
      console.log(`  @${lp(s.at, 7)} s ${lp(s.ms, 6)} ms  [${s.segment ?? '-'}] ${s.cause}`);
      console.log(`             nearest: ${s.nearest ?? '-'}${s.events.length ? ' | ' + s.events.join(', ') : ''}${s.trace ? ` | trace: main ${s.trace.mainBusy} ms, gpu ${s.trace.gpuMainBusy} ms (${s.trace.topGpuMain.map((x) => x.name + ' ' + x.ms).join(', ')}), gc ${s.trace.gc} ms` : ''}`);
    }
  }
  if (res.loadProfile) {
    const o = res.loadProfile.overall;
    console.log(`\nload CPU profile (navigation → playing, ${o.sampledMs} ms sampled): groups`);
    for (const g of o.groups.slice(0, 10)) console.log(`  ${pad(g.category, 60)} ${lp(g.ms, 8)} ms ${lp(g.pct, 5)} %`);
    console.log('  top inclusive:');
    for (const t of o.topInclusive.slice(0, 15)) console.log(`  ${lp(t.inclMs, 8)} ms ${lp(t.inclPct, 5)} %  ${pad(t.fn, 40)} ${t.where}`);
    for (const w of res.loadProfile.windows) {
      console.log(`  ── ${w.name}: ${w.groups.slice(0, 4).map((g) => `${g.category} ${g.ms}`).join(' | ')}`);
      for (const t of w.topInclusive.slice(0, 8)) console.log(`     ${lp(t.inclMs, 8)} ms  ${pad(t.fn, 40)} ${t.where}`);
    }
  }
  if (res.cpuProfile) {
    const p = res.cpuProfile;
    console.log(`\nCPU profile (${p.durationMs} ms, 100 µs sampling) — groups by self time:`);
    for (const g of p.groups.slice(0, 16)) console.log(`  ${pad(g.category, 60)} ${lp(g.ms, 8)} ms ${lp(g.pct, 5)} %  ${lp(g.msPerSec, 6)} ms/s`);
    console.log('top functions by self time:');
    for (const t of p.top) console.log(`  ${lp(t.selfMs, 7)} ms ${lp(t.selfPct, 5)} %  ${pad(t.fn, 36)} ${t.where}`);
  }
  for (const [k, a] of [['idle', res.allocIdle], ['drive', res.allocDrive]]) {
    if (!a) continue;
    console.log(`\nallocations ${k}: ${a.MBperSec} MB/s, ${a.KBperFrame} KB/frame — ${a.groups.slice(0, 5).map((g) => `${g.category} ${g.KBperSec} KB/s`).join(' | ')}`);
    for (const t of a.top.slice(0, 8)) console.log(`  ${lp(t.KBperSec, 8)} KB/s  ${pad(t.fn, 32)} ${t.where}`);
  }
  if (res.heapIdle) console.log(`heap growth between GCs: idle ${res.heapIdle.growthMBperSec} MB/s, drive ${res.heapDrive.growthMBperSec} MB/s (heap ${res.heapDrive.heapMB} MB)`);
  if (res.trace) {
    console.log(`\ntrace (${Math.round(res.trace.bytes / 1048576)} MB, aligned ${res.trace.aligned}):`);
    for (const w of res.trace.windows) {
      console.log(`  ${pad(w.name, 22)} ${w.seconds} s, busy ms/s main ${w.busyMsPerSec.main} gpu ${w.busyMsPerSec.gpuMain} viz ${w.busyMsPerSec.viz} | GC ${w.gc.minorCount} minor ${w.gc.minorMs} ms, ${w.gc.majorCount} major ${w.gc.majorMs} ms (${w.gc.perMinute.count}/min, ${w.gc.perMinute.ms} ms/min, longest ${w.gc.longestMs}), freed ${w.gc.freedMBperSec} MB/s`);
      for (const t of (w.gpuProcessThreads ?? []).slice(0, 3)) console.log(`      gpu-process ${pad(t.thread, 22)} busy ${lp(t.busyMs, 8)} ms: ${t.topSelf.slice(0, 4).map((x) => `${x.name} ${x.ms}`).join(', ')}`);
    }
  }
  if (res.soak) {
    console.log('\nsoak:');
    for (const r of res.soak) console.log(`  ${pad(r.label, 26)} heap ${lp(r.heapMB, 6)} MB  gpu ${lp(r.gpuMB, 6)} MB (tex ${r.texMB}, attr ${r.attrMB})  geo ${r.geometries} tex ${r.textures} rt ${r.renderTargets} pipes ${r.pipelines} nodes ${r.nodeStates} dom ${r.dom} ${r.level}`);
  }
  const e = res.snapshotEnd;
  if (e) console.log(`\nend: ${e.pipelines} pipelines, ${e.vertexShaders}+${e.fragmentShaders} shaders, ${e.renderContexts} render contexts, GPU mem ${Math.round(e.memory.total / 1048576)} MB, geometries ${e.memory.geometries}, textures ${e.memory.textures}, render targets ${e.memory.renderTargets}`);
}
