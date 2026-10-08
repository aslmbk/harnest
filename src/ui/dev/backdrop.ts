/** Static night-city backdrop for the UI harness (stands in for the 3D canvas). */
import { svg } from '../dom';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function skyline(seed: number, base: number, minH: number, maxH: number, fill: string, windows: number): string {
  const r = rng(seed);
  let x = -20;
  let out = '';
  while (x < 1940) {
    const w = 50 + r() * 110;
    const hgt = minH + r() * (maxH - minH);
    const y = base - hgt;
    out += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${(hgt + 400).toFixed(0)}" fill="${fill}"/>`;
    for (let wy = y + 14; wy < base - 10; wy += 22) {
      for (let wx = x + 10; wx < x + w - 14; wx += 18) {
        if (r() < windows) {
          const warm = r() < 0.7;
          out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="7" height="9" fill="${warm ? '#ffb87a' : '#5fe9ff'}" opacity="${(0.25 + r() * 0.55).toFixed(2)}"/>`;
        }
      }
    }
    x += w + 4 + r() * 18;
  }
  return out;
}

export function createBackdrop(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'backdrop';
  const art = svg(
    `<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax slice">` +
      `<defs>` +
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070c"/><stop offset="0.62" stop-color="#0b1420"/><stop offset="1" stop-color="#121722"/></linearGradient>` +
      `<radialGradient id="glowA" cx="0.22" cy="0.72" r="0.5"><stop offset="0" stop-color="#d97757" stop-opacity="0.28"/><stop offset="1" stop-color="#d97757" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="glowB" cx="0.78" cy="0.66" r="0.45"><stop offset="0" stop-color="#19e3ff" stop-opacity="0.18"/><stop offset="1" stop-color="#19e3ff" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="street" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151a24"/><stop offset="1" stop-color="#07090d"/></linearGradient>` +
      `</defs>` +
      `<rect width="1920" height="1080" fill="url(#sky)"/>` +
      `<rect width="1920" height="1080" fill="url(#glowA)"/>` +
      `<rect width="1920" height="1080" fill="url(#glowB)"/>` +
      skyline(7, 760, 160, 430, '#0c121b', 0.12) +
      skyline(19, 820, 90, 300, '#090d14', 0.18) +
      `<rect x="0" y="820" width="1920" height="260" fill="url(#street)"/>` +
      `<g stroke="#d97757" stroke-opacity="0.18" stroke-width="2">` +
      Array.from({ length: 13 }, (_, i) => `<line x1="${960 + (i - 6) * 40}" y1="820" x2="${960 + (i - 6) * 420}" y2="1080"/>`).join('') +
      `</g>` +
      `<g stroke="#19e3ff" stroke-opacity="0.08" stroke-width="2">` +
      [850, 885, 935, 1000].map((y) => `<line x1="0" y1="${y}" x2="1920" y2="${y}"/>`).join('') +
      `</g>` +
      `<rect x="905" y="760" width="110" height="74" rx="14" fill="#d97757"/>` +
      `<rect x="925" y="780" width="28" height="24" rx="5" fill="#0b1a22"/><rect x="967" y="780" width="28" height="24" rx="5" fill="#0b1a22"/>` +
      `<rect x="935" y="788" width="9" height="9" rx="2" fill="#ffe9c4"/><rect x="977" y="788" width="9" height="9" rx="2" fill="#ffe9c4"/>` +
      `<ellipse cx="960" cy="842" rx="70" ry="10" fill="#000" opacity="0.5"/>` +
      `</svg>`,
  );
  el.append(art);
  return el;
}
