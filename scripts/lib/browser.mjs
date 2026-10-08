// Headless browser helper for screenshots and scripted checks. Uses the installed Chrome/Edge
// through playwright-core (no browser download).
import { chromium } from 'playwright-core';

/**
 * @param {{ browser?: 'chrome' | 'msedge', headless?: boolean, webgpu?: boolean }} [opts]
 */
export async function launchBrowser(opts = {}) {
  const channel = opts.browser ?? process.env.HARNEST_BROWSER ?? 'chrome';
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  if (opts.webgpu !== false) args.push('--enable-unsafe-webgpu');
  const browser = await chromium.launch({ channel, headless: opts.headless ?? true, args });
  if (opts.webgpu === false) NO_WEBGPU.add(browser);
  return browser;
}

/** Browsers launched with `webgpu: false`: their pages get no navigator.gpu (WebGPU is on by default in Chrome). */
const NO_WEBGPU = new WeakSet();

/**
 * Opens a page and collects console errors / page errors into `problems`.
 * @param {import('playwright-core').Browser} browser
 * @param {{ width?: number, height?: number, scale?: number }} [opts]
 */
export async function openPage(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 720 },
    deviceScaleFactor: opts.scale ?? 1,
  });
  // the renderer then falls back to WebGL2
  if (NO_WEBGPU.has(browser)) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
  const page = await context.newPage();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const logs = [];
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    logs.push(line);
    if (msg.type() === 'error') problems.push(line);
  });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`));
  return { page, problems, logs };
}

/**
 * Waits until `expression` is truthy in the page. Returns false on timeout instead of throwing.
 * @param {import('playwright-core').Page} page
 */
export async function waitReady(page, expression = 'window.__harnest?.ready === true', timeout = 30000) {
  try {
    await page.waitForFunction(expression, undefined, { timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Holds keys for a while. spec: "KeyW:800,KeyD:400" (KeyboardEvent.code : milliseconds), run in order.
 * Several keys at once: "KeyW+KeyD:600".
 * @param {import('playwright-core').Page} page
 */
export async function holdKeys(page, spec) {
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [keys, ms] = part.split(':');
    const list = keys.split('+');
    for (const k of list) await page.keyboard.down(k);
    await page.waitForTimeout(Number(ms ?? 200));
    for (const k of list.reverse()) await page.keyboard.up(k);
  }
}
