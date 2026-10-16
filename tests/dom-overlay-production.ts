import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import type {Page} from 'playwright';
import type * as Runtime from '../src/polyfill/api/runtime';
import type {XRWebGLLayer} from '../src/polyfill/api/layers';
import type {PanelProbeWindow} from './browser-types';

type OverlayWindow = Pick<PanelProbeWindow, 'panelProbe'> & typeof Runtime & {
  navigator: {xr: Runtime.XRSystem};
  XRWebGLLayer: typeof XRWebGLLayer;
  productionOverlay: {
    session: Runtime.XRSession; root: HTMLElement; button: HTMLButtonElement; input: HTMLInputElement;
    ancestor: HTMLElement; scroll: HTMLElement; frames: HTMLIFrameElement[];
    events: string[]; rays: number[]; clicks: number; cancel: boolean; endOnBefore: boolean;
    nativeBefore: {session: boolean; target: boolean; bubbles: boolean; composed: boolean; cancelable: boolean}[];
  };
};

/** Exercises shipped negotiation/presentation/input; no production monkey patches. */
export async function runDOMOverlayProduction(page: Page, stopWorker: () => Promise<void>) {
  await page.evaluate('globalThis.__name = value => value');
  await page.evaluate(async () => {
    const w = window as unknown as OverlayWindow;
    const ancestor = document.createElement('main');
    // Top-layer root must escape this ancestor's transform, opacity and clipping,
    // while retaining its inherited CSS properties and selector ancestry.
    Object.assign(ancestor.style, {transform: 'translate(200px, 300px)', overflow: 'hidden', width: '1px', height: '1px', opacity: '0.1', color: 'rgb(10, 20, 30)'});
    const root = document.createElement('section'); root.id = 'production-overlay'; root.style.setProperty('--original-style', 'preserved');
    const button = document.createElement('button'); button.textContent = 'Original live button';
    Object.assign(button.style, {position: 'absolute', left: '25%', top: '20%', width: '50%', height: '12%', border: '0', background: 'rgb(3, 241, 162)'});
    const input = document.createElement('input'); input.setAttribute('aria-label', 'Production input');
    Object.assign(input.style, {position: 'absolute', left: '25%', top: '40%', width: '50%', height: '8%'});
    const scroll = document.createElement('div'); Object.assign(scroll.style, {position: 'absolute', left: '25%', top: '55%', width: '50%', height: '10%', overflow: 'auto'});
    const tall = document.createElement('div'); tall.style.height = '2000px'; tall.textContent = 'Native scroll'; scroll.append(tall);
    root.append(button, input, scroll); ancestor.append(root); document.body.append(ancestor);
    const session = await w.navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['dom-overlay'], domOverlay: {root}});
    const state: OverlayWindow['productionOverlay'] = w.productionOverlay = {session, root, button, input, ancestor, scroll, frames: [], events: [], rays: [], clicks: 0, cancel: true, endOnBefore: false, nativeBefore: []};
    button.addEventListener('click', () => state.clicks++);
    root.addEventListener('beforexrselect', event => {
      state.events.push('before');
      state.nativeBefore.push({session: (event as unknown as Runtime.XRSessionEvent).session === session, target: event.target === button, bubbles: event.bubbles, composed: event.composed, cancelable: event.cancelable});
      if (state.cancel) event.preventDefault();
      if (state.endOnBefore) void session.end();
    });
    const viewer = await session.requestReferenceSpace('viewer');
    session.addEventListener('selectstart', event => {
      const input = event as Runtime.XRInputSourceEvent;
      const m = input.frame.getPose(input.inputSource.targetRaySpace, viewer)!.transform.matrix;
      state.rays.push(-m[9] / m[10]);
    });
    for (const name of ['selectstart', 'selectend', 'select']) session.addEventListener(name, () => state.events.push(name));
    const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl')!;
    document.body.append(canvas); await gl.makeXRCompatible();
    session.addEventListener('end', () => canvas.remove());
    session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
    const frame = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); if (!session.ended) session.requestAnimationFrame(frame); };
    session.requestAnimationFrame(frame);
  });
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const sample = () => page.evaluate(() => {
    const w = window as unknown as OverlayWindow, state = w.productionOverlay;
    const {renderer, scene, camera} = w.panelProbe!;
    let screen: import('three').Mesh | undefined;
    scene.traverse(o => { const m = o as import('three').Mesh<import('three').BufferGeometry, import('three').Material>; if (m.material?.customProgramCacheKey() === 'ar-screen-composite-v1') screen = m; });
    if (!screen) throw new Error('No production phone screen');
    screen.geometry.computeBoundingBox(); const box = screen.geometry.boundingBox!;
    const point = camera.position.clone().set((box.min.x + box.max.x) / 2, box.max.y - (box.max.y - box.min.y) * 0.23, 0);
    screen.localToWorld(point).project(camera);
    const display = renderer.domElement.getBoundingClientRect(), button = state.button.getBoundingClientRect();
    const center = {x: button.x + button.width / 2, y: button.y + button.height / 4};
    return {center, error: Math.hypot(center.x - (display.left + (point.x + 1) * display.width / 2), center.y - (display.top + (1 - point.y) * display.height / 2)),
      target: document.elementFromPoint(center.x, center.y) === state.button,
      identity: document.getElementById('production-overlay') === state.root && state.root.parentNode === state.ancestor,
      inheritedColor: getComputedStyle(state.root).color, clicks: state.clicks, events: state.events.slice(), before: state.nativeBefore.slice(),
      state: state.session.domOverlayState, width: state.root.offsetWidth, height: state.root.offsetHeight};
  });
  const evidence: object[] = [];
  async function capture(label: string) {
    await settle(); const current = await sample();
    assert(current.target && current.identity && current.error < 2, `${label}: live DOM pixel/hit geometry ${JSON.stringify(current)}`);
    assert.equal(current.inheritedColor, 'rgb(10, 20, 30)', 'root retains inherited styling');
    const cdp = await page.context().newCDPSession(page);
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}); await cdp.detach();
    await writeFile(`test-results/dom-overlay-production-${label}.png`, Buffer.from(shot.data, 'base64'));
    const pixel = await page.evaluate(async ({data, center}) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(center.x * img.width / innerWidth), Math.floor(center.y * img.height / innerHeight), 1, 1).data);
    }, {data: shot.data, center: current.center});
    [3, 241, 162, 255].forEach((value, i) => assert(Math.abs(pixel[i] - value) <= 2, `${label}: original live button pixel ${pixel}`));
    evidence.push({label, error: current.error, pixel, viewport: {width: current.width, height: current.height}});
    return current;
  }
  try {
    let current = await capture('initial');
    await stopWorker();
    await page.mouse.click(current.center.x, current.center.y);
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.events.includes('before'));
    await settle();
    current = await sample();
    assert.equal(current.clicks, 1, 'native click reaches original listener');
    assert.deepEqual(current.events, ['before'], 'canceling beforexrselect suppresses the entire XR action');
    assert.deepEqual(current.before[0], {session: true, target: true, bubbles: true, composed: true, cancelable: true});
    await page.locator('#production-overlay input').fill('retained live input');
    assert(await page.evaluate(() => { const s = (window as unknown as OverlayWindow).productionOverlay; return document.activeElement === s.input && s.input.value === 'retained live input'; }), 'native edit/focus retained');
    await page.evaluate(() => { const s = (window as unknown as OverlayWindow).productionOverlay; s.cancel = false; s.events.length = 0; });
    await page.mouse.move(current.center.x, current.center.y); await page.mouse.down();
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.events.includes('selectstart'));
    // Leaving the initial hit target while held must retain the action decision.
    await page.mouse.move(current.center.x + 1, current.center.y + 1); await page.mouse.up();
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.events.includes('selectend'));
    assert.deepEqual((await sample()).events, ['before', 'selectstart', 'select', 'selectend']);
    const targetRayY = await page.evaluate(() => (window as unknown as OverlayWindow).productionOverlay.rays[0]);
    assert(Math.abs(targetRayY - 0.54) < 0.01, `XR target ray uses the visible inner screen coordinates: ${targetRayY}`);
    const sessionState = await page.evaluate(() => (window as unknown as OverlayWindow).productionOverlay.session.domOverlayState);
    assert.deepEqual(sessionState, {type: 'screen'});
    // Move through the same production bridge used by the DevTools panel.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0.015, 1.6, -0.2], quaternion: [0, Math.sin(0.08), 0, Math.cos(0.08)]}})));
    current = await capture('phone-moved');
    await page.mouse.click(current.center.x, current.center.y); await settle();
    assert((await sample()).clicks >= 3, 'native hit testing follows translated/rotated phone');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [0.008, 1.6, 0], quaternion: [0, 0, 0, 1]}})));
    await capture('camera-moved');
    for (const pose of [
      {position: [0.015, 1.6, -0.2], quaternion: [0, 1, 0, 0]},
      {position: [0.015, 1.6, 0.2], quaternion: [0, 0, 0, 1]},
    ]) {
      await page.evaluate(pose => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', ...pose}})), pose);
      await settle();
      assert(await page.evaluate(() => getComputedStyle((window as unknown as OverlayWindow).productionOverlay.root).visibility === 'hidden'), 'back-facing/behind-camera phone has no live overlay hit surface');
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0.015, 1.6, -0.2], quaternion: [0, Math.sin(0.08), 0, Math.cos(0.08)]}})));
    await settle();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', {width: 900, height: 900, deviceScaleFactor: 2, mobile: false});
      current = await capture('resized-dpr2');
      await page.mouse.click(current.center.x, current.center.y); await settle();
      assert((await sample()).clicks >= 4, 'native click after active resize/DPR change');
      await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
    } finally { await cdp.detach(); }
    await settle();
    // Real browser scrolling, without injecting a substitute scroll event.
    const scroll = await page.locator('#production-overlay > div').boundingBox(); assert(scroll);
    const scrollPoint = {x: scroll.x + scroll.width / 2, y: scroll.y + scroll.height / 2};
    const scrollGeometry = await page.evaluate(p => { const s = (window as unknown as OverlayWindow).productionOverlay; return {point: p, target: s.scroll.contains(document.elementFromPoint(p.x, p.y)), height: s.scroll.clientHeight, total: s.scroll.scrollHeight, css: getComputedStyle(s.scroll).overflow, rootScroll: s.root.scrollTop, ended: s.session.ended}; }, scrollPoint);
    assert(scrollGeometry.target && scrollGeometry.total > scrollGeometry.height, 'native wheel targets the displayed scrollable content');
    await page.mouse.move(scrollPoint.x, scrollPoint.y); await settle();
    await page.mouse.wheel(0, 150);
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.scroll.scrollTop > 0).catch(async error => { console.log('scroll failure', await page.evaluate(p => { const s = (window as unknown as OverlayWindow).productionOverlay; return {rootScroll: s.root.scrollTop, scrollTop: s.scroll.scrollTop, target: document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,120)}; }, scrollPoint)); throw error; });
    evidence.push({nativeScroll: true, nativeClickFocus: true, cancelableBeforeXRSelect: true, workerSuspension: true});
    await page.evaluate(() => {
      const s = (window as unknown as OverlayWindow).productionOverlay;
      for (const [index, src] of [`${location.origin}/frame`, `${location.origin.replace('127.0.0.1', 'localhost')}/frame`, 'about:blank'].entries()) {
        const frame = document.createElement('iframe'); frame.src = src;
        if (index === 2) frame.setAttribute('sandbox', '');
        Object.assign(frame.style, {position: 'absolute', left: `${10 + index * 28}%`, top: '75%', width: '25%', height: '12%'});
        s.root.append(frame); s.frames.push(frame);
      }
    });
    await settle();
    for (let index = 0; index < 3; index++) {
      const box = await page.locator('#production-overlay iframe').nth(index).boundingBox(); assert(box);
      assert(await page.locator('#production-overlay iframe').nth(index).evaluate(frame => getComputedStyle(frame).pointerEvents === 'none'), 'embedded documents cannot receive native pointer input');
      const before = (await sample()).events.length;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await settle();
      assert.equal((await sample()).events.length, before, 'embedded browsing context receives no XR touch sequence');
    }
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.frames[0].contentDocument?.readyState === 'complete');
    await page.evaluate(() => {
      const s = (window as unknown as OverlayWindow).productionOverlay;
      const nested = s.frames[0].contentDocument!.createElement('iframe'); nested.src = s.frames[1].src;
      s.frames[0].contentDocument!.body.append(nested);
      // Origin and sandbox changes never grant interaction to a blocked context.
      s.frames[0].src = s.frames[1].src; s.frames[2].setAttribute('sandbox', 'allow-same-origin');
    });
    await settle();
    const blockedRegion = await page.locator('#production-overlay iframe').first().boundingBox(); assert(blockedRegion);
    const beforeFrameDrag = (await sample()).events.length;
    await page.mouse.move(blockedRegion.x + blockedRegion.width / 2, blockedRegion.y + blockedRegion.height / 2); await page.mouse.down();
    current = await sample(); await page.mouse.move(current.center.x, current.center.y); await page.mouse.up(); await settle();
    assert.equal((await sample()).events.length, beforeFrameDrag, 'a blocked frame press cannot create an XR action when dragged into the overlay');
    evidence.push({embeddedFramesBlocked: ['same-origin', 'cross-origin', 'opaque-sandbox', 'nested', 'navigation', 'sandbox mutation'], blockedPressDraggedOutside: true});
    // Shutdown within beforexrselect must not dispatch a later action or resurrect listeners.
    await page.evaluate(() => { const s = (window as unknown as OverlayWindow).productionOverlay; s.endOnBefore = true; s.events.length = 0; });
    current = await sample(); await page.mouse.click(current.center.x, current.center.y);
    await page.waitForFunction(() => (window as unknown as OverlayWindow).productionOverlay.session.ended);
    assert.deepEqual((await sample()).events, ['before']);
    assert(await page.evaluate(() => { const s = (window as unknown as OverlayWindow).productionOverlay; return s.root.style.cssText === '--original-style: preserved;' && !s.root.hasAttribute('popover') && s.root.parentNode === s.ancestor && s.frames.every(f => f.style.pointerEvents === ''); }), 'end restores original root/frame styles and DOM placement');
    for (const operation of ['remove', 'reparent', 'hide'] as const) {
      const result = await page.evaluate(async operation => {
        const w = window as unknown as OverlayWindow;
        const parent = document.createElement('div'), destination = document.createElement('div'), root = document.createElement('article');
        root.style.color = 'rgb(30, 40, 50)'; const original = root.getAttribute('style');
        parent.append(root); document.body.append(parent, destination);
        const session = await w.navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['dom-overlay'], domOverlay: {root}});
        if (operation === 'remove') root.remove();
        else if (operation === 'reparent') destination.append(root);
        else root.hidePopover();
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        const result = {ended: session.ended, restored: root.getAttribute('style') === original && !root.hasAttribute('popover'), position: operation !== 'reparent' || root.parentNode === destination};
        if (!session.ended) await session.end(); parent.remove(); destination.remove();
        return result;
      }, operation);
      assert.deepEqual(result, {ended: true, restored: true, position: true}, `${operation} ends overlay and restores styles without resurrecting/moving the root`);
    }
    evidence.push({lifecycle: ['session.end', 'end inside beforexrselect', 'root removal', 'root reparenting', 'top-layer dismissal']});
    return {presentation: 'production single live root', evidence, questEnabled: false};
  } finally {
    await page.evaluate(async () => {
      const s = (window as unknown as OverlayWindow).productionOverlay;
      if (!s.session.ended) await s.session.end(); s.ancestor.remove();
      window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [0, 1.6, 0], quaternion: [0, 0, 0, 1]}}));
      window.dispatchEvent(new CustomEvent('webxr-input-pose', {detail: {objectName: 'leftController', position: [0, 1.6, -0.2], quaternion: [0, 0, 0, 1]}}));
    });
  }
}
