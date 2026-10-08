/**
 * Bootstrap: bus + store, renderer, UI and audio (isolated: a broken module cannot stop the game),
 * assets (GLBs or placeholders), the game, and the `window.__harnest` debug API.
 */
import { createAutoUI } from './dev/autoUI';
import { createStatsOverlay } from './dev/statsOverlay';
import { EventBus, type GameEvents } from './core/events';
import { Store } from './core/store';
import { AssetLibrary } from './engine/assets';
import { attachGame, installEarlyApi, recordBus } from './engine/debug';
import { Engine } from './engine/engine';
import { Input } from './engine/input';
import { parseParams } from './engine/params';
import { TouchControls } from './engine/touch';
import { MaterialLibrary } from './render/materials';
import { Placeholders } from './render/placeholders';
import { Game } from './world/game';

async function main(): Promise<void> {
  const params = parseParams(location.search);
  const bus = new EventBus<GameEvents>();
  const events = recordBus(bus);
  const api = installEarlyApi(bus, events);
  const store = new Store();
  const host = document.getElementById('game')!;
  const uiRoot = document.getElementById('ui-root')!;

  // UI and audio load in parallel with the renderer; failures only disable them
  const uiModule = params.noui
    ? Promise.resolve(null)
    : import('./ui').catch((err: unknown) => {
        console.warn('[harnest] UI module failed to load — continuing without it', err);
        return null;
      });
  const audioModule = import('./audio').catch((err: unknown) => {
    console.warn('[harnest] audio module failed to load — continuing without it', err);
    return null;
  });

  const engine = await Engine.create(host, store, params.quality);
  api.backend = engine.backend;
  console.info(`[harnest] backend: ${engine.backend}`);

  let uiReady = false;
  const ui = await uiModule;
  if (ui) {
    try {
      ui.createUI({ root: uiRoot, bus, store });
      uiReady = true;
    } catch (err) {
      console.warn('[harnest] createUI failed — continuing without the UI', err);
    }
  }
  const audio = await audioModule;
  if (audio) {
    try {
      audio.createAudio({ bus, store });
    } catch (err) {
      console.warn('[harnest] createAudio failed — continuing without audio', err);
    }
  }
  // Without a UI nobody answers intro / dialog / terminal requests: answer them automatically.
  if (params.autoui || !uiReady) createAutoUI(bus);

  bus.emit('renderer:info', { backend: engine.backend });
  bus.emit('loading:progress', { ratio: 0, label: 'assets' });

  const materials = new MaterialLibrary();
  const assets = new AssetLibrary(materials, new Placeholders(materials));
  const report = await assets.loadAll({
    useFiles: params.assets,
    onProgress: (ratio, label) => bus.emit('loading:progress', { ratio: ratio * 0.4, label }),
  });

  const input = new Input();
  // virtual joystick + action button on touch screens (under the UI layer, shown while playing)
  const touch = new TouchControls(input, params.touch, uiRoot);
  bus.on('interact:prompt', (p) => touch.setPrompt(p && { label: p.label, locked: p.locked }));
  const game = new Game({ engine, bus, store, assets, materials, input, params });
  attachGame(api, game, engine, report);
  engine.start((dt) => game.update(dt));
  // one frame without the level configures the post pipeline, so the level's shaders can then be
  // compiled asynchronously against the real render target
  await engine.nextFrame();
  await game.boot();

  const markReady = () => {
    engine.frameListeners.delete(markReady);
    api.ready = true;
  };
  engine.frameListeners.add(markReady);
  if (params.debug) createStatsOverlay(api);
}

main().catch((err: unknown) => {
  console.error('[harnest] failed to start', err);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#d97757;font:16px system-ui;background:#05070a';
  box.textContent = 'Не удалось запустить игру: браузер не поддерживает WebGPU / WebGL2.';
  document.body.appendChild(box);
});
