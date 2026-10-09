/**
 * Neon sign painter off the main thread (OffscreenCanvas). The page sends the @font-face rules of the
 * sign fonts once (the worker has its own FontFaceSet and does not see the document's fonts), then
 * paint jobs; every reply carries the packed RGBA bytes (transferred) or an error, on which the page
 * paints the sign itself.
 */
import { type NeonJob, paintNeon } from './neonPaint';

export interface FontRule {
  family: string;
  /** CSS `src` with absolute URLs. */
  src: string;
  descriptors: FontFaceDescriptors;
}

export type NeonWorkerRequest = { type: 'fonts'; rules: FontRule[] } | { type: 'paint'; id: number; job: NeonJob };

export type NeonWorkerReply =
  | { type: 'done'; id: number; data: Uint8ClampedArray<ArrayBuffer>; ms: number }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  fonts: FontFaceSet;
  onmessage: ((e: MessageEvent<NeonWorkerRequest>) => void) | null;
  postMessage(msg: NeonWorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let chain: Promise<void> = Promise.resolve();

const canvas = (w: number, h: number) => new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;

async function paint(id: number, job: NeonJob): Promise<void> {
  try {
    // the faces this text needs (unicode-range subsets), as the page loads them before drawing
    const faces = await scope.fonts.load(job.font, job.lines.join(''));
    if (!faces.length || !scope.fonts.check(job.font, job.lines.join(''))) throw new Error(`font not available: ${job.font}`);
    // the same font as the page: the glyph advances match what the page measured
    const probe = canvas(1, 1);
    probe.font = job.font;
    job.lines.forEach((l, i) => {
      const w = probe.measureText(l).width;
      if (Math.abs(w - job.widths[i]) > 1e-3) throw new Error(`text "${l}" measures ${w}, the page measured ${job.widths[i]}`);
    });
    const t0 = performance.now();
    const data = paintNeon(job, canvas);
    scope.postMessage({ type: 'done', id, data, ms: performance.now() - t0 }, [data.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'fonts') {
    // load every face up front: a face loaded on demand right before drawing is not always used by
    // the canvas yet (the text then comes out in a fallback font)
    const faces = msg.rules.map((r) => new FontFace(r.family, r.src, r.descriptors));
    for (const f of faces) scope.fonts.add(f);
    chain = chain.then(() => Promise.all(faces.map((f) => f.load())).then(() => undefined, () => undefined));
    return;
  }
  // one job at a time, in order
  chain = chain.then(() => paint(msg.id, msg.job));
};
