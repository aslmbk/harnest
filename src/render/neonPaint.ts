/**
 * Painting of a neon sign canvas (shared by the main thread and `neon.worker.ts`, so both produce the
 * same bytes). The layout (canvas size, line positions) is measured on the main thread; this only
 * paints three white-on-black masks of the text on CPU canvases and packs them into one RGBA image:
 * R = the white-hot core (the tube eroded), G = a soft halo (blurred), B = the glass tube.
 */

export interface NeonJob {
  /** CSS font shorthand. */
  font: string;
  px: number;
  lines: string[];
  w: number;
  h: number;
  pad: number;
  lineH: number;
  /** Width of every line as the page measured it (a painter with other fonts measures otherwise). */
  widths: number[];
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Cache key of a sign image (everything the pixels depend on). */
export function neonJobKey(job: NeonJob): string {
  return `${job.font}|${job.px}|${job.w}x${job.h}|${job.pad}|${job.lineH}|${job.lines.join('\n')}`;
}

/**
 * Paints the job and returns the packed RGBA bytes (alpha 255). `canvas(w, h)` returns a 2D context
 * on a CPU-backed canvas (`willReadFrequently`), the same kind on both threads.
 */
export function paintNeon(job: NeonJob, canvas: (w: number, h: number) => Ctx2D): Uint8ClampedArray<ArrayBuffer> {
  const { font, px, lines, w, h, pad, lineH } = job;
  const layer = (paint: (ctx: Ctx2D) => void) => {
    const ctx = canvas(w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    paint(ctx);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const each = (ctx: Ctx2D, fn: (l: string, x: number, y: number) => void) =>
    lines.forEach((l, i) => fn(l, w / 2, pad + lineH * (i + 0.5) + px * 0.04));

  const tube = layer((ctx) => each(ctx, (l, x, y) => ctx.fillText(l, x, y)));
  const core = layer((ctx) =>
    each(ctx, (l, x, y) => {
      ctx.fillText(l, x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = px * 0.075;
      ctx.strokeText(l, x, y);
    }),
  );
  const halo = layer((ctx) => {
    ctx.filter = `blur(${Math.round(px * 0.2)}px)`;
    ctx.lineWidth = px * 0.12;
    each(ctx, (l, x, y) => {
      ctx.fillText(l, x, y);
      ctx.strokeText(l, x, y);
    });
  });

  // pack R = core, G = halo, B = tube, A = 255 (the masks are grey: their R channel is the value)
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = core[i];
    out[i + 1] = halo[i];
    out[i + 2] = tube[i];
    out[i + 3] = 255;
  }
  return out;
}
