# HARNEST

Browser game that teaches Claude Code: a small tracked robot repairs a neon robot city by operating
Claude Code in simulated terminals. three.js WebGPU + TSL, TypeScript, Vite. UI text is Russian.

Design, levels, asset and material contracts: `docs/GAME_DESIGN.md` — read it before changing anything.
Verified Claude Code facts for lesson content: `docs/claude-code-reference.md`.

## Commands

- `npm run dev` — dev server on http://127.0.0.1:5173 (strict port; usually already running — reuse it, never kill it)
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — vitest (content integrity, answer matching, logic)
- `npm run build` — typecheck + production build into `dist/`
- `node scripts/shot.mjs --out .shots/x.png --url "http://127.0.0.1:5173/?skipMenu=1&autoui=1"` — headless
  screenshot (real WebGPU) + console errors as JSON. Options are listed at the top of the script.
  Multi-step scenarios: write a script on top of `scripts/lib/browser.mjs`. Look at the PNG with the Read tool.

## Layout

| Path | What |
|---|---|
| `src/core/` | event bus + game states (`events.ts`), save/settings (`store.ts`) — shared contracts |
| `src/content/` | lesson and level data (`types.ts` is the contract, `match.ts` answer matching) |
| `src/engine/` | renderer, loop, input, camera, assets, quality presets, debug API |
| `src/render/` | TSL materials and effects: ground, neon, rain, fog, occlusion cut-out, post-processing |
| `src/world/` | level builder, collision, player, NPCs, interactables, game flow |
| `src/ui/` | DOM overlay: menus, HUD, dialog, terminal simulator, codex (`createUI`) |
| `src/audio/` | procedural WebAudio (`createAudio`) |
| `src/dev/` | dev helpers (`autoUI.ts`) |
| `blender/` | `.blend` sources, generator scripts, previews, manifests |
| `public/assets/models/` | exported GLB files |
| `tests/` | vitest |

The 3D game, the UI and audio talk **only through the event bus and the store**. The game owns the state machine.

## Rules

- Import three.js only as `three/webgpu`, TSL as `three/tsl`, extras as `three/addons/...`. Never import
  bare `'three'` (it would load a second copy of the library). Check APIs against the installed
  `node_modules/three` (r186) — do not write TSL from memory.
- TypeScript strict. No `any` in contracts; a local cast is fine where three's TSL typings fall short.
- No network requests at runtime except the app's own files. No external fonts, CDNs or analytics.
- Changing a shared contract (`src/core/*`, `src/content/types.ts`, `src/content/match.ts`, the asset or
  material names in the design doc): keep it minimal, keep it backward compatible, and say so in your report.
- Player-facing text is Russian, short and plain. Claude Code commands, flags, keys and file names are
  written exactly as in the real tool.
- Before reporting work as done: `npm run typecheck` and `npm run test` pass, and visual work is checked
  on a screenshot.
- Do not commit, push or switch branches unless the user asks.
