// Types for imagediff.mjs (used by the vitest in tests/visual-diff.test.ts).
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CompareResult {
  pixels: number;
  diffPixels: number;
  diffFraction: number;
  maxDiff: number;
  mae: number;
  mse: number;
  psnr: number;
  diff: Uint8Array | null;
}

export declare const DEFAULTS: Readonly<{ channelTolerance: number; maxDiffFraction: number; minPsnr: number }>;
export declare function compareImages(a: RgbaImage, b: RgbaImage, opts?: { channelTolerance?: number; diffImage?: boolean }): CompareResult;
export declare function passes(r: { diffFraction: number; psnr: number }, limits?: { maxDiffFraction?: number; minPsnr?: number }): boolean;
