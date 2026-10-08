/**
 * Headless stand-in for the UI (`?autoui=1`): answers every game → UI request automatically.
 * Lets the game flow be tested without the DOM overlay, and documents the bus protocol in code.
 */
import type { GameBus } from '../core/events';

export function createAutoUI(bus: GameBus, log = true): void {
  const say = (msg: string) => log && console.info(`[autoui] ${msg}`);

  bus.on('state:changed', ({ to }) => {
    say(`state → ${to}`);
    if (to === 'intro') setTimeout(() => bus.emit('ui:introDone', {}), 100);
    if (to === 'levelComplete') setTimeout(() => bus.emit('ui:nextLevel', {}), 500);
  });

  bus.on('dialog:start', ({ npcId, lines }) => {
    say(`dialog with ${npcId}: ${lines.length} lines`);
    setTimeout(() => bus.emit('ui:dialogDone', { npcId }), 100);
  });

  bus.on('terminal:open', ({ terminalId }) => {
    say(`terminal ${terminalId} → auto-completed`);
    setTimeout(() => bus.emit('ui:terminalClosed', { terminalId, completed: true, stars: 3 }), 100);
  });

  bus.on('toast', ({ text }) => say(`toast: ${text}`));
  bus.on('chip:collected', ({ chipId }) => say(`chip ${chipId}`));
  bus.on('gate:opened', () => say('gate opened'));
}
