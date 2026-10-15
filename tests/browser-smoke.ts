import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { attachTarget, getTargets } from './cdp-target';
import type { SmokeWindow } from './browser-types';

const executablePath = process.env.WEBXR_CHROMIUM_EXECUTABLE;
// Defaults to the current Playwright desktop Chromium (npx playwright install chromium).
const root = process.cwd();
const fixture = ts.transpileModule(await readFile(path.join(root, 'tests/fixture.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None},
}).outputText;
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(fixture);
  } else if (request.url === '/' || request.url === '/frame' || request.url === '/csp') {
    if (request.url === '/csp') response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; img-src 'self' blob: data:; frame-src 'self' http://localhost:*; style-src 'self' 'unsafe-inline'; object-src 'none'");
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><script src="/fixture.js"></script></head><body>WebXR regression sample</body></html>');
  } else { response.statusCode = 204; response.end(); }
});
server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'webxr-smoke-'));
const context = await chromium.launchPersistentContext(profile, {
  ...(executablePath ? {executablePath} : {channel: 'chromium'}),
  headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--auto-open-devtools-for-tabs', '--enable-unsafe-swiftshader'],
}).catch(async error => { server.close(); await rm(profile, {recursive: true, force: true}); throw error; });
const attached: Awaited<ReturnType<typeof attachTarget>>[] = [];
try {
  context.setDefaultTimeout(20000);
  console.log('Checking MV3 installation and synchronous injection');
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert(worker.url().endsWith('/dist/extension/background.js'), 'MV3 service worker installed');
  const extensionOrigin = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length));
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/src/extension/popup.html`);
  assert.match(await popup.locator('body').innerText(), /Open "WebXR" tab/);
  await popup.close();
  await page.goto(`${origin}/csp`);
  assert.equal(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.synchronousXR), true, 'navigator.xr must be installed before the first page script');
  assert.equal(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.synchronousGlobals), true, 'XR globals must exist in the first script');
  assert.equal(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.overridesNativeXR), true, 'the first script sees the emulator instead of native WebXR');
  assert.equal(await page.evaluate(() => !!(window as unknown as {chrome?: {runtime?: {id?: string}}}).chrome?.runtime?.id), false);
  const cdp = await context.newCDPSession(page);
  const workerVersions = new Map<string, {versionId: string; scriptURL: string; runningStatus: string}>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({versions}) => {
    for (const version of versions) workerVersions.set(version.versionId, version);
  });
  await cdp.send('ServiceWorker.enable');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background?.service_worker, 'dist/extension/background.js');
  async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const value = await read();
      if (accept(value)) return value;
      await page.waitForTimeout(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  console.log('Opening WebXR DevTools panel');
  async function stopWorker() {
    const running = await eventually(async () => [...workerVersions.values()].find(version => version.scriptURL === worker.url() && version.runningStatus === 'running'), Boolean, 'running worker version');
    await cdp.send('ServiceWorker.stopWorker', {versionId: running!.versionId});
    // Playwright retains its Worker object across suspension. Observe Chrome's
    // actual lifecycle state instead of waiting for a new Playwright object.
    await eventually(async () => workerVersions.get(running!.versionId)?.runningStatus, status => status === 'stopped', 'worker stopped');
  }
  const devtoolsInfo = await eventually(async () => (await getTargets(cdp)).find(target => target.url.startsWith('devtools://') && target.title.includes(`127.0.0.1:${address.port}`)), Boolean, 'DevTools target');
  const devtools = await attachTarget(cdp, devtoolsInfo!.targetId);
  attached.push(devtools);
  await eventually(() => devtools.evaluate(async () => {
    const modulePath = './ui/legacy/legacy.js';
    const ui = await import(modulePath) as {InspectorView: {InspectorView: {instance(): {tabbedPane: {tabIds(): string[]}; showPanel(id: string): Promise<unknown>}}}};
    const inspector = ui.InspectorView.InspectorView.instance();
    const id = inspector.tabbedPane.tabIds().find(id => id.endsWith('WebXR'));
    if (!id) return false;
    await inspector.showPanel(id);
    return true;
  }), Boolean, 'registered WebXR DevTools tab');
  const panelInfo = await eventually(async () => (await getTargets(cdp)).find(target => target.url.endsWith('/src/app/panel.html')), Boolean, 'panel target');
  const panel = await attachTarget(cdp, panelInfo!.targetId);
  attached.push(panel);
  await eventually(() => panel.evaluate(() => document.querySelector('#rightControllerPosition')?.textContent), value => !!value, 'loaded controller assets');
  assert.equal(await panel.evaluate(() => (document.querySelector('#deviceSelect') as HTMLSelectElement).value), 'Oculus Quest');
  assert.equal(await panel.evaluate(() => document.querySelectorAll('canvas').length), 1);
  await panel.evaluate(() => {
    const select = document.querySelector('#deviceSelect') as HTMLSelectElement;
    select.value = 'HTC Vive';
    select.dispatchEvent(new Event('change'));
    const checkbox = document.querySelector('#stereoCheckbox') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
  });
  await eventually(() => panel.evaluate(async () => JSON.parse((await new Promise<Record<string, unknown>>(resolve => chrome.storage.local.get('webxr-extension', result => resolve(result))))['webxr-extension'] as string) as {deviceKey: string; stereoEffect: boolean}), value => value.deviceKey === 'HTC Vive' && value.stereoEffect === false, 'configuration persistence');
  await panel.evaluate(() => { location.reload(); });
  await eventually(() => panel.evaluate(() => ({device: (document.querySelector('#deviceSelect') as HTMLSelectElement | null)?.value, stereo: (document.querySelector('#stereoCheckbox') as HTMLInputElement | null)?.checked, pose: document.querySelector('#rightControllerPosition')?.textContent})), value => value.device === 'HTC Vive' && value.stereo === false && !!value.pose, 'restored panel configuration');
  console.log('Checking VR controls');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-vr'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.frames > 2);
  console.log('Checking content-to-panel recovery after worker shutdown');
  await stopWorker();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('device-pose', {detail: {position: [0.3, 1.8, 0.1], quaternion: [0, 0, 0, 1]}}));
    window.dispatchEvent(new CustomEvent('device-input-pose', {detail: {objectName: 'rightController', position: [0.7, 1.4, -0.8], quaternion: [0, 0, 0, 1]}}));
  });
  await eventually(() => panel.evaluate(() => [document.querySelector('#headsetPosition')?.textContent, document.querySelector('#rightControllerPosition')?.textContent]), value => value[0] === '0.30 1.80 0.10' && value[1] === '0.70 1.40 -0.80', 'page-to-panel pose bridge');
  console.log('Checking panel-to-content recovery after worker shutdown');
  await stopWorker();
  await panel.evaluate(() => { (document.querySelector('#resetPoseButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(() => Math.abs((window as unknown as SmokeWindow).smoke.state.viewerPosition[1]) < 0.01 && Math.abs((window as unknown as SmokeWindow).smoke.state.inputPositions.right?.[0] - 0.5) < 0.01);
  // Observe one real render to use the actual camera/scene for deterministic gizmo input.
  await panel.evaluate(() => {
    const probeWindow = window as unknown as import('./browser-types').PanelProbeWindow;
    const original = window.THREE.Scene.prototype.onBeforeRender;
    window.THREE.Scene.prototype.onBeforeRender = new Proxy(original, {
      apply(render, scene: import('three').Scene, args: Parameters<typeof original>) {
        probeWindow.panelProbe = {renderer: args[0], scene: args[1], camera: args[2]};
        window.THREE.Scene.prototype.onBeforeRender = render;
        return Reflect.apply(render, scene, args);
      },
    });
    window.dispatchEvent(new Event('resize'));
  });
  await eventually(() => panel.evaluate(() => !!(window as unknown as import('./browser-types').PanelProbeWindow).panelProbe), Boolean, 'panel camera capture');
  for (const position of [[0, 1.6, 0], [0.5, 1.5, -1]]) {
    await panel.evaluate((position: number[]) => {
      const {renderer, scene, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
      const center = new window.THREE.Vector3().fromArray(position);
      for (const child of scene.children) {
        if (!(child instanceof window.THREE.TransformControls)) continue;
        const selected = !!child.object && child.object.position.distanceTo(center) < 0.001;
        child.enabled = selected;
        child.visible = selected;
        if (selected) child.setMode('translate');
      }
      renderer.render(scene, camera);
      const canvas = renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const scale = center.distanceTo(camera.position) * 1.5 / 7 * (Math.sign(camera.position.x - center.x) || 1);
      const start = center.clone().add(new window.THREE.Vector3(scale * 0.8, 0, 0)).project(camera);
      const end = center.clone().add(new window.THREE.Vector3(scale * 1.1, 0, 0)).project(camera);
      for (const [type, point] of [
        ['mousemove', start], ['mousedown', start], ['mousemove', end], ['mouseup', end],
      ] as const) {
        canvas.dispatchEvent(new MouseEvent(type, {
          bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
          clientX: rect.left + (point.x + 1) * rect.width / 2,
          clientY: rect.top + (1 - point.y) * rect.height / 2,
        }));
      }
    }, position);
  }
  const panelScreenshot = await devtools.command<{data: string}>('Page.captureScreenshot', {format: 'png'});
  await writeFile(path.join(root, 'test-results/panel.png'), Buffer.from(panelScreenshot.data, 'base64'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.viewerPosition[0] < -0.01 && (window as unknown as SmokeWindow).smoke.state.inputPositions.right?.[0] < 0.49);
  await panel.evaluate(() => { (document.querySelector('#rightSelectButton') as HTMLButtonElement).click(); (document.querySelector('#leftSqueezeButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(() => {
    const events = (window as unknown as SmokeWindow).smoke.state.events;
    return events.selectstart > 0 && events.squeezestart > 0;
  });
  await panel.evaluate(() => { (document.querySelector('#rightSelectButton') as HTMLButtonElement).click(); (document.querySelector('#leftSqueezeButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(() => {
    const events = (window as unknown as SmokeWindow).smoke.state.events;
    return events.selectend > 0 && events.select > 0 && events.squeezeend > 0 && events.squeeze > 0;
  });
  const vr = await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state);
  assert.deepEqual(vr.errors, []);
  await panel.evaluate(() => { (document.querySelector('#exitButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  console.log('Checking same-origin/cross-origin frames and tab isolation');
  const otherTab = await context.newPage();
  await otherTab.goto(`${origin}/frame`);
  await otherTab.evaluate(() => {
    const probe = window as unknown as {bridgePoses: number[][]};
    probe.bridgePoses = [];
    window.addEventListener('webxr-pose', event => probe.bridgePoses.push(Array.from(event.detail.position)));
  });
  const frameURLs = [`${origin}/frame`, `http://localhost:${address.port}/frame`];
  await page.evaluate((urls: string[]) => {
    for (const url of urls) {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.allow = 'xr-spatial-tracking';
      document.body.appendChild(frame);
    }
  }, frameURLs);
  await eventually(async () => page.frames().filter(frame => frameURLs.includes(frame.url())).length, count => count === 2, 'both frames loaded');
  for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
    await frame.waitForFunction(() => !!(window as unknown as SmokeWindow).smoke);
    assert.equal(await frame.evaluate(() => { const state = (window as unknown as SmokeWindow).smoke.state; return state.synchronousXR && state.synchronousGlobals && state.overridesNativeXR; }), true);
    await frame.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-vr'));
    await frame.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.frames > 2);
  }
  await stopWorker();
  await panel.evaluate(() => { (document.querySelector('#resetPoseButton') as HTMLButtonElement).click(); });
  for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
    await frame.waitForFunction(() => Math.abs((window as unknown as SmokeWindow).smoke.state.inputPositions.right?.[0] - 0.5) < 0.01);
    await frame.evaluate(() => {
      window.dispatchEvent(new CustomEvent('device-pose', {detail: {position: [0.25, 1.7, 0], quaternion: [0, 0, 0, 1]}}));
    });
    await eventually(() => panel.evaluate(() => document.querySelector('#headsetPosition')?.textContent), value => value === '0.25 1.70 0.00', 'frame-to-panel routing');
    await frame.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  }
  assert.deepEqual(await otherTab.evaluate(() => (window as unknown as {bridgePoses: number[][]}).bridgePoses), [], 'commands must not leak to another tab');
  await otherTab.close();
  await page.evaluate(() => {
    document.querySelectorAll('iframe').forEach(frame => frame.remove());
    window.dispatchEvent(new CustomEvent('device-pose', {detail: {position: [99], quaternion: [0, 0, 0, 1]}}));
  });
  await page.waitForTimeout(100);
  assert.equal(await panel.evaluate(() => document.querySelector('#headsetPosition')?.textContent), '0.25 1.70 0.00', 'reject malformed page pose');
  // Closed frames must not prevent delivery to the remaining top-level document.
  await panel.evaluate(() => {
    const select = document.querySelector('#deviceSelect') as HTMLSelectElement;
    select.value = 'Samsung Galaxy S8+ (AR)';
    select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(200);
  console.log('Checking AR room and hit tests');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0 && (window as unknown as SmokeWindow).smoke.state.hitPosition?.every(Number.isFinite));
  assert.equal(await page.locator('canvas').count(), 1, 'AR renderer uses the application canvas as a texture');
  const canvasBox = await page.locator('canvas').boundingBox();
  assert(canvasBox);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({button: 'right'});
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.transientHits > 0 && (window as unknown as SmokeWindow).smoke.state.events.selectstart > 1);
  const arHitCounts = await page.evaluate(() => ({persistent: (window as unknown as SmokeWindow).smoke.state.hits, transient: (window as unknown as SmokeWindow).smoke.state.transientHits}));
  await page.mouse.up({button: 'right'});
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.events.selectend > 1);
  await page.screenshot({path: path.join(root, 'test-results/ar.png')});
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.1, canvasBox.y + canvasBox.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.1 + 40, canvasBox.y + canvasBox.height * 0.1 + 15, {steps: 8});
  await page.mouse.up();
  await eventually(() => panel.evaluate(() => document.querySelector('#headsetRotation')?.textContent), value => !!value && value !== '0.00 0.00 0.00', 'AR mouse camera controls and pose notification');
  const ray = await page.evaluate(() => {
    const xrWindow = window as unknown as SmokeWindow;
    const ray = new xrWindow.XRRay(new xrWindow.XRRigidTransform({x: 1, y: 2, z: 3}));
    return {origin: [ray.origin.x, ray.origin.y, ray.origin.z], direction: [ray.direction.x, ray.direction.y, ray.direction.z]};
  });
  assert.deepEqual(ray, {origin: [1, 2, 3], direction: [0, 0, -1]});
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.cancelHitTests());
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits === 0);
  const ar = await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state);
  assert.deepEqual(ar.errors, []);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  await page.reload();
  assert.equal(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.synchronousXR), true);
  // The selected AR device must also be restored in the reloaded document.
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({browser: await context.browser()!.version(), passed: ['MV3 service worker and popup', 'worker shutdown/recovery in both directions', 'same-origin and cross-origin frames, frame removal, tab isolation', 'malformed page message rejection', 'synchronous injection with restrictive script CSP', 'real DevTools panel and assets', 'device and stereo persistence after panel reload', 'bidirectional pose messages, reset, and headset/controller gizmo drags', 'VR select/squeeze press and release', 'panel exit immersive', 'AR virtual room hit testing, transient touch/select, and cancellation', 'AR mouse camera movement', 'XRRay rigid transform', 'page reload startup'], vrEvents: vr.events, arHitCounts, arFrames: ar.frames}, null, 2));
} finally {
  for (const target of attached.reverse()) await target.detach().catch(() => {});
  await context.close();
  server.close();
  await rm(profile, {recursive: true, force: true});
}
