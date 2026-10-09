import { describe, expect, it } from 'vitest';
import { compareImages, DEFAULTS, passes, type RgbaImage } from '../scripts/lib/imagediff.mjs';
import { decodePng, encodePng } from '../scripts/lib/png.mjs';

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const [r, g, b] = fill(x, y);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  return { width, height, data };
}

describe('visual diff math', () => {
  const base = image(40, 25, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y) % 256]);

  it('identical images: no differing pixels, infinite PSNR', () => {
    const r = compareImages(base, image(40, 25, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y) % 256]));
    expect(r.diffPixels).toBe(0);
    expect(r.mae).toBe(0);
    expect(r.psnr).toBe(Infinity);
    expect(passes(r)).toBe(true);
  });

  it('differences at the tolerance do not count, above it they do', () => {
    const tweak = (d: number) => compareImages(base, image(40, 25, (x, y) => [(x * 7) % 256, (y * 11) % 256, Math.min(255, ((x * y) % 256) + (x === 3 && y === 4 ? d : 0))]));
    expect(tweak(DEFAULTS.channelTolerance).diffPixels).toBe(0);
    const r = tweak(DEFAULTS.channelTolerance + 1);
    expect(r.diffPixels).toBe(1);
    expect(r.diffFraction).toBeCloseTo(1 / 1000, 10);
    expect(r.maxDiff).toBe(3);
  });

  it('MAE and PSNR follow their definitions', () => {
    const a = image(10, 10, () => [100, 100, 100]);
    const b = image(10, 10, () => [110, 100, 100]); // one channel off by 10 everywhere
    const r = compareImages(a, b);
    expect(r.mae).toBeCloseTo(10 / 3, 10);
    expect(r.mse).toBeCloseTo(100 / 3, 10);
    expect(r.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / (100 / 3)), 10);
    expect(r.diffFraction).toBe(1);
    expect(passes(r)).toBe(false);
  });

  it('thresholds are adjustable', () => {
    const r = { diffFraction: 0.002, psnr: 50 };
    expect(passes(r)).toBe(false);
    expect(passes(r, { maxDiffFraction: 0.005 })).toBe(true);
    expect(passes({ diffFraction: 0, psnr: 44 }, { minPsnr: 40 })).toBe(true);
  });

  it('rejects images of different sizes', () => {
    expect(() => compareImages(base, image(41, 25, () => [0, 0, 0]))).toThrow(/size/);
  });

  it('PNG round trip is lossless', () => {
    const back = decodePng(encodePng(base));
    expect(back.width).toBe(40);
    expect(back.height).toBe(25);
    expect(Array.from(back.data)).toEqual(Array.from(base.data));
  });
});
