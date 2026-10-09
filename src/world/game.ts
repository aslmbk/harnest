/**
 * Game flow: owns the state machine and implements every event of `src/core/events.ts`.
 * boot → menu (level as a living backdrop) → loading → intro → playing ⇄ dialog / terminal / paused →
 * levelComplete → next level or ending. Talks to the UI and audio only through the bus and the store.
 */
import * as THREE from 'three/webgpu';
import { getLevel, getNextLevel, LEVELS } from '../content';
import type { GameBus, GameState, InteractKind } from '../core/events';
import type { Store } from '../core/store';
import type { LevelDef } from '../content/types';
import type { AssetLibrary } from '../engine/assets';
import type { Engine } from '../engine/engine';
import type { Input } from '../engine/input';
import type { QualityPreset } from '../engine/quality';
import type { UrlParams } from '../engine/params';
import { prepareTerminalScreens, type MaterialLibrary } from '../render/materials';
import { occlusion } from '../render/occlusion';
import { Atmosphere } from '../render/atmosphere';
import { loadSignFonts, neonTexturesReady, prepareNeonSigns } from '../render/neon';
import { buildLevel, type BuiltLevel } from './builder';
import { prepareStatic } from './staticMesh';
import { ColliderSet, TileCollider, type CollisionSource, nearestFreeSpot } from './collision';
import { levelStats } from './conditions';
import { ChipEntity, GateEntity, NpcEntity, TerminalEntity, type Interactable } from './entities';
import { TILE, type DialogLine, type Mood } from '../content/types';
import { gateCollider, npcCollider, planLevel, terminalCollider, type LevelPlan } from './levelPlan';
import { PLAYER, Player, type Emotion } from './player';
import { LevelSession } from './session';
import { StateMachine } from './stateMachine';
import { facingToYaw, worldToTile } from './tiles';
import { buildMapMarkers } from './mapMarkers';
import { DebugDraw } from '../dev/debugDraw';
import { clockSeconds, enableFreeze } from '../engine/freeze';
import { yieldToMain } from '../engine/bounds';

export interface GameDeps {
  engine: Engine;
  bus: GameBus;
  store: Store;
  assets: AssetLibrary;
  materials: MaterialLibrary;
  input: Input;
  params: UrlParams;
}

interface LevelRuntime {
  def: LevelDef;
  plan: LevelPlan;
  built: BuiltLevel;
  root: THREE.Group;
  colliders: ColliderSet;
  sources: CollisionSource[];
  session: LevelSession;
  terminals: Map<string, TerminalEntity>;
  npcs: Map<string, NpcEntity>;
  chips: Map<string, ChipEntity>;
  gate: GateEntity;
}

type Prompt = { kind: InteractKind; id: string; label: string; locked: boolean } | null;

export interface TileSpot {
  col: number;
  row: number;
}

export interface DebugSpots {
  spawn: TileSpot;
  terminals: Record<string, TileSpot>;
  npcs: Record<string, TileSpot>;
  chips: Record<string, TileSpot>;
  zones: Record<string, TileSpot>;
  gate: TileSpot;
  exit: TileSpot;
}

const GATE_KEY = 'gate';

/** The robot's eyes for a dialog mood. */
const MOOD_EMOTION: Record<Mood, Emotion> = { neutral: 'neutral', happy: 'happy', excited: 'happy', worried: 'worried', thinking: 'curious' };

export class Game {
  readonly sm: StateMachine;
  readonly player: Player;
  readonly atmosphere: Atmosphere;
  private level: LevelRuntime | null = null;
  private prompt: Prompt = null;
  private target: Interactable | null = null;
  private playingSince = 0;
  private lastMotion = -1;
  private loadToken = 0;
  /** A level is being built or recompiled (boot, `enterLevel`, MSAA recompile): another load request is ignored. */
  private loading = false;
  private dialogNpc: string | null = null;
  /**
   * The dialog being shown: the line comes from the UI's `ui:dialogLine` (an index into the lines of
   * `dialog:start`), typing from its 'talk' sound. Drives the speaker's face and mouth.
   */
  private dialog: { lines: DialogLine[]; index: number; lastTalk: number } | null = null;
  private activeTerminal: string | null = null;
  /** The page is hidden or the window lost focus: the level clock stands still (the state does not change). */
  private away = false;
  private debugDraw: DebugDraw | null = null;
  private mapMarkers: THREE.Object3D | null = null;
  /**
   * Drawables of disposed levels whose render state the renderer still holds (released after the next
   * level's precompile, see `releaseRetired`).
   */
  private retired: THREE.Object3D[] = [];

  constructor(private readonly d: GameDeps) {
    if (d.params.freeze !== null) enableFreeze(d.params.freeze); // [freeze] before anything picks a phase
    this.sm = new StateMachine((from, to) => this.onState(from, to));
    this.atmosphere = new Atmosphere(d.engine.scene, d.engine.renderer);
    this.player = new Player(d.assets, d.materials);
    d.engine.scene.add(this.player.object);
    if (d.params.debug) this.debugDraw = new DebugDraw(d.engine.scene);
    d.engine.presetListeners.add((p) => {
      this.level?.built.applyPreset(this.worldPreset(p));
      this.atmosphere.setShadows(p.shadows, p.shadowMapSize);
    });
    this.atmosphere.setShadows(d.engine.preset.shadows, d.engine.preset.shadowMapSize);
    if (d.params.view === 'map') {
      d.engine.rig.mode = 'map';
      d.engine.syncCamera();
      this.atmosphere.setMapMode(true);
    }
    this.wireBus();
    // away from the game (tab hidden, window blurred): no auto-pause, the level clock just stops
    const away = () => (this.away = document.hidden || !document.hasFocus());
    addEventListener('blur', away);
    addEventListener('focus', away);
    document.addEventListener('visibilitychange', away);
  }

  get state(): GameState {
    return this.sm.state;
  }

  /**
   * The preset as the level applies it: with the engine's session MSAA (the reflection's render target
   * must match the scene pass), and no street reflection in the map view (it looks straight down and
   * would mirror an empty sky).
   */
  private worldPreset(p: QualityPreset): QualityPreset {
    const msaa = this.d.engine.msaa;
    return this.d.params.view === 'map' ? { ...p, msaa, reflection: 0 } : { ...p, msaa };
  }

  get levelId(): string | null {
    return this.level?.def.id ?? null;
  }

  get session(): LevelSession | null {
    return this.level?.session ?? null;
  }

  // ───────────────────────────── boot and levels ─────────────────────────────

  /** First level: straight into play with `skipMenu`, else as the menu backdrop. */
  async boot(): Promise<void> {
    const { params, store } = this.d;
    const fallback = LEVELS[0].id;
    const wanted = params.level ?? store.data.currentLevel ?? fallback;
    const levelId = LEVELS.some((l) => l.id === wanted) ? wanted : fallback;
    if (wanted !== levelId) console.warn(`[game] unknown level "${wanted}", using ${levelId}`);
    if (params.skipMenu) {
      await this.enterLevel(levelId);
    } else {
      this.loading = true;
      try {
        await this.buildLevel(levelId);
        this.resetLevel();
        // automatic quality: a short timed probe behind the loading screen, first load only
        await this.d.engine.probeQuality();
      } finally {
        this.loading = false;
      }
      this.d.bus.emit('loading:progress', { ratio: 1 });
      this.sm.go('menu', performance.now());
    }
  }

  /** Build (or rebuild) the world for a level. */
  private async buildLevel(levelId: string): Promise<void> {
    const { engine, assets, materials, bus } = this.d;
    const def = getLevel(levelId);
    this.disposeLevel();
    bus.emit('loading:progress', { ratio: 0.2, label: def.meta.title });
    const plan = planLevel(def.layout);
    // sign and screen canvases are drawn once: their fonts must be ready first
    await loadSignFonts([...def.layout.signs.map((s) => s.text), ...def.lessons.terminals.map((t) => t.title)]);
    // bake the static geometry in time slices while the loading screen animates (buildLevel then only uploads it)
    const p0 = performance.now();
    await prepareStatic(plan, def.layout.mood.seed, assets, materials);
    // pure work of the build (same results), each in a task of its own: the build's task gets shorter
    await yieldToMain();
    this.atmosphere.prepareMood(def.layout.mood);
    await yieldToMain();
    prepareNeonSigns(def.layout.signs);
    await yieldToMain();
    prepareTerminalScreens(def.lessons.terminals.flatMap((t, i) => (def.layout.terminals[t.id] ? [{ title: t.title, node: i + 1 }] : [])));
    await yieldToMain();
    performance.measure('level:prepare', { start: p0, end: performance.now(), detail: def.id });
    if (this.level) this.disposeLevel();
    const b0 = performance.now();
    // an MSAA count a preset asked for since the last build takes effect now, before the passes exist
    engine.settleMsaa();
    const built = buildLevel(def, plan, assets, materials, this.worldPreset(engine.preset), this.d.params.view !== 'map');
    // the map view is for layout checks: no lower-city lights or rain over the plan
    if (this.d.params.view === 'map') built.backdrop.visible = false;
    console.info(
      `[level] ${def.id}: ${built.instances} placements → ${built.staticRanges} batched ranges, ` +
        `${Math.round(built.staticTriangles / 1000)}k tris, ${plan.lights.length} lights`,
    );
    const root = new THREE.Group();
    root.name = `runtime:${def.id}`;
    root.add(built.group);

    const colliders = new ColliderSet();
    for (const b of plan.boxes) colliders.addBox(b);
    for (const c of plan.circles) colliders.addCircle(c);

    const terminals = new Map<string, TerminalEntity>();
    def.lessons.terminals.forEach((t, i) => {
      const spot = def.layout.terminals[t.id];
      if (!spot) return;
      const e = new TerminalEntity(t, spot, plan.grid, assets, materials, def.layout.mood.seed + i * 17, i + 1);
      e.light = built.lights.add(e.planLight());
      terminals.set(t.id, e);
      root.add(e.object);
      colliders.addBox(terminalCollider(e.pose), `terminal:${t.id}`);
    });
    const npcs = new Map<string, NpcEntity>();
    for (const n of def.lessons.npcs) {
      const spot = def.layout.npcs[n.id];
      if (!spot) continue;
      const e = new NpcEntity(n, spot, assets, materials);
      npcs.set(n.id, e);
      root.add(e.object);
      colliders.addCircle(npcCollider(n.model, spot.at), `npc:${n.id}`);
    }
    const chips = new Map<string, ChipEntity>();
    for (const c of def.lessons.chips) {
      const spot = def.layout.chips[c.id];
      if (!spot) continue;
      const e = new ChipEntity(c.id, spot.at, assets, materials);
      e.light = built.lights.add(e.planLight());
      chips.set(c.id, e);
      root.add(e.object);
    }
    const gate = new GateEntity(def.layout.gate, assets, materials);
    gate.light = built.lights.add(gate.planLight());
    root.add(gate.object);

    engine.scene.add(root);
    this.atmosphere.applyMood(def.layout.mood);
    // the shadow map is re-rendered only when one of these moves (the static level never does)
    this.atmosphere.setMovingCasters([this.player.object, ...root.children.filter((c) => c !== built.group)]);
    engine.rig.setLevelBounds(plan.bounds, plan.grid.walkBounds());
    this.level = {
      def,
      plan,
      built,
      root,
      colliders,
      sources: [new TileCollider(plan.grid), colliders],
      session: new LevelSession(def, this.d.store.level(def.id)),
      terminals,
      npcs,
      chips,
      gate,
    };
    if (this.d.params.view === 'map') {
      this.mapMarkers = buildMapMarkers(def, plan);
      engine.scene.add(this.mapMarkers);
    }
    this.debugDraw?.setLevel(plan, colliders);
    performance.measure('level:build', { start: b0, end: performance.now(), detail: def.id });
    bus.emit('loading:progress', { ratio: 0.6, label: def.meta.title });
    let lastRatio = 0;
    const c0 = performance.now();
    await engine.compile(
      (r) => {
        if (r - lastRatio < 0.05 && r < 1) return;
        lastRatio = r;
        bus.emit('loading:progress', { ratio: 0.6 + r * 0.35, label: def.meta.title });
      },
      (camera) => built.nestedPasses(camera),
      // the precompile frame renders the shadow map even when quality has shadows off (its pipelines)
      () => this.atmosphere.primeShadow(),
      // sign images paint in a worker (overlapping the precompile): the real frame uploads the final ones
      neonTexturesReady(),
      // every terminal screen page (a state change then only swaps textures)
      [...terminals.values()].flatMap((e) => e.screen.pages),
    );
    performance.measure('level:compile', { start: c0, end: performance.now(), detail: def.id });
    this.releaseRetired();
  }

  /**
   * The renderer keeps a render object (uniform buffers, bindings, node state, a hold on its pipeline) for
   * every drawable it has drawn, until the object or its material is disposed. A level's drawables with a
   * shared material (library materials, the static material) are never disposed with it, so each load
   * left ~200 uniform buffers and the objects behind. Disposing them (`Object3D.dispose`: only the
   * 'dispose' event) releases that state; it is done after the next level's precompile, so the
   * pipelines and shaders both levels use are already held by the new render objects and stay cached.
   */
  private releaseRetired(): void {
    const retired = this.retired;
    this.retired = [];
    for (const o of retired) THREE.Object3D.prototype.dispose.call(o);
  }

  /**
   * The shown level with the MSAA count a preset asked for since it was built: the scene pass and the
   * street reflection take the new count and every pipeline is precompiled for it (async, as at a level
   * build). Nothing is rebuilt: the robot, the progress and every entity stay as they are.
   */
  private async recompileLevel(lv: LevelRuntime): Promise<void> {
    const { engine, bus } = this.d;
    lv.built.setMsaa(engine.settleMsaa());
    let lastRatio = 0;
    await engine.compile(
      (r) => {
        if (r - lastRatio < 0.05 && r < 1) return;
        lastRatio = r;
        bus.emit('loading:progress', { ratio: 0.6 + r * 0.35, label: lv.def.meta.title });
      },
      (camera) => lv.built.nestedPasses(camera),
      () => this.atmosphere.primeShadow(),
    );
  }

  /** Back from the pause with more MSAA than the level has: a short loading screen, then play. */
  private async refreshMsaa(): Promise<void> {
    const lv = this.level;
    if (!lv || this.loading || !this.sm.go('loading', performance.now())) return;
    const token = ++this.loadToken;
    this.loading = true;
    try {
      this.d.bus.emit('loading:progress', { ratio: 0.6, label: lv.def.meta.title });
      await this.recompileLevel(lv);
    } finally {
      this.loading = false;
    }
    if (token !== this.loadToken) return;
    this.d.bus.emit('loading:progress', { ratio: 1, label: lv.def.meta.title });
    this.sm.go('playing', performance.now());
  }

  /** Restore the level from the save: session, terminals, chips, gate; the robot at the spawn. */
  private resetLevel(): void {
    const lv = this.level;
    if (!lv) return;
    lv.session = new LevelSession(lv.def, this.d.store.level(lv.def.id));
    for (const [id, chip] of lv.chips) {
      if (lv.session.chips.has(id)) chip.hide();
      else chip.show();
    }
    if (lv.session.gateOpen) {
      lv.gate.open(false);
      lv.colliders.remove(GATE_KEY);
    } else {
      lv.gate.close();
      if (!lv.colliders.has(GATE_KEY)) lv.colliders.addBox(gateCollider(lv.def.layout.gate), GATE_KEY);
    }
    this.refreshTerminals();
    const [col, row] = lv.def.layout.spawn.at;
    this.player.place(col * 2, row * 2, facingToYaw(lv.def.layout.spawn.facing));
    this.d.engine.rig.snap(this.player.x, this.player.z);
    this.atmosphere.follow(this.player.x, this.player.z);
    this.dialogNpc = null;
    this.dialog = null;
    this.activeTerminal = null;
  }

  /** loading → (build if needed) → restore progress → level:ready → intro. */
  async enterLevel(levelId: string, opts: { rebuild?: boolean } = {}): Promise<void> {
    // checked before leaving the current state: an unknown id would throw mid-load and strand the game in 'loading'
    if (!LEVELS.some((l) => l.id === levelId)) {
      console.warn(`[game] unknown level "${levelId}"`);
      return;
    }
    // two builds at once would interleave (only the debug API can ask while a load runs)
    if (this.loading) {
      console.warn(`[game] a level is loading: "${levelId}" ignored`);
      return;
    }
    this.loading = true;
    try {
      await this.loadLevel(levelId, opts);
    } finally {
      this.loading = false;
    }
  }

  private async loadLevel(levelId: string, opts: { rebuild?: boolean }): Promise<void> {
    const token = ++this.loadToken;
    const { bus, store } = this.d;
    if (!this.sm.go('loading', performance.now()) && this.sm.state !== 'loading') {
      console.warn(`[game] cannot load a level from state ${this.sm.state}`);
      return;
    }
    bus.emit('loading:progress', { ratio: 0, label: getLevel(levelId).meta.title });
    // the same level is rebuilt too when a preset raised MSAA since it was built (e.g. low → high in the menu)
    const { engine } = this.d;
    if (opts.rebuild || this.level?.def.id !== levelId || engine.msaaUpgradePending) await this.buildLevel(levelId);
    if (token !== this.loadToken) return;
    store.setCurrentLevel(levelId);
    this.resetLevel();
    // automatic quality: a short timed probe with the game camera, behind the loading screen (once)
    await engine.probeQuality();
    if (token !== this.loadToken) return;
    // the probe picked more MSAA than the level was built with (a stale cached pick): compile it in now
    if (engine.msaaUpgradePending && this.level) {
      await this.recompileLevel(this.level);
      if (token !== this.loadToken) return;
    }
    bus.emit('loading:progress', { ratio: 1, label: getLevel(levelId).meta.title });
    bus.emit('level:ready', { levelId });
    this.emitObjectives();
    this.sm.go('intro', performance.now());
  }

  private disposeLevel(): void {
    const lv = this.level;
    if (!lv) return;
    const t0 = performance.now();
    this.d.engine.scene.remove(lv.root);
    const nodes: THREE.Object3D[] = [];
    lv.root.traverse((o) => {
      nodes.push(o);
      const d = o as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
      if (d.isMesh || d.isLine || d.isPoints || d.isSprite) this.retired.push(o);
    });
    lv.built.dispose();
    for (const t of lv.terminals.values()) t.dispose();
    for (const n of lv.npcs.values()) n.dispose();
    for (const c of lv.chips.values()) c.dispose();
    lv.gate.dispose();
    if (this.mapMarkers) {
      this.d.engine.scene.remove(this.mapMarkers);
      this.mapMarkers.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      this.mapMarkers = null;
    }
    // The renderer can hold one of the level's objects for good: r186 keeps the first render object of
    // every geometry until that geometry is disposed, and shared model geometries never are. Taken out
    // of the tree, that object no longer keeps the rest of the level alive (≈ 60 MB per level).
    for (const o of nodes) {
      o.parent = null;
      o.children.length = 0;
    }
    this.level = null;
    performance.measure('level:dispose', { start: t0, end: performance.now(), detail: lv.def.id });
  }

  // ───────────────────────────── bus ─────────────────────────────

  private wireBus(): void {
    const { bus, store } = this.d;
    bus.on('ui:dialogLine', ({ npcId, index }) => {
      const dl = this.dialog;
      if (!dl || !this.sm.is('dialog') || npcId !== this.dialogNpc || !Number.isFinite(index) || !dl.lines.length) return;
      dl.index = Math.min(dl.lines.length - 1, Math.max(0, Math.floor(index)));
      dl.lastTalk = -1;
      this.applyDialogLine();
    });
    // the dialog box's typing blips: the speaker's mouth moves while text is being typed
    bus.on('sfx', ({ name }) => {
      if (name === 'talk' && this.dialog && this.sm.is('dialog')) this.dialog.lastTalk = performance.now();
    });
    bus.on('ui:play', ({ levelId, newGame }) => {
      if (!this.sm.is('menu', 'ending', 'paused', 'levelComplete', 'intro')) return;
      if (newGame) store.resetProgress();
      const first = LEVELS[0].id;
      const id = levelId ?? (newGame ? first : (store.data.currentLevel ?? first));
      void this.enterLevel(LEVELS.some((l) => l.id === id) ? id : first);
    });
    bus.on('ui:introDone', () => {
      if (this.sm.is('intro')) this.sm.go('playing', performance.now());
    });
    bus.on('ui:dialogDone', () => {
      if (this.sm.is('dialog')) this.sm.go('playing', performance.now());
    });
    bus.on('ui:terminalClosed', ({ terminalId, completed, stars }) => {
      // a late report (the game already left the terminal, maybe for another level) records nothing
      if (!this.sm.is('terminal')) return;
      if (completed && terminalId === this.activeTerminal) this.completeTerminal(terminalId, stars ?? 1);
      this.sm.go('playing', performance.now());
    });
    bus.on('ui:pause', () => {
      // only from 'playing': the UI closes the dialog / terminal overlay on 'paused' and would not reopen it
      if (this.sm.is('playing')) this.sm.go('paused', performance.now());
    });
    bus.on('ui:resume', () => {
      if (!this.sm.is('paused')) return;
      // the settings raised MSAA (low → medium / high): compiled in behind the loading screen first
      if (this.d.engine.msaaUpgradePending && this.level) void this.refreshMsaa();
      else this.sm.go(this.sm.resumeTo, performance.now());
    });
    bus.on('ui:restartLevel', () => {
      const id = this.levelId;
      if (id && this.sm.is('paused', 'playing', 'levelComplete', 'dialog', 'terminal')) void this.enterLevel(id);
    });
    bus.on('ui:quitToMenu', () => {
      if (this.sm.state !== 'menu' && this.sm.state !== 'boot') this.sm.go('menu', performance.now());
    });
    bus.on('ui:nextLevel', () => {
      if (!this.sm.is('levelComplete') || !this.levelId) return;
      const next = getNextLevel(this.levelId);
      if (next) void this.enterLevel(next.id);
      else this.sm.go('ending', performance.now());
    });
  }

  private onState(from: GameState, to: GameState): void {
    const { bus, engine, input } = this.d;
    input.enabled = to === 'playing';
    // the automatic quality judges play only (not menus, loads, cards or transitions)
    engine.setAutoQualityActive(to === 'playing');
    if (to === 'playing') this.playingSince = performance.now();
    if (from === 'dialog') {
      if (this.dialogNpc) this.level?.npcs.get(this.dialogNpc)?.setTalking(false);
      this.dialogNpc = null;
      this.dialog = null;
      this.player.setTalking(false);
      this.player.emote('neutral', 0);
    }
    if (from === 'terminal') this.activeTerminal = null;
    if (to !== 'playing') this.setPrompt(null);
    if (engine.rig.mode !== 'map') {
      engine.rig.mode = to === 'menu' || to === 'boot' ? 'menu' : to === 'dialog' || to === 'terminal' ? 'close' : 'follow';
    }
    occlusion.strength.value = engine.rig.mode === 'follow' || engine.rig.mode === 'close' ? 1 : 0;
    bus.emit('state:changed', { from, to });
  }

  // ───────────────────────────── gameplay ─────────────────────────────

  private emitObjectives(): void {
    const lv = this.level;
    if (!lv) return;
    this.d.bus.emit('objectives:changed', { levelId: lv.def.id, items: lv.session.objectives(), gateOpen: lv.session.gateOpen });
  }

  private refreshTerminals(): void {
    const lv = this.level;
    if (!lv) return;
    for (const [id, t] of lv.terminals) {
      t.setState(lv.session.done.has(id) ? 'done' : lv.session.isLocked(id) ? 'locked' : 'available');
    }
  }

  /** Record a finished terminal (stars, codex), refresh locks, open the gate when it is time. */
  completeTerminal(terminalId: string, stars: 1 | 2 | 3): boolean {
    const lv = this.level;
    if (!lv) return false;
    const lesson = lv.session.terminal(terminalId);
    if (!lesson) return false;
    const { store, bus } = this.d;
    store.completeTerminal(lv.def.id, terminalId, stars);
    store.unlockCodex(lesson.challenge.unlocks);
    const { fresh, openGate } = lv.session.completeTerminal(terminalId);
    this.refreshTerminals();
    // the UI already played 'challengeDone' when the challenge was solved
    if (fresh) this.player.emote('happy', 3);
    this.emitObjectives();
    if (openGate) this.openGate(true);
    return true;
  }

  openGate(animated = true): void {
    const lv = this.level;
    if (!lv || lv.gate.isOpen) return;
    lv.session.gateOpen = true;
    lv.gate.open(animated);
    lv.colliders.remove(GATE_KEY);
    const { bus } = this.d;
    bus.emit('gate:opened', { levelId: lv.def.id });
    bus.emit('sfx', { name: 'gateOpen' });
    bus.emit('toast', { text: 'Ворота открыты! Путь дальше свободен.', kind: 'success' });
    this.emitObjectives();
  }

  private completeLevel(): void {
    const lv = this.level;
    if (!lv || lv.session.completed) return;
    lv.session.completed = true;
    const { store, bus } = this.d;
    store.completeLevel(lv.def.id);
    const next = getNextLevel(lv.def.id);
    if (next) store.setCurrentLevel(next.id);
    const stats = levelStats(lv.def, store.level(lv.def.id), lv.session.elapsed);
    this.sm.go('levelComplete', performance.now());
    bus.emit('level:completed', { levelId: lv.def.id, stats, isLast: !next });
    bus.emit('sfx', { name: 'levelComplete' });
  }

  private setPrompt(p: Prompt): void {
    const same =
      p === this.prompt ||
      (p && this.prompt && p.kind === this.prompt.kind && p.id === this.prompt.id && p.locked === this.prompt.locked && p.label === this.prompt.label);
    if (same) return;
    this.prompt = p;
    this.d.bus.emit('interact:prompt', p);
  }

  /** Nearest interactable in reach (terminals, NPCs, the closed gate). */
  private findTarget(): Interactable | null {
    const lv = this.level;
    if (!lv) return null;
    let best: Interactable | null = null;
    let bestD = Infinity;
    const consider = (it: Interactable) => {
      const d = Math.hypot(it.x - this.player.x, it.z - this.player.z);
      if (d < it.radius && d < bestD) {
        best = it;
        bestD = d;
      }
    };
    for (const t of lv.terminals.values()) consider(t.interact);
    for (const n of lv.npcs.values()) consider(n.interact);
    if (!lv.gate.isOpen) consider(lv.gate.interact);
    return best;
  }

  /** Nearest thing worth looking at (for the robot's head), a bit further than the reach. */
  private findLook(): THREE.Vector3 | null {
    const lv = this.level;
    if (!lv) return null;
    let best: THREE.Vector3 | null = null;
    let bestD = 4.5;
    const consider = (p: THREE.Vector3, x: number, z: number) => {
      const d = Math.hypot(x - this.player.x, z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    };
    for (const t of lv.terminals.values()) consider(t.interact.look, t.pose.x, t.pose.z);
    for (const n of lv.npcs.values()) consider(n.interact.look, n.interact.x, n.interact.z);
    for (const c of lv.chips.values()) if (!c.collected) consider(c.look, c.x, c.z);
    return best;
  }

  private interact(it: Interactable): void {
    const lv = this.level;
    if (!lv) return;
    const { bus, engine } = this.d;
    if (it.kind === 'terminal') {
      const lesson = lv.session.terminal(it.id);
      if (!lesson) return;
      if (lv.session.isLocked(it.id)) {
        const need = (lesson.requires ?? []).filter((r) => !lv.session.done.has(r)).map((r) => `«${lv.session.terminal(r)?.title ?? r}»`);
        bus.emit('sfx', { name: 'locked' });
        bus.emit('toast', { text: `Терминал заблокирован. Сначала почини ${need.join(', ')}.`, kind: 'warn' });
        this.player.emote('worried');
        return;
      }
      const t = lv.terminals.get(it.id)!;
      bus.emit('sfx', { name: 'interact' });
      engine.rig.setCloseTarget((t.pose.x + this.player.x) / 2, 0.9, (t.pose.z + this.player.z) / 2);
      this.activeTerminal = it.id;
      this.player.vx = 0;
      this.player.vz = 0;
      this.sm.go('terminal', performance.now());
      bus.emit('terminal:open', { levelId: lv.def.id, terminalId: it.id });
    } else if (it.kind === 'npc') {
      const npc = lv.npcs.get(it.id);
      const dialog = lv.session.dialogFor(it.id);
      if (!npc || !dialog) return;
      bus.emit('sfx', { name: 'interact' });
      engine.rig.setCloseTarget((it.x + this.player.x) / 2, 0.9, (it.z + this.player.z) / 2);
      this.dialogNpc = it.id;
      // the dialog box skips empty lines: start on the first one it will show
      this.dialog = { lines: dialog.lines, index: Math.max(0, dialog.lines.findIndex((l) => l.text.trim())), lastTalk: -1 };
      this.applyDialogLine();
      this.player.vx = 0;
      this.player.vz = 0;
      this.sm.go('dialog', performance.now());
      bus.emit('dialog:start', { npcId: it.id, name: npc.lesson.name, lines: dialog.lines });
    } else if (it.kind === 'gate') {
      bus.emit('sfx', { name: 'locked' });
      bus.emit('toast', { text: 'Ворота заперты. Почини все обязательные терминалы.', kind: 'warn' });
      this.player.emote('worried');
    }
  }

  /** Who speaks the current dialog line ('harni' = the robot) and with which mood. */
  private dialogSpeaker(): { harni: boolean; mood: Mood } | null {
    const dl = this.dialog;
    const npc = this.dialogNpc ? this.level?.npcs.get(this.dialogNpc) : undefined;
    const line = dl?.lines[dl.index];
    if (!line || !npc) return null;
    const speaker = line.speaker?.trim() || npc.lesson.name;
    return { harni: speaker.toUpperCase() === 'ХАРНИ', mood: line.mood ?? 'neutral' };
  }

  private applyDialogLine(): void {
    const s = this.dialogSpeaker();
    const npc = this.dialogNpc ? this.level?.npcs.get(this.dialogNpc) : undefined;
    if (!s || !npc) return;
    if (s.harni) this.player.emote(MOOD_EMOTION[s.mood], 60);
    else {
      npc.setMood(s.mood);
      this.player.emote('neutral', 0);
    }
  }

  /** Per-frame update. */
  update(dt: number): void {
    const lv = this.level;
    const { engine, input, bus } = this.d;
    const playing = this.sm.is('playing');
    if (lv) {
      if (!this.away && this.sm.is('playing', 'dialog', 'terminal')) lv.session.elapsed += dt;
      const lookAt = playing ? this.findLook() : this.lookAtActive();
      if (playing) {
        this.player.update(dt, input.move(), lv.sources, lookAt);
        const pos = worldToTile(this.player.x, this.player.z);
        // chips by touch
        for (const chip of lv.chips.values()) {
          if (chip.collected) continue;
          if (Math.hypot(chip.x - this.player.x, chip.z - this.player.z) < 0.8) this.collectChip(chip);
        }
        // zones
        for (const z of lv.session.enterZones(pos)) bus.emit('toast', { text: z.text, kind: 'bark', speaker: z.speaker ?? 'ХАРНИ' });
        // exit
        if (lv.session.atExit(pos)) this.completeLevel();
        // prompt and interaction
        if (this.sm.is('playing')) {
          this.target = this.findTarget();
          this.setPrompt(this.target ? { kind: this.target.kind, id: this.target.id, label: this.target.label, locked: this.isLocked(this.target) } : null);
          // consumed every frame: a press with nothing in reach is dropped, not kept until something comes in reach
          const pressed = input.consumeInteract(this.playingSince);
          if (this.target && pressed) this.interact(this.target);
          engine.rig.addZoom(input.consumeZoom());
        }
      } else {
        this.player.idle(dt, lookAt);
      }
      for (const t of lv.terminals.values()) t.update(dt);
      if (this.dialog && this.dialogNpc) {
        const s = this.dialogSpeaker();
        const typing = this.dialog.lastTalk >= 0 && performance.now() - this.dialog.lastTalk < 260;
        lv.npcs.get(this.dialogNpc)?.setTalking(typing && !!s && !s.harni);
        this.player.setTalking(typing && !!s?.harni);
      }
      for (const n of lv.npcs.values()) n.update(dt, this.player, this.dialogNpc === n.lesson.id);
      for (const c of lv.chips.values()) c.update(dt);
      lv.gate.update(dt);
      lv.built.update(dt, clockSeconds(), engine.rig.lookAt, engine.rig.active); // [freeze] pinnable clock
    }
    // motion for the audio
    const speed = Math.round(this.player.speed01 * 20) / 20;
    if (Math.abs(speed - this.lastMotion) >= 0.05) {
      this.lastMotion = speed;
      bus.emit('player:motion', { speed });
    }
    engine.rig.update(dt, this.player);
    occlusion.target.value.set(this.player.x, 0.7, this.player.z);
    // the shadow box covers the camera's frame: its size follows the camera distance
    const look = engine.rig.lookAt;
    this.atmosphere.follow(look.x, look.z, engine.rig.active.position.distanceTo(look) * 0.82);
    if (lv) lv.built.rain.center.value.copy(engine.rig.lookAt);
    this.debugDraw?.update(this.player);
  }

  private lookAtActive(): THREE.Vector3 | null {
    const lv = this.level;
    if (!lv) return null;
    if (this.dialogNpc) return lv.npcs.get(this.dialogNpc)?.interact.look ?? null;
    if (this.activeTerminal) return lv.terminals.get(this.activeTerminal)?.interact.look ?? null;
    return null;
  }

  private isLocked(it: Interactable): boolean {
    const lv = this.level;
    if (!lv) return false;
    if (it.kind === 'terminal') return lv.session.isLocked(it.id);
    if (it.kind === 'gate') return !lv.gate.isOpen;
    return false;
  }

  private collectChip(chip: ChipEntity): void {
    const lv = this.level;
    if (!lv || !lv.session.collectChip(chip.id)) return;
    chip.collect();
    const lesson = lv.def.lessons.chips.find((c) => c.id === chip.id);
    const { store, bus } = this.d;
    store.collectChip(lv.def.id, chip.id);
    if (lesson?.unlocks?.length) store.unlockCodex(lesson.unlocks);
    bus.emit('sfx', { name: 'chip' });
    bus.emit('chip:collected', { levelId: lv.def.id, chipId: chip.id });
    this.player.emote('happy', 1.5);
  }

  // ───────────────────────────── debug helpers ─────────────────────────────

  /**
   * Teleport the robot to a tile position: onto the nearest walkable tile and out of colliders (the
   * spawn when nothing near is free).
   */
  teleport(col: number, row: number): void {
    if (!Number.isFinite(col) || !Number.isFinite(row)) return;
    const lv = this.level;
    let x = col * TILE;
    let z = row * TILE;
    if (lv) {
      const [sc, sr] = lv.def.layout.spawn.at;
      const spot = nearestFreeSpot(lv.plan.grid, lv.sources, x, z, PLAYER.radius) ?? { x: sc * TILE, z: sr * TILE };
      x = spot.x;
      z = spot.z;
    }
    this.player.place(x, z, this.player.yaw);
    this.d.engine.rig.snap(x, z);
  }

  /**
   * Gameplay spots of the current level in tile coordinates, for scripted playtests: where to stand to
   * use each terminal / talk to each NPC, chips, the gate, the exit and the zones.
   */
  spots(): DebugSpots | null {
    const lv = this.level;
    if (!lv) return null;
    const t = (x: number, z: number) => ({ col: x / 2, row: z / 2 });
    const L = lv.def.layout;
    const out: DebugSpots = {
      spawn: { col: L.spawn.at[0], row: L.spawn.at[1] },
      terminals: {},
      npcs: {},
      chips: {},
      zones: {},
      gate: { col: L.gate.at[0], row: L.gate.at[1] },
      exit: { col: L.exit[0], row: L.exit[1] },
    };
    for (const [id, e] of lv.terminals) out.terminals[id] = t(e.interact.x, e.interact.z);
    for (const [id, n] of lv.npcs) {
      const yaw = facingToYaw(L.npcs[id].facing);
      out.npcs[id] = t(n.interact.x + Math.sin(yaw) * 1.25, n.interact.z + Math.cos(yaw) * 1.25);
    }
    for (const [id, c] of lv.chips) out.chips[id] = t(c.x, c.z);
    for (const [id, z] of Object.entries(L.zones)) out.zones[id] = { col: z.at[0], row: z.at[1] };
    return out;
  }

  /** Programmatic E press (works in `playing`). */
  pressInteract(): boolean {
    if (!this.sm.is('playing') || !this.target) return false;
    this.interact(this.target);
    return true;
  }

  get currentPrompt(): Prompt {
    return this.prompt;
  }

  get runtime(): LevelRuntime | null {
    return this.level;
  }
}
