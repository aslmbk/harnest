// Shadow-map reallocation and three's per-draw refresh check (src/render/atmosphere.ts). three r186
// rebuilds the bind groups of a render object whose material has no node slots only when the shadow-map
// SIZE differs from the one it last saw: after A → B → A, objects not drawn while the map was B kept a
// bind group of a destroyed texture and WebGPU rejected every frame that drew one (the picture froze).
// The gate makes every reallocation a full refresh for every render object, once.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
// the build the game imports as `three/webgpu` (r186), as text
import src from '../node_modules/three/build/three.webgpu.js?raw';
import { Atmosphere, fullRefreshAfterReallocation } from '../src/render/atmosphere';

const { NONE, SHARED, FULL } = THREE.RenderObjectRefreshType;

describe('three internals the hook relies on', () => {
  it('every draw (direct and bundled) asks `this._nodes.needsRefresh`; an upgrade that changes it fails here', () => {
    expect(src.match(/this\._nodes\.needsRefresh\( renderObject \)/g)?.length).toBe(2);
    // the observer still compares only the map size (if three starts tracking the map itself, the hook may go)
    expect(src).toContain('data.shadowMapWidth = light.shadow.mapSize.width;');
  });
});

describe('fullRefreshAfterReallocation', () => {
  it('passes three’s answer through until a reallocation', () => {
    const gate = fullRefreshAfterReallocation((ro) => ((ro as { t: number }).t));
    expect(gate.check({ t: NONE })).toBe(NONE);
    expect(gate.check({ t: SHARED })).toBe(SHARED);
    expect(gate.check({ t: FULL })).toBe(FULL);
  });

  it('asks each render object for one full refresh after each reallocation', () => {
    const base = { calls: 0 };
    const gate = fullRefreshAfterReallocation(() => {
      base.calls++;
      return SHARED;
    });
    const a = {};
    const b = {};
    expect(gate.check(a)).toBe(SHARED);
    gate.reallocated();
    expect(gate.check(a)).toBe(FULL);
    expect(gate.check(a)).toBe(SHARED);
    expect(gate.check(a)).toBe(SHARED);
    expect(gate.check(b)).toBe(FULL);
    expect(gate.check(b)).toBe(SHARED);
    gate.reallocated();
    expect(gate.check(a)).toBe(FULL);
    expect(gate.check(b)).toBe(FULL);
    // three's own check still runs every time (its observer keeps its snapshots current)
    expect(base.calls).toBe(8);
  });

  it('refreshes an object that was not drawn between two reallocations (size A → B → A)', () => {
    const gate = fullRefreshAfterReallocation(() => NONE);
    const nearSpawn = {};
    const farAway = {};
    gate.check(nearSpawn);
    gate.check(farAway);
    gate.reallocated(); // A → B: only what is in view is drawn
    expect(gate.check(nearSpawn)).toBe(FULL);
    gate.reallocated(); // B → A: three sees size A == the size `farAway` last saw and would answer NONE
    expect(gate.check(nearSpawn)).toBe(FULL);
    expect(gate.check(farAway)).toBe(FULL);
    expect(gate.check(farAway)).toBe(NONE);
  });
});

describe('Atmosphere.setShadows', () => {
  function setup() {
    const nodes = { needsRefresh: (_ro: object) => NONE as number };
    const renderer = { _nodes: nodes } as unknown as THREE.Renderer;
    const atmosphere = new Atmosphere(new THREE.Scene(), renderer);
    return { atmosphere, check: (ro: object) => nodes.needsRefresh(ro) };
  }

  it('marks a reallocation only when the map size changes with shadows on', () => {
    const { atmosphere, check } = setup();
    const ro = {};
    atmosphere.setShadows(true, 1024); // the initial map size: nothing to reallocate
    expect(check(ro)).toBe(NONE);
    atmosphere.setShadows(false, 512); // off: the map is kept as it is
    expect(check(ro)).toBe(NONE);
    atmosphere.setShadows(true, 2048);
    expect(check(ro)).toBe(FULL);
    expect(check(ro)).toBe(NONE);
    atmosphere.setShadows(true, 2048);
    expect(check(ro)).toBe(NONE);
    atmosphere.setShadows(true, 1024);
    expect(check(ro)).toBe(FULL);
  });

  it('renders a reallocated map at the next frame even when shadows are off by then', () => {
    const { atmosphere, check } = setup();
    const ro = {};
    atmosphere.key.shadow.needsUpdate = false;
    atmosphere.setShadows(true, 2048); // disposes the 1024 map…
    atmosphere.setShadows(false, 512); // …then off before a frame (two quality steps in one frame)
    // the next frame makes the map again at 2048 before the objects that refresh bind it
    expect(atmosphere.key.shadow.needsUpdate).toBe(true);
    expect(check(ro)).toBe(FULL);
    expect(check(ro)).toBe(NONE);
  });

  it('keeps working without a renderer (no hook installed)', () => {
    const atmosphere = new Atmosphere(new THREE.Scene());
    expect(() => atmosphere.setShadows(true, 2048)).not.toThrow();
  });
});
