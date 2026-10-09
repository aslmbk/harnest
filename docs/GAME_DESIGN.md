# HARNEST — game design

A browser game that teaches people to use **Claude Code**. The player drives a small tracked robot
through a neon-lit, decaying robot city and repairs it by operating Claude Code in old terminals.

- Engine: three.js `WebGPURenderer` + TSL (WebGL2 fallback is automatic).
- UI language: **Russian**. Commands, flags and file names stay in English, exactly as in Claude Code.
- No external network assets. Everything is bundled or generated.

## 1. Fiction

**Нижний город** — a walled, many-levelled city under a dome. Humans are long gone; robots («жители») live
here. The city is run by **Ядро** (the Core), but its code has rotted: lights, pumps, lifts and gates fail,
and nobody remembers how to maintain them.

**ХАРНИ** (model HRN-1) — a small tracked maintenance robot, reactivated in a junk pile. The old city
terminals still run **Claude Code**, an AI agent that can read, edit and run code — but it needs an
operator. Harni does not write code himself: he learns to *direct Claude Code well*. Every district
repaired brings the city back to life. In the end the Core restarts and the whole city lights up.

Tone: warm, a little melancholic, gently funny. Robots speak simply. No real-world brands except
Claude Code / Claude / Anthropic. The setting is inspired by neon slum-cities with robot inhabitants,
and the hero by small tracked binocular-eyed robots, but **all designs and names are original**.

Mentors (one per level): **Пинг** (messenger drone, level 1), **Дед Кэш** (forgetful elder, level 2),
**Лямбда** (depot foreman, level 3), **Тётя Сима** (tool-market trader, level 4), **Крон** (tower keeper, level 5).

## 2. Core loop

1. Explore the district (WASD / arrows, camera follows).
2. Talk to residents (`E`) — they explain the problem in the fiction.
3. Use terminals (`E`) — a **simulated Claude Code session** opens. The player types real commands,
   presses real key combos, and answers permission prompts to get through a short scenario.
4. Collect optional **memory chips** — short extra tips.
5. All *required* terminals done → the district gate opens → drive through → level summary → next level.

Everything learned lands in the **Справочник** (codex) — a cheat sheet the player builds up.
Each terminal gives 1–3 stars: 3 = no hints, 2 = hints used, 1 = answer revealed.

## 3. Levels (curriculum)

Facts must match `docs/claude-code-reference.md` (verified against the official docs). When that file
and this table disagree, the reference wins.

| # | id | District | Topic | Terminals (required unless marked bonus) |
|---|----|----------|-------|------------------------------------------|
| 1 | l1 | Переулок Загрузки | First steps | **t1** start `claude`, ask in plain language · **t2** `/init` + CLAUDE.md, ask Claude to add a rule to it · **t3** a session started in Manual mode: the Bash permission dialog, `Esc` = No, leaving with `/exit` · **t4 bonus** specific prompts, `claude "task"`, `/help`, `?`, new line with `\` + Enter |
| 2 | l2 | Рынок Памяти | Context and memory | **t1** `@file` / `@folder` mentions and `! command` (Claude answers the output) · **t2** `/context`, `/clear` between tasks, `/compact focus on …` · **t3** CLAUDE.md layers (user / project / local), `/memory`, auto memory, "add this to CLAUDE.md" (the `#` shortcut no longer exists) · **t4 bonus** sessions: `claude -c`, `claude -r`, `/resume`, `/rename` |
| 3 | l3 | Депо Планов | Control | **t1** permission modes and the `Shift+Tab` cycle (auto → manual → accept edits → plan), reading the status line · **t2** plan mode, `/plan`, the approval dialog, Explore → Plan → Implement → Commit · **t3** `Esc` to interrupt, `Esc Esc` / `/rewind`, the rewind menu and its limits · **t4 bonus** `/permissions`, allow / deny rules, why `--dangerously-skip-permissions` is for sandboxes only · **t5 bonus** `/model`, `/effort`, `ultrathink`, giving Claude a check it can run |
| 4 | l4 | Квартал Инструментов | Extending | **t1** MCP: `claude mcp add --transport http …`, `claude mcp list`, `/mcp`, scopes and `.mcp.json` · **t2** skills (custom slash commands are the same thing): `SKILL.md`, `/name args`, `$ARGUMENTS` · **t3** hooks: events, matcher, exit code 2, `/hooks` is read-only · **t4 bonus** settings files and precedence, `/config`, plugins (`/plugin`) |
| 5 | l5 | Башня Ядра | Automation and scale | **t1** subagents: `.claude/agents/*.md`, own context, invoking by name or `@agent-name` (the `/agents` wizard is gone) · **t2** headless: `claude -p`, pipes, `--output-format json`, `--allowedTools` · **t3** parallel work: `claude --worktree`, `Ctrl+B`, `/tasks` · **t4** final exam «Перезапуск Ядра» (requires t1–t3): one full session combining the earlier levels · **t5 bonus** GitHub: `/install-github-app`, `@claude` in PRs |

Per level: **3–4 required terminals** forming a chain via `requires` + **1–2 bonus**, **2 NPCs** (the mentor +
one resident), **4 chips** (from the reference's "Tips" list), **2–3 zones**. A challenge has **4–7 steps** and
mixes step kinds.

Reality check that shapes the lessons: an interactive session **starts in auto mode** (`⏵⏵ auto mode on`), so
permission dialogs appear mainly in Manual mode; only the Bash permission dialog is verified word for word.

Teaching rules:
- A task states the *goal in the fiction*, never the literal answer. Hints go: nudge → stronger → nearly the answer.
- Every solved step prints realistic Claude Code output and one "why it matters" sentence.
- Teach judgement, not only syntax: when to `/clear`, when to plan first, why not to skip permissions.
- Accept reasonable variants of an answer (flags order, quotes, optional arguments).
- Later levels reuse earlier commands inside scenarios (spaced repetition).

Data format: `src/content/types.ts`. Exemplar: `src/content/levels/l1/`. Integrity test: `tests/content.test.ts`.

## 4. Camera, controls, feel

- **Camera**: perspective, FOV 35°, looking **north** (−Z), pitched ~52° below horizontal, ~17 m from the
  robot. Fixed yaw. Smooth follow with a little look-ahead. Mouse wheel zooms 12–24 m. In `terminal` and
  `dialog` states the camera eases in closer.
- **Movement**: screen-relative (W = north/up). Max 4.2 m/s, quick acceleration, smooth turning. The robot
  is a circle (r = 0.45 m) sliding along colliders.
- **Keys**: WASD/arrows move · `E`/`Enter`/`Space` interact · `Esc` pause · `Tab` codex · wheel zoom.
- **Robot life**: treads scroll with distance, body leans into acceleration, head turns to the nearest
  interactable, eyes blink and tilt for emotion, antenna wobbles, a headlamp lights the wet ground.

Because the camera looks north from the south, **tall things south of a walkable tile hide the player**.
Rules: (a) the level builder clamps building height by distance to the nearest walkable tile to the north,
derived from the camera rig itself (`src/engine/cameraParams.ts` → `maxBuildingHeight` in
`src/world/tiles.ts`): with the robot at the south edge of that walkable tile, the building's highest point
(parapet included) must stay below the bottom plane of the view frustum at the design distance and pitch,
and below the camera's zoom path (12–24 m) minus the near plane. Result by tile distance 1–9:
1, 1, 1, 1, 2, 4, 5, 5, 6 storeys — anything up to 4 tiles south of walkable ground is one storey, so signs
and wall props on such blocks belong on the ground storey; (b) tall materials get a dithered cut-out around
the camera→player line as a safety net; (c) level layouts prefer tall facades on the north side, low things
(railings, low blocks, void) on the south side.

## 5. World building

- Grid: 1 tile = 2 m (`TILE`), 1 storey = 3 m (`STORY`). Map legend: see `src/content/types.ts`.
- The level builder turns the map into: ground (procedural TSL material: wet slabs, puddles, grates),
  buildings (facade modules on every exposed face per storey + roof caps + parapets), low blocks,
  railings on floor/void edges, colliders.
- **Automatic dressing** (seeded by `mood.seed`): facade variety, lit windows, wall clutter (AC units,
  pipes, wall lamps), rooftop clutter, hanging cables between facing walls. Explicit `props` add hero pieces.
- **Neon signs** are generated at runtime from `signs[].text` (canvas → emissive). Signs spell Claude Code
  commands (`/init`, `claude -p`, `/compact`) and Russian shop words — the city itself is a cheat sheet.
- Below and beyond the playable terrace: the **abyss** — fog and the tiny lights of lower city levels.

Level moods: 1 rainy narrow alley, orange + cyan · 2 lantern-lit market, warm orange + pink ·
3 industrial depot, yellow + green, steam, dry · 4 tech bazaar, violet + green, rain ·
5 tower plaza, white-cyan + red, fog.

## 6. Look

Night. Deep teal-blue ambient, warm orange practical lights, saturated neon, wet reflective ground, thin
fog, light rain, drifting dust. Emissive surfaces bloom. The hero is Claude-orange so he always reads
against the cool background.

Rendering targets (quality presets low / medium / high, auto-picked by frame time):
bloom + tone mapping + vignette (all presets); wet ground with neon reflections (planar reflector or a
cheaper fake on low); rain streaks and puddle ripples; distance + height fog; one shadow-casting key
light, ≤ 24 un-shadowed point lights per level, blob shadow under characters; dithered occlusion cut-out.
Target: 60 fps at 1080p on a mid-range laptop GPU.

Performance rules (optimisation pass of 2026-10-09; keep them):
- Nothing compiles a shader after the loading screen. Every pipeline a level can need — scene,
  reflection, shadow and override passes, materials first seen later (gate sign, terminal pages) —
  is built inside `engine.compile` behind the loading screen (`src/engine/engine.ts`, `src/render/post.ts`).
- Quality presets change only parameters (DPR, target sizes, uniforms, draw ranges, light budget):
  never toggle `renderer.shadowMap.enabled` or `castShadow`, never rebuild materials. MSAA settles at a
  level build; a user-requested increase recompiles in place behind a short loading screen; an
  automatic step-up that needs more MSAA waits for the next build.
- three's light classes keep their names in production (`keepLightClassNames`): the minifier renaming
  them stops `DynamicLightsNode` batching and recompiles every lit material on each lamp toggle.
- A shadow-map size change (quality switch) gives every render object one full refresh
  (`fullRefreshAfterReallocation` in `src/render/atmosphere.ts`): three r186 alone rebuilds the bind
  groups only of objects that saw the size change, so after 2048 → 1024 → 2048 the rest kept the destroyed
  map and WebGPU dropped every frame that drew them (the picture froze outside the area seen meanwhile).
  The reallocated map is rendered at the next frame even with shadows off by then (two quality steps in
  one frame), so the objects that refresh bind its new texture, not one made at the old size.
  `scripts/motion-check.mjs` catches this class of bug; the frozen-shot harness cannot.
- Static geometry is baked in time slices behind the loading screen (`prepareStatic`) and merged into
  final arrays once; the DOM overlay warms Chrome's raster programs under the loading screen
  (`src/ui/warmup.ts`); the AudioContext is prepared during loading and only resumed on the gesture.
- Acceptance for any rendering change: `high` and `medium` stay pixel-identical to a baseline taken
  before the change (`scripts/visual-baseline.mjs` + `scripts/visual-compare.mjs --tol 1 --max-diff 0`);
  `low` may differ but must stay coherent. Stalls and load time: `scripts/perf.mjs` on a production build.

## 7. Assets (Blender → GLB)

Sources and generator scripts live in `blender/`; exports in `public/assets/models/`.

**Conventions** (all files):
- 1 unit = 1 m. Blender Z-up → glTF Y-up. **Front = Blender −Y = three.js +Z** (faces the camera at rot 0).
- One GLB holds many assets; **each asset is a root node named by its asset id**, exported at the origin.
- Transforms applied (rotation/scale); a node that the game animates has its **origin at the pivot**.
- No image textures. Look comes from **named materials** (below), bevels, and modelled detail.
  The runtime swaps every material for a TSL material chosen **by name**, so use the exact names.
  Optional: a vertex-colour layer with baked AO/dirt (multiplied into the base colour).
- Style: chunky, slightly stylised, mid-poly; bevelled hard edges; believable industrial detail
  (panel lines, bolts, vents, handles, cables, patched repairs); wear shown by material variation.
- Budgets (triangles): facade module 300–1 500 · prop 300–2 500 · NPC ≤ 8 000 · hero ≤ 20 000.
- Each export script also writes `blender/manifest/<file>.json`:
  `[{ id, size: [x, y, z], min: [...], max: [...], tris, materials: [...] }]` in three.js axes.

### 7.1 `robot.glb` — the hero

Root `Harni`, origin on the ground at the centre, facing +Z. About 0.85 m wide, 0.95 m long, 1.15 m tall.
A boxy tracked body, a neck, a head made of two binocular eye pods, two small arms with claw hands,
an antenna, a chest indicator. Original design; expressive and cute.

```
Harni
├─ Chassis                      track frames, axles
│  ├─ TrackL, TrackR            belts; material M_Track; UV.x runs along the loop, UV.y across
│  └─ WheelL1..3, WheelR1..3    spin about local X
└─ Body                         pivot: chassis top centre (leans, bobs)
   ├─ ArmL, ArmR                pivot: shoulder (swing about X); claw hands may be child nodes HandL/HandR
   ├─ Antenna                   pivot: its base
   └─ Neck                      pivot: neck base
      └─ Head                   pivot: neck top (yaw/pitch)
         └─ EyeL, EyeR          pivot: pod centre (roll about local Z for emotion); lens = M_EyeGlow
```

### 7.2 `npcs.glb` — residents

Roots `npc_tall` (≈1.7 m, lanky, monitor head), `npc_round` (≈1.1 m, barrel body), `npc_drone`
(≈0.5 m body hovering at ≈1.3 m; origin on the ground below). Each has child nodes `Body` and `Head`
(pivot at the neck) and a face screen mesh with material `M_NpcFace` (UV 0..1 across the screen, upright):
the game draws the face. Give them character: ponchos, hats, tool belts, patched plates.

### 7.3 `interactables.glb`

- `terminal` — street kiosk ≈ 0.8 × 0.6 × 1.5 m: old CRT on a stand, keyboard, cables. Screen mesh uses
  `M_TerminalScreen` (UV 0..1, upright), tilted slightly up so it reads from the camera.
- `gate` — industrial gate for a **4 m wide, 3.2 m high opening**: children `GateFrame`, `DoorL`, `DoorR`
  (each door 2 m wide; they slide apart along X), lamp with `M_GateLight`. Origin: ground, centre of opening.
- `chip` — memory cartridge ≈ 0.35 m with `M_ChipGlow` parts. Origin at its centre.

### 7.4 `kit_facades.glb` — buildings

Facade modules: **2 m wide × 3 m high**, origin at the bottom centre **on the wall plane**, front +Z.
Geometry stays within x ∈ [−1, 1], y ∈ [0, 3], z ∈ [−0.25, +0.30]; backs may be open.
Modules tile seamlessly side by side and stacked.

- Ground storey: `fac_g_plain`, `fac_g_door`, `fac_g_shutter`, `fac_g_window`, `fac_g_vent`
- Upper storeys: `fac_u_plain`, `fac_u_window`, `fac_u_window_lit`, `fac_u_balcony`, `fac_u_ac`, `fac_u_pipes`
- Roof: `roof_cap` (2 × 2 m slab, 0.15 thick, origin bottom centre), `roof_parapet` (2 m long, 0.4 high,
  0.2 thick, origin bottom centre on the outer wall plane, thickness toward −Z)
- Low blocks for 'o' tiles (fill a 2 × 2 m tile, ≈1.2 m high, origin bottom centre): `low_barrier`, `low_planter`, `low_crates`
- `railing` — 2 m segment along X, 1.0 m high, origin bottom centre

The main wall surface of every module uses **`M_Wall`** (neutral; the runtime tints it per building, so one
building reads as one colour). Trim, frames, ledges and details use fixed palette materials.
The main wall face lies on the wall plane (z = 0): two perpendicular walls meet cleanly at a corner.
`fac_corner` — corner trim for a convex corner (3 m high, origin on the corner edge at the bottom; fits the
corner between a +Z-facing wall extending toward −X and a +X-facing wall extending toward −Z).

### 7.5 `kit_props.glb` — props

Origin bottom centre unless noted; front +Z.

- Street: `barrel`, `crate`, `crate_stack`, `trash_bags`, `dumpster`, `vending` (lit front), `streetlamp`
  (≈3.2 m, bulb `M_LampWarm`), `bench`, `stall` (market stall ≈2 × 1 m with canopy), `crt_stack` (old TVs,
  screens `M_ScreenGlow`), `plant_pot`, `cable_spool`, `tires`, `steam_vent`, `manhole`
- Wall-mounted (origin on the wall plane, sticks out toward +Z): `ac_unit`, `pipe_v` (3 m run, origin at
  its bottom), `pipe_h` (2 m run), `awning` (2 m wide cloth canopy), `wall_lamp` (`M_LampWarm`), `fuse_box`, `vines`
- Hanging (origin at the top hook): `lantern` (`M_LanternGlow`)
- Rooftop: `water_tank`, `roof_vent`, `antenna`, `dish`, `roof_ac`
- Depot: `rail_straight` (2 m, tiles along Z, walkable), `rail_buffer`, `rail_signal` (`M_NeonRed` /
  `M_NeonGreen` lamps), `turntable` (⌀5 m, walkable), `locomotive` (nose +Z, cab `M_WindowLit`, headlamp),
  `gantry_crane` (4 m span, solid legs at x ±1.78, hook ≈ 3.3 m). Track: rails along Z at rot 0, gauge 1 m,
  rail heads 0.06 m (on the turntable 0.112 m), buffers 0.55 m.

### 7.6 Materials (exact names; Principled BSDF values to start from)

| Name | Colour | Metal | Rough | Emission |
|---|---|---|---|---|
| M_Wall | #9a968f | 0 | 0.90 | (tintable main wall surface of facade modules: the runtime multiplies it by a per-building colour) |
| M_NpcPaint | #8a9496 | 0.30 | 0.60 | (tintable main paint of NPC bodies: multiplied by a per-NPC colour) |
| M_Concrete | #6c7074 | 0 | 0.92 | |
| M_ConcreteDark | #3b3e42 | 0 | 0.95 | |
| M_Plaster | #8c8377 | 0 | 0.90 | |
| M_PlasterTeal | #3d6763 | 0 | 0.88 | |
| M_PlasterRust | #8a4a36 | 0 | 0.90 | |
| M_PlasterOchre | #a8843f | 0 | 0.90 | |
| M_Brick | #6b4335 | 0 | 0.95 | |
| M_RoofTar | #26282b | 0 | 0.85 | |
| M_MetalDark | #2c3035 | 0.85 | 0.50 | |
| M_MetalSteel | #7d858c | 0.90 | 0.40 | |
| M_MetalGalv | #8f979c | 0.80 | 0.50 | |
| M_MetalRust | #7b4b2c | 0.35 | 0.85 | |
| M_MetalYellow | #c9a227 | 0.30 | 0.60 | |
| M_MetalRed | #9c3327 | 0.30 | 0.60 | |
| M_MetalTeal | #2f6f73 | 0.30 | 0.60 | |
| M_Rubber | #19191b | 0 | 0.95 | |
| M_PlasticDark | #202327 | 0 | 0.60 | |
| M_PlasticLight | #c9c4b8 | 0 | 0.55 | |
| M_Wood | #6a4a30 | 0 | 0.85 | |
| M_WoodLight | #93704b | 0 | 0.85 | |
| M_Cardboard | #a5865a | 0 | 0.95 | |
| M_TarpBlue | #2c4d78 | 0 | 0.80 | |
| M_TarpOrange | #c2672c | 0 | 0.80 | |
| M_TarpGreen | #3d6b4f | 0 | 0.80 | |
| M_Paper | #d9cfbd | 0 | 0.90 | |
| M_Plant | #3c7a3b | 0 | 0.80 | |
| M_PlantDark | #24512b | 0 | 0.85 | |
| M_Trash | #1e2126 | 0 | 0.50 | |
| M_Cable | #121214 | 0 | 0.70 | |
| M_Glass | #0f1a22 | 0 | 0.08 | |
| M_WindowLit | #ffb866 | 0 | 0.5 | #ffb866 × 4 |
| M_WindowLitCool | #8fd8ff | 0 | 0.5 | #8fd8ff × 3 |
| M_LampWarm | #ffd9a3 | 0 | 0.5 | #ffd9a3 × 12 |
| M_LanternGlow | #ff9440 | 0 | 0.7 | #ff9440 × 6 |
| M_ScreenGlow | #37e6c8 | 0 | 0.3 | #37e6c8 × 3 |
| M_NeonPink | #ff2e88 | 0 | 0.4 | × 10 |
| M_NeonCyan | #19e3ff | 0 | 0.4 | × 10 |
| M_NeonOrange | #ff8a1f | 0 | 0.4 | × 10 |
| M_NeonGreen | #5dff7a | 0 | 0.4 | × 8 |
| M_NeonYellow | #ffe14a | 0 | 0.4 | × 8 |
| M_NeonViolet | #a66bff | 0 | 0.4 | × 10 |
| M_NeonRed | #ff3b30 | 0 | 0.4 | × 10 |
| M_HarniShell | #d97757 | 0.20 | 0.55 | (hero paint, Claude orange) |
| M_HarniShellDark | #8f4a33 | 0.20 | 0.65 | (worn / recessed shell) |
| M_HarniCream | #e8dcc6 | 0.10 | 0.60 | |
| M_Track | #1a1a1c | 0 | 0.90 | (runtime: scrolling tread pattern) |
| M_EyeGlow | #ffe9c4 | 0 | 0.2 | × 6 (runtime: blink, emotion) |
| M_HarniScreen | #19e3ff | 0 | 0.3 | × 3 (chest indicator) |
| M_TerminalScreen | #ff9a3c | 0 | 0.3 | × 2.5 (runtime: animated, colour by state) |
| M_NpcFace | #37e6c8 | 0 | 0.3 | × 2 (runtime: face) |
| M_GateLight | #ff3b30 | 0 | 0.4 | × 6 (runtime: red → green) |
| M_ChipGlow | #5dff7a | 0 | 0.4 | × 6 |

New materials are allowed when needed (`M_` prefix, descriptive name); list them in your report.

## 8. UI (DOM overlay)

Style «terminal noir»: dark glass panels, thin borders, Claude orange `#D97757` as the main accent, neon
cyan as the second; display font Tektur, mono font JetBrains Mono (both bundled via fontsource, Cyrillic).

Screens: loading · main menu (Продолжить / Новая игра / Уровни / Справочник / Настройки) · level intro
card · HUD (district + topic, objectives list, chips, interact prompt, toasts/barks) · dialog box
(portrait mood, typewriter, Enter/Space advances) · **terminal simulator** · chip tip card · codex ·
pause · settings (volumes, quality) · level summary (stars, recap, learned commands) · ending.

**Terminal simulator** — the heart of the game. It must *feel like Claude Code* (verified details:
`docs/claude-code-reference.md`, "Terminal look"): a compact session header (version, model, cwd), the `❯`
prompt on an input line between two horizontal rules, the status line under it (`⏵⏵ auto mode on (shift+tab
to cycle)`, `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`), `●` bullets for Claude and tool
calls, `⎿` for results, numbered permission dialogs with a `❯` cursor, a spinner with a verb while
"working". `Shift+Tab` cycles the mode at any Claude prompt, as in the real tool. Beside it: a task panel (mentor's instruction, step
counter, hint button, stars at stake). Wrong answers get a kind, specific reply; nothing is punished
beyond stars. Key-combo steps capture real keys (`Shift+Tab`, `Esc`, `Ctrl+C`…) and also offer on-screen
key buttons. The player can always leave (✕ button or `/exit`) and resume the challenge later from its start.

## 9. Audio

Procedural WebAudio only (no files): city hum + rain bed per level mood, motor whine tied to
`player:motion`, UI blips, typing ticks, success/error stingers, gate rumble, a soft generative pad as music.
Starts after the first user gesture; volumes from settings.

## 10. Runtime contracts

- Events and game states: `src/core/events.ts` (the game owns the state machine).
- Save data and settings: `src/core/store.ts`.
- Protocol example in code: `src/dev/autoUI.ts`.
- URL params: `?skipMenu=1` (start playing at once) · `level=l2` · `autoui=1` (auto-answer UI requests)
  · `noui=1` · `q=low|medium|high` · `debug=1` (colliders, stats) · `view=map` (orthographic top-down
  view of the whole level, for layout checks) · `freeze=<s>` (pinned simulation clock for deterministic
  frames, `src/engine/freeze.ts`) · `dryframe=0` / `forceframe=0` / `parcompile=0` (precompile A/B
  switches, `src/engine/params.ts`).
- Tooling: `scripts/perf.mjs` (frame cost, stalls with causes, load breakdown, soak; production build),
  `scripts/visual-baseline.mjs` / `scripts/visual-compare.mjs` (47 frozen shots per preset, pixel diff),
  `scripts/playthrough.mjs` (the whole game played with real keys in the real WebGPU build).
- `window.__harnest` (tests and screenshots): `ready`, `backend`, `state()`, `level()`, `player()`
  → `{ col, row }`, `teleport(col, row)`, `loadLevel(id)`, `completeTerminal(id)`, `openGate()`.
