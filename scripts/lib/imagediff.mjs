// Pixel comparison math for the visual-regression scripts (pure: RGBA buffers in, numbers out).

/** Default pass thresholds (see scripts/visual-compare.mjs). */
export const DEFAULTS = Object.freeze({
  /** a pixel "differs" when its largest RGB channel difference is above this (0..255) */
  channelTolerance: 2,
  /** max fraction of differing pixels (0.001 = 0.1 %) */
  maxDiffFraction: 0.001,
  /** min PSNR in dB */
  minPsnr: 45,
});

/**
 * Compares two RGBA images of the same size (alpha ignored: screenshots are opaque).
 * @param {{ width: number, height: number, data: Uint8Array }} a
 * @param {{ width: number, height: number, data: Uint8Array }} b
 * @param {{ channelTolerance?: number, diffImage?: boolean }} [opts]
 * @returns {{ pixels: number, diffPixels: number, diffFraction: number, maxDiff: number, mae: number, mse: number, psnr: number, diff: Uint8Array | null }}
 *   mae / mse in 0..255 channel units, psnr in dB (Infinity when identical); `diff` is an RGBA
 *   visualisation: the base dimmed to grey, differing pixels red (above tolerance) or amber (at or below).
 */
export function compareImages(a, b, opts = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  const tol = opts.channelTolerance ?? DEFAULTS.channelTolerance;
  const pixels = a.width * a.height;
  const A = a.data;
  const B = b.data;
  const diff = opts.diffImage === false ? null : new Uint8Array(pixels * 4);
  let diffPixels = 0;
  let maxDiff = 0;
  let absSum = 0;
  let sqSum = 0;
  for (let i = 0, o = 0; i < pixels; i++, o += 4) {
    const dr = Math.abs(A[o] - B[o]);
    const dg = Math.abs(A[o + 1] - B[o + 1]);
    const db = Math.abs(A[o + 2] - B[o + 2]);
    const m = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
    absSum += dr + dg + db;
    sqSum += dr * dr + dg * dg + db * db;
    if (m > maxDiff) maxDiff = m;
    if (m > tol) diffPixels++;
    if (diff) {
      if (m > tol) {
        const v = Math.min(255, 140 + m * 4);
        diff[o] = v; diff[o + 1] = 0; diff[o + 2] = 40;
      } else if (m > 0) {
        diff[o] = 150; diff[o + 1] = 110; diff[o + 2] = 0;
      } else {
        const g = Math.round((A[o] * 0.299 + A[o + 1] * 0.587 + A[o + 2] * 0.114) * 0.3);
        diff[o] = diff[o + 1] = diff[o + 2] = g;
      }
      diff[o + 3] = 255;
    }
  }
  const n = pixels * 3;
  const mse = sqSum / n;
  return {
    pixels,
    diffPixels,
    diffFraction: diffPixels / pixels,
    maxDiff,
    mae: absSum / n,
    mse,
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    diff,
  };
}

/**
 * @param {{ diffFraction: number, psnr: number }} r
 * @param {{ maxDiffFraction?: number, minPsnr?: number }} [limits]
 */
export function passes(r, limits = {}) {
  const maxFrac = limits.maxDiffFraction ?? DEFAULTS.maxDiffFraction;
  const minPsnr = limits.minPsnr ?? DEFAULTS.minPsnr;
  return r.diffFraction <= maxFrac && r.psnr >= minPsnr;
}
