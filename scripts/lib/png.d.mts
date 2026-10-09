// Types for png.mjs (used by the vitest in tests/visual-diff.test.ts).
import type { RgbaImage } from './imagediff.mjs';

export declare function decodePng(buf: Uint8Array): RgbaImage;
export declare function encodePng(img: RgbaImage): Uint8Array;
