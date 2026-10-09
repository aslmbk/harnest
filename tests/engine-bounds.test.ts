import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { pendingSpheres, precomputeSpheres, sliceSphere } from '../src/engine/bounds';

/** Deterministic positions with a spread of magnitudes, signs and repeated values. */
function positions(n: number, seed: number, itemSize = 3): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const a = new Float32Array(n * itemSize);
  for (let i = 0; i < a.length; i++) a[i] = i % 97 === 0 ? 0 : rnd() * (i % 7 === 0 ? 900 : 13) + (i % 3) * 41.5;
  return a;
}

const reference = (geo: THREE.BufferGeometry) => {
  const g = geo.clone();
  g.computeBoundingSphere();
  return g.boundingSphere!;
};

const same = (a: THREE.Sphere, b: THREE.Sphere) => {
  // bit-identical, not just close
  expect(Object.is(a.center.x, b.center.x)).toBe(true);
  expect(Object.is(a.center.y, b.center.y)).toBe(true);
  expect(Object.is(a.center.z, b.center.z)).toBe(true);
  expect(Object.is(a.radius, b.radius)).toBe(true);
};

describe('sliceSphere', () => {
  const pause = () => Promise.resolve();

  it('stores exactly the sphere BufferGeometry.computeBoundingSphere computes (plain float positions)', async () => {
    for (const seed of [1, 7, 4242]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions(50_000, seed), 3));
      // a 0 ms slice pauses after every check: the result must not depend on where it pauses
      same((await sliceSphere(geo, pause, 0))!, reference(geo));
      same((await sliceSphere(geo, pause))!, reference(geo));
    }
  });

  it('matches for interleaved, normalized and 4-wide attributes too (the generic path)', async () => {
    const inter = new THREE.InterleavedBuffer(positions(20_000, 3, 6), 6);
    const a = new THREE.BufferGeometry();
    a.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 2));
    same((await sliceSphere(a, pause, 0))!, reference(a));

    const norm = new Int16Array(30_000 * 3).map((_, i) => ((i * 7919) % 65535) - 32767);
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(norm, 3, true));
    same((await sliceSphere(b, pause, 0))!, reference(b));

    const c = new THREE.BufferGeometry();
    c.setAttribute('position', new THREE.BufferAttribute(positions(20_000, 9, 4), 4));
    same((await sliceSphere(c, pause, 0))!, reference(c));
  });

  it('gives up when the positions change between slices', async () => {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions(40_000, 5), 3);
    geo.setAttribute('position', attr);
    const touch = () => {
      attr.needsUpdate = true;
      return Promise.resolve();
    };
    expect(await sliceSphere(geo, touch, 0)).toBeNull();
  });
});

describe('precomputeSpheres', () => {
  it('fills what the projection would compute: visible, big, without a sphere yet', async () => {
    const big = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions(20_000, 11), 3));
      return g;
    };
    const scene = new THREE.Scene();
    const shown = new THREE.Mesh(big());
    const hiddenParent = new THREE.Group();
    hiddenParent.visible = false;
    const hidden = new THREE.Mesh(big());
    hiddenParent.add(hidden);
    const small = new THREE.Mesh(new THREE.BoxGeometry());
    const known = new THREE.Mesh(big());
    known.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(1, 2, 3), 4);
    const morph = new THREE.Mesh(big());
    morph.geometry.morphAttributes.position = [new THREE.BufferAttribute(positions(20_000, 12), 3)];
    scene.add(shown, hiddenParent, small, known, morph);

    expect(pendingSpheres(scene)).toEqual([shown.geometry]);
    const expected = reference(shown.geometry);
    expect(await precomputeSpheres(scene, () => Promise.resolve())).toBe(1);
    same(shown.geometry.boundingSphere!, expected);
    expect(hidden.geometry.boundingSphere).toBeNull();
    expect(small.geometry.boundingSphere).toBeNull();
    expect(known.geometry.boundingSphere!.radius).toBe(4);
    expect(morph.geometry.boundingSphere).toBeNull();
  });
});
