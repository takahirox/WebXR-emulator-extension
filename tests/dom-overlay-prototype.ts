import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';

/** Research fixture only. Never installed by the extension or advertised as a feature. */
export async function runDOMOverlayPrototype(page: Page, handheld: boolean, variant: string) {
  await page.evaluate('globalThis.__name = value => value');
  const profile = handheld ? 'phone' : 'quest';
  const setup = await page.evaluate(handheld => {
    const probe = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
    const {renderer, scene, camera} = probe;
    const host = document.createElement('div'); host.id = 'overlay-research';
    Object.assign(host.style, {position: 'fixed', inset: '0', zIndex: '10002', pointerEvents: 'none', overflow: 'hidden'});
    const root = document.createElement('section'); root.id = 'overlay-research-root';
    Object.assign(root.style, {position: 'absolute', left: '0', top: '0', width: '320px', height: '640px', transformOrigin: '0 0', background: 'transparent', contain: 'paint', pointerEvents: 'auto'});
    const button = document.createElement('button'); button.textContent = 'Live DOM';
    Object.assign(button.style, {position: 'absolute', left: '80px', top: '160px', width: '160px', height: '80px', background: 'rgb(3, 241, 162)', border: '0', color: 'black'});
    const input = document.createElement('input'); input.setAttribute('aria-label', 'Research input');
    Object.assign(input.style, {position: 'absolute', left: '80px', top: '320px', width: '160px', height: '50px'});
    root.append(button, input); host.append(root); document.body.append(host);
    let clicks = 0; button.addEventListener('click', () => { clicks++; });
    const style = document.createElement('style');
    // A real stylesheet, not a replacement selector or patched matches().
    style.textContent = ':xr-overlay { --research-native-overlay: active; }';
    document.head.append(style);
    let screen: import('three').Mesh | undefined;
    if (handheld) scene.traverse(object => {
      const mesh = object as import('three').Mesh<import('three').BufferGeometry, import('three').Material>;
      if (mesh.material?.customProgramCacheKey() === 'ar-screen-composite-v1') screen = mesh;
    });
    if (handheld && !screen) throw new Error('No actual phone screen for DOM projection');
    const originalCameraPosition = camera.position.clone();
    const originalCameraQuaternion = camera.quaternion.clone();
    const originalPosition = screen?.parent?.position.clone();
    const originalQuaternion = screen?.parent?.quaternion.clone();
    let stopped = false;
    let frameHandle = 0;
    const project = () => {
      if (stopped) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (screen) {
        screen.updateWorldMatrix(true, false);
        screen.geometry.computeBoundingBox();
        const box = screen.geometry.boundingBox!;
        const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y;
        // DOM pixels -> phone plane -> clip space -> CSS viewport pixels.
        // Use the bundled scene's Matrix4 implementation via clone().
        const local = screen.matrixWorld.clone().set(sx / 320, 0, 0, box.min.x, 0, -sy / 640, 0, box.max.y, 0, 0, 1, 0, 0, 0, 0, 1);
        const viewport = local.clone().set(rect.width / 2, 0, 0, rect.left + rect.width / 2, 0, -rect.height / 2, 0, rect.top + rect.height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
        const matrix = viewport.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(screen.matrixWorld).multiply(local);
        root.style.transform = `matrix3d(${matrix.elements.join(',')})`;
      } else {
        // Candidate head-locked rectangles within the real MR eye viewports.
        const scale = Math.min(rect.width / 2 / 320, rect.height / 640) * 0.8;
        root.style.transform = `translate(${rect.left + rect.width / 4 - 160 * scale}px, ${rect.top + rect.height / 2 - 320 * scale}px) scale(${scale})`;
        if (copy) copy.style.transform = `translate(${rect.left + rect.width * 3 / 4 - 160 * scale}px, ${rect.top + rect.height / 2 - 320 * scale}px) scale(${scale})`;
      }
      frameHandle = requestAnimationFrame(project);
    };
    let copy: HTMLElement | null = null;
    let singleRootCanOccupyBothEyes: boolean | null = null;
    if (!handheld) {
      const left = document.createElement('div'), right = document.createElement('div');
      left.append(root); right.append(root);
      singleRootCanOccupyBothEyes = left.contains(root) && right.contains(root);
      host.append(root);
      // Exercise the tempting clone workaround, then demonstrate lost identity,
      // listener and live control-state synchronization with browser input.
      copy = root.cloneNode(true) as HTMLElement; copy.id = 'overlay-research-copy'; host.append(copy);
    }
    const scratch = document.createElement('canvas').getContext('2d')!;
    let drawImageError = '';
    try { scratch.drawImage(root as unknown as CanvasImageSource, 0, 0); }
    catch (error) { drawImageError = (error as Error).name; }
    project();
    const research = {
      root, copy, button, input,
      sample: () => {
        const centers = [button, ...(copy ? [copy.querySelector('button')!] : [])].map(element => {
          const rect = element.getBoundingClientRect();
          return {x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.2};
        });
        let projectionError: number | null = null;
        if (screen) {
          const box = screen.geometry.boundingBox!;
          const point = camera.position.clone().set((box.min.x + box.max.x) / 2, box.max.y - (box.max.y - box.min.y) * 176 / 640, 0);
          screen.localToWorld(point).project(camera);
          const rect = renderer.domElement.getBoundingClientRect();
          projectionError = Math.hypot(centers[0].x - (rect.left + (point.x + 1) * rect.width / 2), centers[0].y - (rect.top + (1 - point.y) * rect.height / 2));
        }
        return {clicks, centers, projectionError, identity: document.getElementById('overlay-research-root') === root,
          focused: document.activeElement === input, copyValue: copy?.querySelector('input')?.value,
          value: input.value, nativeOverlayStyle: getComputedStyle(root).getPropertyValue('--research-native-overlay').trim(),
          topmost: centers.map(p => document.elementFromPoint(p.x, p.y)?.tagName)};
      },
      move: () => {
        if (!screen?.parent) return;
        screen.parent.position.x += 0.012;
        screen.parent.rotation.y += 0.12;
      },
      moveCamera: () => { camera.position.x += 0.008; },
      stop: () => {
        stopped = true; cancelAnimationFrame(frameHandle);
        if (screen?.parent && originalPosition && originalQuaternion) {
          screen.parent.position.copy(originalPosition); screen.parent.quaternion.copy(originalQuaternion);
        }
        camera.position.copy(originalCameraPosition); camera.quaternion.copy(originalCameraQuaternion);
        host.remove(); style.remove();
      },
    };
    (window as unknown as {overlayResearch: typeof research}).overlayResearch = research;
    return {drawImageError, drawElementAvailable: 'drawElement' in scratch, drawElementImageAvailable: 'drawElementImage' in scratch,
      canvasLayoutSubtreeAvailable: 'layoutSubtree' in scratch.canvas,
      webglElementUploadAvailable: 'texElementImage2D' in WebGL2RenderingContext.prototype,
      webglElementSubUploadAvailable: 'texElementSubImage2D' in WebGL2RenderingContext.prototype,
      canvasUpdateGeometryAvailable: 'updateElementGeometry' in scratch.canvas,
      singleRootCanOccupyBothEyes, pseudoClassRecognized: CSS.supports('selector(:xr-overlay)'),
      nativeRuleCount: style.sheet?.cssRules.length};
  }, handheld);
  const sample = () => page.evaluate(() => (window as unknown as {overlayResearch: {sample(): {clicks: number; centers: {x: number; y: number}[]; projectionError: number | null; identity: boolean; focused: boolean; copyValue?: string; value: string; nativeOverlayStyle: string; topmost: (string | undefined)[]}}}).overlayResearch.sample());
  const pixels: {label: string; colors: number[][]; projectionError: number | null}[] = [];
  async function capture(label: string) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const current = await sample();
    if (handheld) assert(current.projectionError !== null && current.projectionError < 2, `DOM projection follows independently projected phone point: ${current.projectionError}`);
    assert(current.topmost.every(tag => tag === 'BUTTON'), `projected native DOM hit targets match visible controls: ${JSON.stringify(current)}`);
    const cdp = await page.context().newCDPSession(page);
    let screenshot: {data: string};
    try { screenshot = await cdp.send('Page.captureScreenshot', {format: 'png'}); }
    finally { await cdp.detach(); }
    await mkdir('test-results', {recursive: true});
    await writeFile(`test-results/dom-overlay-${profile}-${variant}-${label}.png`, Buffer.from(screenshot.data, 'base64'));
    const colors = await page.evaluate(async ({data, centers}) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return centers.map(p => Array.from(ctx.getImageData(Math.floor(p.x * image.width / innerWidth), Math.floor(p.y * image.height / innerHeight), 1, 1).data));
    }, {data: screenshot.data, centers: current.centers});
    for (const color of colors) [3, 241, 162, 255].forEach((v, i) => assert(Math.abs(color[i] - v) <= 2, `overlay marker pixel ${label}: ${color}`));
    pixels.push({label, colors, projectionError: current.projectionError});
    return current;
  }
  try {
    assert.equal(setup.drawImageError, 'TypeError', 'a live Element is not a canvas image source');
    const initial = await capture('initial');
    await page.mouse.click(initial.centers[0].x, initial.centers[0].y);
    assert.equal((await sample()).clicks, 1, 'browser click reaches original listener');
    await page.locator('#overlay-research-root input').fill('live state');
    const edited = await sample();
    assert(edited.identity && edited.focused && edited.value === 'live state', 'single projected root retains identity, focus, and control state');
    assert.equal(edited.nativeOverlayStyle, '', 'native :xr-overlay rule is inactive in extension-created projection');
    if (handheld) {
      await page.evaluate(() => (window as unknown as {overlayResearch: {move(): void}}).overlayResearch.move());
      const moved = await capture('moved');
      assert(Math.abs(moved.centers[0].x - initial.centers[0].x) > 1, 'projection tracks actual phone movement');
      await page.mouse.click(moved.centers[0].x, moved.centers[0].y);
      assert.equal((await sample()).clicks, 2, 'native hit testing follows moved phone projection');
      await page.evaluate(() => (window as unknown as {overlayResearch: {moveCamera(): void}}).overlayResearch.moveCamera());
      const cameraMoved = await capture('camera-moved');
      assert(Math.abs(cameraMoved.centers[0].x - moved.centers[0].x) > 1, 'projection tracks observer camera movement');
    } else {
      assert.equal(setup.singleRootCanOccupyBothEyes, false, 'one root cannot be parented in two eye views');
      await page.mouse.click(initial.centers[1].x, initial.centers[1].y);
      const cloned = await sample();
      assert.equal(cloned.clicks, 1, 'right-eye clone does not retain original listener');
      assert.equal(cloned.copyValue, '', 'right-eye clone does not track live form state');
      await capture('clone-diverged');
    }
    return {profile, variant, ...setup, pixels, originalClickAndFocus: true, nativeOverlayStyleActive: false,
      supported: false, blocker: handheld ? 'Prototype only: no XR input/security/lifecycle implementation' : 'Clone loses root identity, listeners and live control state'};
  } finally {
    await page.evaluate(() => {
      const state = window as unknown as {overlayResearch?: {stop(): void}};
      state.overlayResearch?.stop(); delete state.overlayResearch;
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator('#overlay-research').count(), 0, 'research fixture removes DOM and restores phone pose');
  }
}
