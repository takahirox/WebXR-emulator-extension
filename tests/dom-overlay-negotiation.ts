import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type * as Runtime from '../src/polyfill/api/runtime';
import type {XRWebGLLayer} from '../src/polyfill/api/layers';

type GateWindow = typeof Runtime & {
  navigator: {xr: Runtime.XRSystem}; XRWebGLLayer: typeof XRWebGLLayer;
  overlayGate: {root: HTMLElement; host: HTMLElement; session: Runtime.XRSession; events: string[]; canvas: HTMLCanvasElement};
};

/** Public API regressions: do not bypass the production security gate here. */
export async function runDOMOverlayNegotiation(page: Page) {
  const configurations = await page.evaluate(async () => {
    const w = window as unknown as GateWindow, results: string[] = [];
    for (const configuration of ['light', 'open-root', 'closed-root', 'open-button', 'closed-button'] as const) {
      const container = document.createElement('div'); document.body.append(container);
      const root = document.createElement('section'), button = document.createElement('button');
      if (configuration.endsWith('-root')) container.attachShadow({mode: configuration === 'open-root' ? 'open' : 'closed'}).append(root);
      else container.append(root);
      if (configuration.endsWith('-button')) {
        const host = document.createElement('div'); root.append(host);
        host.attachShadow({mode: configuration === 'open-button' ? 'open' : 'closed'}).append(button);
      } else root.append(button);
      const style = root.getAttribute('style');
      try {
        let rejected = false;
        try { const unexpected = await w.navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['dom-overlay'], domOverlay: {root}}); await unexpected.end(); }
        catch (error) { if ((error as Error).name !== 'NotSupportedError') throw error; rejected = true; }
        if (!rejected) throw new Error(`${configuration}: required overlay was enabled`);
        const session = await w.navigator.xr.requestSession('immersive-ar', {optionalFeatures: ['dom-overlay'], domOverlay: {root}});
        try {
          if (session.domOverlayState !== null || session.enabledFeatures.includes('dom-overlay')) throw new Error(`${configuration}: optional overlay was enabled`);
          if (root.getAttribute('style') !== style || root.hasAttribute('popover')) throw new Error(`${configuration}: negotiation changed the root`);
        } finally { await session.end(); }
        results.push(configuration);
      } finally { container.remove(); }
    }
    return results;
  });
  // Reproduce attachment after the light-tree observer would have settled. A
  // disabled optional overlay must never turn native input into XR input, even
  // when release happens inside a newly attached cross-origin shadow iframe.
  await page.evaluate(async () => {
    const w = window as unknown as GateWindow;
    const root = document.createElement('section'); root.id = 'overlay-gate';
    Object.assign(root.style, {position: 'fixed', left: '20px', top: '20px', width: '600px', height: '160px', zIndex: '2147483647'});
    const button = document.createElement('button'); button.textContent = 'Ordinary DOM';
    Object.assign(button.style, {width: '160px', height: '100px'});
    const host = document.createElement('div'); host.id = 'overlay-gate-host';
    Object.assign(host.style, {position: 'absolute', left: '220px', top: '0', width: '300px', height: '130px'});
    root.append(button, host); document.body.append(root);
    const session = await w.navigator.xr.requestSession('immersive-ar', {optionalFeatures: ['dom-overlay'], domOverlay: {root}});
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl')!; await gl.makeXRCompatible();
    session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
    const events: string[] = [];
    root.addEventListener('beforexrselect', () => events.push('beforexrselect'));
    for (const name of ['selectstart', 'select', 'selectend']) session.addEventListener(name, () => events.push(name));
    const frame = () => { if (!session.ended) session.requestAnimationFrame(frame); };
    session.requestAnimationFrame(frame);
    w.overlayGate = {root, host, session, events, canvas};
  });
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  try {
    await settle();
    await page.evaluate(() => {
      const {host} = (window as unknown as GateWindow).overlayGate;
      const frame = document.createElement('iframe'); frame.src = `${location.origin.replace('127.0.0.1', 'localhost')}/frame`;
      Object.assign(frame.style, {width: '290px', height: '120px', border: '0'});
      host.attachShadow({mode: 'open'}).append(frame);
    });
    await page.frameLocator('#overlay-gate-host iframe').locator('body').waitFor();
    const button = await page.locator('#overlay-gate > button').boundingBox();
    const frame = await page.locator('#overlay-gate-host iframe').boundingBox(); assert(button && frame);
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2); await page.mouse.down(); await settle();
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2); await page.mouse.up(); await settle();
    assert.deepEqual(await page.evaluate(() => {
      const {root, session, events} = (window as unknown as GateWindow).overlayGate;
      return {events, sources: session.inputSources.length, state: session.domOverlayState, enabled: session.enabledFeatures.includes('dom-overlay'), popover: root.hasAttribute('popover'), transform: root.style.transform};
    }), {events: [], sources: 0, state: null, enabled: false, popover: false, transform: ''}, 'late shadow iframe entry/release cannot leak XR input or strand an XR touch');
  } finally {
    await page.mouse.up();
    await page.evaluate(async () => { const s = (window as unknown as GateWindow).overlayGate; await s.session.end(); s.root.remove(); s.canvas.remove(); });
  }
  return {enabled: false, configurations, lateShadowFrameEntryRelease: true};
}
