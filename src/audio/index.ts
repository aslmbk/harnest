/**
 * Procedural audio entry point (WebAudio only, no files). Reactive: driven by bus events and the
 * store settings; see director.ts (event wiring), engine.ts (mixer graph), ambience.ts, music.ts,
 * motor.ts and sfx.ts (the sounds). Dev harness: /audio-dev.html. Checks: scripts/audio-check.mjs.
 */
import { type AudioDeps, type AudioHandle, createAudioDirector } from './director';

export type { AudioDeps, AudioHandle } from './director';

export function createAudio(deps: AudioDeps): AudioHandle {
  return createAudioDirector(deps);
}
