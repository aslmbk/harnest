import { describe, expect, it } from 'vitest';
import { Input } from '../src/engine/input';
import { STICK_DEAD, STICK_RADIUS, stickVector } from '../src/engine/touch';

const key = (type: string, code: string) => Object.assign(new Event(type), { code });

describe('touch stick', () => {
  it('maps the knob offset to an analog, screen-relative vector', () => {
    expect(stickVector(0, 0)).toEqual({ x: 0, z: 0 });
    // inside the dead zone nothing moves
    expect(stickVector(STICK_RADIUS * STICK_DEAD * 0.9, 0)).toEqual({ x: 0, z: 0 });
    // past the rim: full speed, same direction
    const full = stickVector(STICK_RADIUS * 2, 0);
    expect(full.x).toBeCloseTo(1);
    expect(full.z).toBeCloseTo(0);
    // up on screen drives north (z < 0), like W
    expect(stickVector(0, -STICK_RADIUS).z).toBeCloseTo(-1);
    // halfway between the dead zone and the rim: half speed
    expect(stickVector(STICK_RADIUS * (STICK_DEAD + (1 - STICK_DEAD) / 2), 0).x).toBeCloseTo(0.5);
    const diag = stickVector(100, 100);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1);
    expect(diag.x).toBeCloseTo(diag.z);
  });

  it('feeds Input.move while enabled; keys win over the stick', () => {
    const target = new EventTarget() as unknown as Window;
    const input = new Input(target);
    input.setStick(0.3, -0.4);
    expect(input.move()).toEqual({ x: 0, z: 0 });
    const seen: boolean[] = [];
    const off = input.onEnabled((on) => seen.push(on));
    input.enabled = true;
    input.enabled = true;
    expect(seen).toEqual([true]);
    expect(input.move().x).toBeCloseTo(0.3);
    expect(input.move().z).toBeCloseTo(-0.4);
    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(input.move()).toEqual({ x: 1, z: 0 });
    target.dispatchEvent(key('keyup', 'KeyD'));
    input.setStick(3, 4);
    const m = input.move();
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1);
    input.enabled = false;
    expect(seen).toEqual([true, false]);
    expect(input.move()).toEqual({ x: 0, z: 0 });
    off();
    input.enabled = true;
    expect(seen).toEqual([true, false]);
    input.dispose();
  });
});
