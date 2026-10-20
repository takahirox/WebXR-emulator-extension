import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import type {Page} from 'playwright';
import type * as Runtime from '../src/polyfill/api/runtime';
import type {XRWebGLLayer} from '../src/polyfill/api/layers';
import type {PanelProbeWindow} from './browser-types';

type PreviewWindow = typeof Runtime & Pick<PanelProbeWindow, 'panelProbe'> & {
  navigator: {xr: Runtime.XRSystem}; XRWebGLLayer: typeof XRWebGLLayer;
  preview: {session: Runtime.XRSession; root: HTMLElement; ancestor: HTMLElement; button: HTMLButtonElement;
    input: HTMLInputElement; checkbox: HTMLInputElement; scroll: HTMLElement; canvas: HTMLCanvasElement;
    clicks: number; events: string[]; xrEvents: string[]; style: string | null; listeners: AbortController; lateFrame?: HTMLIFrameElement};
};

/** Real public negotiation and native desktop input; no internal overlay access. */
export async function runDOMOverlayPreview(page: Page, phone: boolean, stopWorker: () => Promise<void>) {
  await page.mouse.click(10, 10); // Real transient activation after page reload.
  const label = phone ? 'android' : 'quest';
  const evidence: object[] = [];
  await page.evaluate('globalThis.__name = value => value');
  const start = async (kind: 'projected' | 'fixed' | 'body' | 'hidden' = 'projected', required = true) => {
    await page.evaluate(async ({kind, required}) => {
      const w = window as unknown as PreviewWindow;
      const ancestor = document.createElement('main');
      Object.assign(ancestor.style, {transform: 'translate(200px, 300px)', overflow: 'hidden', width: '1px', height: '1px', opacity: '0.1', color: 'rgb(10, 20, 30)'});
      const root = kind === 'body' ? document.body : document.createElement('section'); root.id = 'preview-root';
      if (kind !== 'body') { root.style.setProperty('--original-style', 'preserved'); ancestor.append(root); document.body.append(ancestor); }
      if (kind === 'hidden') root.style.display = 'none';
      const initialStyle = root.getAttribute('style');
      const button = document.createElement('button'); button.textContent = 'Original live button';
      Object.assign(button.style, {position: kind === 'fixed' ? 'fixed' : 'absolute', left: '25%', top: '20%', width: '50%', height: '12%', border: '0', background: 'rgb(3, 241, 162)'});
      const input = document.createElement('input'); input.setAttribute('aria-label', 'Preview input'); input.value = 'original mutable state';
      Object.assign(input.style, {position: 'absolute', left: '25%', top: '40%', width: '50%', height: '8%'});
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Preview checkbox');
      Object.assign(checkbox.style, {position: 'absolute', left: '25%', top: '50%', width: '24px', height: '24px'});
      const scroll = document.createElement('div'); scroll.id = 'preview-scroll';
      Object.assign(scroll.style, {position: 'absolute', left: '25%', top: '60%', width: '50%', height: '15%', overflow: 'auto'});
      const tall = document.createElement('div'); tall.style.height = '2000px'; tall.textContent = 'Native scroll'; scroll.append(tall);
      root.append(button, input, checkbox, scroll);
      const events: string[] = [], xrEvents: string[] = []; let clicks = 0;
      const listeners = new AbortController();
      // Existing listeners are installed BEFORE requestSession, as in an ordinary app.
      button.addEventListener('click', () => { clicks++; button.textContent = `App clicked ${clicks}`; w.preview.clicks = clicks; });
      for (const name of ['input', 'change', 'focusin', 'click']) root.addEventListener(name, event => { events.push(`${name}:${event.isTrusted}`); }, {signal: listeners.signal});
      root.addEventListener('beforexrselect', () => xrEvents.push('beforexrselect'), {signal: listeners.signal});
      input.focus({preventScroll: true});
      const session = await w.navigator.xr.requestSession('immersive-ar', {
        [required ? 'requiredFeatures' : 'optionalFeatures']: ['dom-overlay'], domOverlay: {root},
      });
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const gl = canvas.getContext('webgl')!; await gl.makeXRCompatible();
      session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
      for (const name of ['selectstart', 'select', 'selectend']) session.addEventListener(name, () => xrEvents.push(name));
      const frame = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); if (!session.ended) session.requestAnimationFrame(frame); };
      session.requestAnimationFrame(frame);
      w.preview = {session, root, ancestor, button, input, checkbox, scroll, canvas, clicks, events, xrEvents, listeners,
        style: initialStyle};
    }, {kind, required});
  };
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  async function capture(name: string, projected = phone) {
    await settle();
    const geometry = await page.evaluate(projected => {
      const w = window as unknown as PreviewWindow, s = w.preview;
      const button = s.button.getBoundingClientRect();
      // Sample away from text, but inside the colored button.
      const point = {x: button.x + button.width / 2, y: button.y + button.height / 4};
      let error = 0;
      if (projected) {
        const {scene, camera, renderer} = w.panelProbe!;
        let screen: import('three').Mesh | undefined;
        scene.traverse(o => { const m = o as import('three').Mesh<import('three').BufferGeometry, import('three').Material>; if (m.material?.customProgramCacheKey() === 'ar-screen-composite-v1') screen = m; });
        if (!screen) throw new Error('No phone screen');
        screen.geometry.computeBoundingBox(); const box = screen.geometry.boundingBox!;
        const p = camera.position.clone().set((box.min.x + box.max.x) / 2, box.max.y - (box.max.y - box.min.y) * 0.23, 0);
        screen.localToWorld(p).project(camera); const r = renderer.domElement.getBoundingClientRect();
        error = Math.hypot(point.x - (r.left + (p.x + 1) * r.width / 2), point.y - (r.top + (1 - p.y) * r.height / 2));
      }
      return {point, error, sameRoot: document.getElementById('preview-root') === s.root,
        sameParent: s.root === document.body || s.root.parentNode === s.ancestor,
        target: document.elementFromPoint(point.x, point.y) === s.button, state: s.session.domOverlayState,
        enabled: s.session.enabledFeatures.includes('dom-overlay'), width: s.root.offsetWidth, height: s.root.offsetHeight};
    }, projected);
    assert(geometry.sameRoot && geometry.sameParent && geometry.target && geometry.error < 2, `${label} ${name}: ${JSON.stringify(geometry)}`);
    assert(geometry.enabled); assert.deepEqual(geometry.state, {type: 'screen'});
    const cdp = await page.context().newCDPSession(page);
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}); await cdp.detach();
    await writeFile(`test-results/dom-overlay-preview-${label}-${name}.png`, Buffer.from(shot.data, 'base64'));
    const pixel = await page.evaluate(async ({data, point}) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(point.x * img.width / innerWidth), Math.floor(point.y * img.height / innerHeight), 1, 1).data);
    }, {data: shot.data, point: geometry.point});
    [3, 241, 162, 255].forEach((value, i) => assert(Math.abs(pixel[i] - value) <= 2, `${label} ${name}: visible button pixel ${pixel}`));
    evidence.push({name, ...geometry, pixel}); return geometry;
  }
  async function interact() {
    const checkedBefore = await page.evaluate(() => (window as unknown as PreviewWindow).preview.checkbox.checked);
    const geometry = await capture(`interaction-${evidence.length}`);
    await page.mouse.click(geometry.point.x, geometry.point.y);
    await page.getByLabel('Preview checkbox', {exact: true}).click();
    await page.getByLabel('Preview input', {exact: true}).click();
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('native edit'); await page.keyboard.press('Tab');
    await page.evaluate(() => { (window as unknown as PreviewWindow).preview.scroll.scrollTop = 0; });
    const scroll = await page.locator('#preview-scroll').boundingBox(); assert(scroll);
    await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2); await page.mouse.wheel(0, 150);
    await page.waitForFunction(() => (window as unknown as PreviewWindow).preview.scroll.scrollTop > 0);
    const result = await page.evaluate(() => { const s = (window as unknown as PreviewWindow).preview; return {clicks: s.clicks, value: s.input.value, checked: s.checkbox.checked, events: s.events, xrEvents: s.xrEvents}; });
    assert(result.clicks > 0); assert.equal(result.value, 'native edit');
    assert.equal(result.checked, !checkedBefore, 'native checkbox changes original mutable state');
    assert(result.events.includes('input:true') && result.events.includes('change:true') && result.events.includes('focusin:true') && result.events.includes('click:true'));
    assert.deepEqual(result.xrEvents, [], 'DOM actions never generate XR input or beforexrselect');
    evidence.push({nativeInteraction: result});
  }
  async function clean() {
    await page.evaluate(async () => {
      const s = (window as unknown as PreviewWindow).preview;
      if (!s.session.ended) await s.session.end();
      if (s.root.hasAttribute('popover') || s.root.getAttribute('style') !== s.style) throw new Error(`Root attributes were not restored: ${JSON.stringify({id: s.root.id, expected: s.style, actual: s.root.getAttribute('style'), popover: s.root.getAttribute('popover')})}`);
      if (s.root === document.body) { s.root.removeAttribute('id'); s.button.remove(); s.input.remove(); s.checkbox.remove(); s.scroll.remove(); }
      else s.ancestor.remove();
      s.listeners.abort(); s.canvas.remove();
    });
  }
  const policy = await page.evaluate(async () => {
    const w = window as unknown as PreviewWindow, results: string[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const shadowRoot = document.createElement('section'); host.attachShadow({mode: 'closed'}).append(shadowRoot);
    const popover = document.createElement('section'); popover.setAttribute('popover', 'manual'); document.body.append(popover);
    const inert = document.createElement('section'); inert.inert = true; document.body.append(inert);
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    try {
      for (const [name, root] of [
        ['missing', undefined], ['disconnected', document.createElement('section')], ['document', document.documentElement],
        ['SVG', document.createElementNS('http://www.w3.org/2000/svg', 'svg')], ['shadow-root', shadowRoot],
        ['popover', popover], ['inert', inert], ['iframe', iframe], ['foreign', iframe.contentDocument!.body],
      ] as const) {
        for (const required of [true, false]) {
          let session: Runtime.XRSession | undefined;
          try {
            session = await w.navigator.xr.requestSession('immersive-ar', {
              [required ? 'requiredFeatures' : 'optionalFeatures']: ['dom-overlay'], ...(root ? {domOverlay: {root}} : {}),
            });
            if (required || session.domOverlayState !== null || session.enabledFeatures.includes('dom-overlay')) throw new Error(`${name}: enabled unsupported root`);
          } catch (error) { if (!required || (error as Error).name !== 'NotSupportedError') throw error; }
          finally { if (session) await session.end(); }
        }
        results.push(name);
      }
      // Presentation can be canceled by application beforetoggle listeners.
      const canceled = document.createElement('section'); document.body.append(canceled);
      canceled.addEventListener('beforetoggle', event => event.preventDefault());
      try {
        for (const required of [false, true]) {
          let session: Runtime.XRSession | undefined;
          try {
            session = await w.navigator.xr.requestSession('immersive-ar', {[required ? 'requiredFeatures' : 'optionalFeatures']: ['dom-overlay'], domOverlay: {root: canceled}});
            if (required || session.domOverlayState !== null || session.enabledFeatures.includes('dom-overlay')) throw new Error('Canceled preview was enabled');
          } catch (error) { if (!required || (error as Error).name !== 'NotSupportedError') throw error; }
          finally { if (session) await session.end(); }
          if (canceled.hasAttribute('popover') || canceled.getAttribute('style') !== null) throw new Error('Canceled preview root was not restored');
        }
      } finally { canceled.remove(); }
      const inline = await w.navigator.xr.requestSession('inline', {optionalFeatures: ['dom-overlay'], domOverlay: {root: document.body}});
      if (inline.domOverlayState !== null || inline.enabledFeatures.includes('dom-overlay')) throw new Error('Inline preview enabled');
      await inline.end();
    } finally { host.remove(); popover.remove(); inert.remove(); iframe.remove(); }
    return results;
  });
  evidence.push({unsupportedRootPolicy: policy});
  try {
    await start(); await capture('initial');
    assert(await page.evaluate(() => { const s = (window as unknown as PreviewWindow).preview; return document.activeElement === s.input && s.input.value === 'original mutable state'; }), 'startup preserves focus and mutable state');
    await stopWorker(); await interact();
    if (phone) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0.015, 1.6, -0.2], quaternion: [0, Math.sin(0.08), 0, Math.cos(0.08)]}})));
      await capture('phone-moved');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [0.008, 1.6, 0], quaternion: [0, 0, 0, 1]}})));
      await capture('camera-moved');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0, 1.6, -0.2], quaternion: [0, 1, 0, 0]}})));
      await settle();
      assert(await page.evaluate(() => (window as unknown as PreviewWindow).preview.button.getClientRects().length === 0), 'back-facing phone has no stale interactive DOM');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0, 1.6, -0.2], quaternion: [0, 0, 0, 1]}})));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [0, 1.6, 0], quaternion: [0, 0, 0, 1]}})));
    }
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', {width: 900, height: 900, deviceScaleFactor: 2, mobile: false});
      await capture('resized-dpr2'); await interact();
      await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
      await capture('restored-dpr1'); await interact();
    } finally { await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach(); }
    // Late opaque content needs no inspection: no XR-derived event path exists.
    await page.evaluate(async () => {
      const s = (window as unknown as PreviewWindow).preview;
      const host = document.createElement('div'); s.root.append(host);
      const frame = document.createElement('iframe'); frame.src = `${location.origin.replace('127.0.0.1', 'localhost')}/frame`;
      Object.assign(frame.style, {position: 'absolute', left: '60%', top: '80%', width: '25%', height: '12%', border: '0'});
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
      s.lateFrame = frame; host.attachShadow({mode: 'closed'}).append(frame);
      await loaded;
    });
    await settle();
    const late = await page.evaluate(() => { const s = (window as unknown as PreviewWindow).preview;
      const b = s.button.getBoundingClientRect(), f = s.lateFrame!.getBoundingClientRect();
      return {button: {x: b.x + b.width / 2, y: b.y + b.height / 2}, frame: {x: f.x + f.width / 2, y: f.y + f.height / 2}, sources: s.session.inputSources.length};
    });
    await page.mouse.move(late.button.x, late.button.y); await page.mouse.down(); await settle();
    await page.mouse.move(late.frame.x, late.frame.y); await page.mouse.up(); await settle();
    assert.deepEqual(await page.evaluate(() => (window as unknown as PreviewWindow).preview.xrEvents), [], 'entry/release in a late closed-shadow cross-origin frame never forwards XR data');
    assert.equal(await page.evaluate(() => (window as unknown as PreviewWindow).preview.session.inputSources.length), late.sources, 'no stranded XR source after iframe release');
    evidence.push({lateClosedShadowFrameRelease: true, xrEvents: []});
    await clean();
    // Both optional and required public requests enable the supported preview.
    await start('fixed', false); await capture('flat-fallback', false); await clean();
    if (phone) { await start('body'); await capture('body-fallback', false); await clean(); }
    await start('hidden');
    const revealed = await capture('initially-hidden');
    await page.mouse.click(revealed.point.x, revealed.point.y);
    assert.equal(await page.evaluate(() => (window as unknown as PreviewWindow).preview.clicks), 1, 'initially hidden app root becomes interactive');
    await clean();
    for (const action of ['remove', 'reparent', 'dismiss', 'pagehide'] as const) {
      await start();
      await page.evaluate(action => { const s = (window as unknown as PreviewWindow).preview;
        if (action === 'remove') s.root.remove();
        if (action === 'reparent') document.body.append(s.root);
        if (action === 'dismiss') s.root.hidePopover();
        if (action === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      }, action);
      await page.waitForFunction(() => (window as unknown as PreviewWindow).preview.session.ended);
      if (action === 'reparent') assert(await page.evaluate(() => (window as unknown as PreviewWindow).preview.root.parentNode === document.body), 'cleanup preserves app reparenting');
      if (action === 'remove') assert(await page.evaluate(() => !(window as unknown as PreviewWindow).preview.root.isConnected), 'cleanup never resurrects app root');
      await page.evaluate(() => { const s = (window as unknown as PreviewWindow).preview; if (s.root.parentNode !== s.ancestor) s.root.remove(); });
      await clean(); evidence.push({cleanup: action});
    }
    return {profile: label, scope: 'opt-in interactive preview, not DOM Overlay conformance', evidence};
  } finally {
    await page.evaluate(async () => { const s = (window as unknown as PreviewWindow).preview; if (s && !s.session.ended) await s.session.end(); });
  }
}
