import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';

// Optional browser-capability research, isolated from extension/release launches.
// Run: npx tsx tests/dom-overlay-capture.ts
const results: object[] = [];
for (const experimental of [false, true]) {
  const browser = await chromium.launch({
    ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {}),
    args: experimental ? ['--enable-experimental-web-platform-features'] : [],
  });
  try {
    const page = await browser.newPage();
    await page.evaluate('globalThis.__name = value => value');
    const capability = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
      const surface = canvas as unknown as {updateElementGeometry?: unknown; captureElementImage?: unknown};
      const paint = ctx as unknown as {drawElementImage?: unknown};
      return {drawElementImage: typeof paint.drawElementImage, updateElementGeometry: typeof surface.updateElementGeometry,
        captureElementImage: typeof surface.captureElementImage, content: 'content' in canvas,
        beforeXRSelectHandler: 'onbeforexrselect' in HTMLElement.prototype};
    });
    let experiment: unknown = null;
    if (experimental && capability.drawElementImage === 'function') {
      await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 100;
        canvas.setAttribute('content', 'drawable');
        const root = document.createElement('section'); root.id = 'single-root'; root.setAttribute('drawable', '');
        Object.assign(root.style, {width: '160px', height: '100px', position: 'relative', background: 'white'});
        const button = document.createElement('button'); button.textContent = 'Live root';
        Object.assign(button.style, {position: 'absolute', left: '0', top: '0', width: '160px', height: '50px', background: 'rgb(3, 241, 162)', border: '0'});
        const input = document.createElement('input'); input.setAttribute('aria-label', 'Captured input'); input.value = 'original';
        Object.assign(input.style, {position: 'absolute', left: '0', top: '50px', width: '150px', height: '40px'});
        root.append(button, input); canvas.append(root); document.body.append(canvas);
        const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D & {drawElementImage(element: Element, x: number, y: number): void};
        const state = {canvas, root, button, input, paints: 0, clicks: 0, errors: [] as string[]};
        button.addEventListener('click', () => state.clicks++);
        canvas.addEventListener('paint', () => {
          try { ctx.clearRect(0, 0, 320, 100); ctx.drawElementImage(root, 0, 0); ctx.drawElementImage(root, 160, 0); state.paints++; }
          catch (error) { state.errors.push(String(error)); }
        });
        (window as unknown as {captureExperiment: typeof state}).captureExperiment = state;
      });
      await page.waitForFunction('window.captureExperiment.paints > 0 || window.captureExperiment.errors.length > 0', undefined, {timeout: 10000});
      experiment = await page.evaluate(() => {
        const s = (window as unknown as {captureExperiment: {canvas: HTMLCanvasElement; root: Element; paints: number; errors: string[]}}).captureExperiment;
        let colors: number[][] | null = null, readbackError: string | null = null;
        try { const ctx = s.canvas.getContext('2d')!; colors = [ctx.getImageData(20, 10, 1, 1), ctx.getImageData(180, 10, 1, 1)].map(image => Array.from(image.data)); }
        catch (error) { readbackError = (error as Error).name; }
        const r = s.canvas.getBoundingClientRect();
        return {singleRoot: document.querySelectorAll('#single-root').length === 1, paints: s.paints, errors: s.errors,
          colors, readbackError, hitTargets: [20, 180].map(x => document.elementFromPoint(r.left + x, r.top + 10)?.tagName)};
      });
      const live = await page.evaluate(() => {
        const s = (window as unknown as {captureExperiment: {canvas: HTMLCanvasElement; button: HTMLElement; input: HTMLInputElement; paints: number}}).captureExperiment;
        const before = s.paints; s.button.style.background = 'rgb(241, 3, 162)'; s.input.value = 'live mutation';
        (s.canvas as HTMLCanvasElement & {requestPaint(): void}).requestPaint(); return before;
      });
      await page.waitForFunction(before => (window as unknown as {captureExperiment: {paints: number}}).captureExperiment.paints > before, live);
      const updated = await page.evaluate(() => {
        const s = (window as unknown as {captureExperiment: {canvas: HTMLCanvasElement; input: HTMLInputElement}}).captureExperiment;
        const ctx = s.canvas.getContext('2d')!;
        return {value: s.input.value, colors: [20, 180].map(x => Array.from(ctx.getImageData(x, 10, 1, 1).data))};
      });
      assert.deepEqual(updated.colors, [[241, 3, 162, 255], [241, 3, 162, 255]], 'one live root updates both captured rectangles');
      experiment = {...experiment as object, updated};
      await mkdir('test-results', {recursive: true}); await page.screenshot({path: 'test-results/dom-overlay-experimental-capture.png'});
      assert((experiment as {singleRoot: boolean}).singleRoot, 'capture experiment retains one DOM root');
    }
    results.push({browser: await browser.version(), experimental, args: experimental ? ['--enable-experimental-web-platform-features'] : [], capability, experiment,
      productionSupport: false, limitation: 'Capability/paint probe only; no stereo XR projection, controller mapping, cross-origin policy or deployment strategy validated'});
  } finally { await browser.close(); }
}
await mkdir('test-results', {recursive: true});
await writeFile('test-results/dom-overlay-capture-capabilities.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
