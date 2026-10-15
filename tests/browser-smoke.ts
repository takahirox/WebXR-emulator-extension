import { readTabletPixels } from './ar-pixels';
import { installThreeProbe } from './three-probe';
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
    if (request.url === '/csp') response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self' blob:; img-src 'self' blob: data:; frame-src 'self' http://localhost:*; style-src 'self' 'unsafe-inline'; object-src 'none'");
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
await context.addInitScript(installThreeProbe);
const attached: Awaited<ReturnType<typeof attachTarget>>[] = [];
try {
  context.setDefaultTimeout(20000);
  console.log('Checking MV3 installation and synchronous injection');
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.error(message.text()); } });
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
  // OOPIF extension frames do not consistently run Page init scripts. Pause
  // before the local panel bundle to install the test-only observation hook.
  await panel.command('Runtime.enable', {});
  await panel.command('Log.enable', {});
  await panel.command('Debugger.enable', {});
  const {breakpointId} = await panel.command<{breakpointId: string}>('Debugger.setBreakpointByUrl', {
    url: `${extensionOrigin}/dist/app/panel.js`, lineNumber: 0,
  });
  const paused = panel.nextEvent<{callFrames: {callFrameId: string}[]}>('Debugger.paused');
  await panel.evaluate(() => { location.reload(); });
  const pause = await paused;
  await panel.command('Debugger.evaluateOnCallFrame', {callFrameId: pause.callFrames[0].callFrameId,
    expression: `(${installThreeProbe.toString()})()`});
  await panel.command('Debugger.removeBreakpoint', {breakpointId});
  await panel.command('Debugger.resume', {});
  await panel.command('Debugger.disable', {});
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
  await eventually(() => panel.evaluate(() => !!(window as unknown as import('./browser-types').PanelProbeWindow).panelProbe), Boolean, 'panel camera capture');
  const {backendNodeId} = await devtools.command<{backendNodeId: number}>('DOM.getFrameOwner', {frameId: panelInfo!.targetId});
  const {model} = await devtools.command<{model: {content: number[]; width: number; height: number}}>('DOM.getBoxModel', {backendNodeId});
  await panel.evaluate(() => {
    const {renderer, scene, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
    camera.position.set(-6, 4, 8);
    camera.lookAt(0, 1.6, -0.5);
    renderer.render(scene, camera);
  });
  for (const position of [[0, 1.6, 0], [0.5, 1.5, -1]]) {
    const localPoints = await panel.evaluate((position: number[]) => {
      const {renderer, scene, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
      const center = camera.position.clone().fromArray(position);
      for (const child of scene.children) {
        const controls = (child as import('three').Object3D & {controls?: import('three/addons/controls/TransformControls.js').TransformControls}).controls;
        if (!controls || controls.getHelper() !== child) continue;
        const selected = !!controls.object && controls.object.position.distanceTo(center) < 0.001;
        controls.enabled = selected;
        controls.getHelper().visible = selected;
        if (selected) { controls.setMode('translate'); controls.setSize(0.65); }
      }
      renderer.render(scene, camera);
      const canvas = renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const scale = center.distanceTo(camera.position) * 1.9 * Math.tan(Math.PI * 45 / 360) * 0.65 / 4;
      const start = center.clone().add(center.clone().set(scale * 0.6, 0, 0)).project(camera);
      const end = center.clone().add(center.clone().set(scale * 0.9, 0, 0)).project(camera);
      return [start, end].map(point => ({
        x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2,
      }));
    }, position);
    const points = localPoints.map(point => ({x: point.x + model.content[0], y: point.y + model.content[1]}));
    // Real pointer input supplies active pointer capture, as modern controls require.
    await devtools.command('Input.dispatchMouseEvent', {type: 'mouseMoved', ...points[0]});
    await devtools.command('Input.dispatchMouseEvent', {type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1});
    await devtools.command('Input.dispatchMouseEvent', {type: 'mouseMoved', ...points[1], button: 'left', buttons: 1});
    await devtools.command('Input.dispatchMouseEvent', {type: 'mouseReleased', ...points[1], button: 'left', clickCount: 1});
    assert.equal(await panel.evaluate(() => (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!.scene.children.filter(child => (child as import('three').Object3D & {controls?: {enabled: boolean}}).controls?.enabled).length), 1, 'a quick gizmo drag must not enable another model control');
  }
  const orbit = await panel.evaluate(() => {
    const {renderer, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
    const rect = renderer.domElement.getBoundingClientRect();
    return {before: camera.quaternion.toArray(), x: rect.left + rect.width * 0.1, y: rect.top + rect.height * 0.1};
  });
  await devtools.command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: orbit.x + model.content[0], y: orbit.y + model.content[1]});
  await devtools.command('Input.dispatchMouseEvent', {type: 'mousePressed', x: orbit.x + model.content[0], y: orbit.y + model.content[1], button: 'left', buttons: 1, clickCount: 1});
  await devtools.command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: orbit.x + model.content[0] + 20, y: orbit.y + model.content[1] + 10, button: 'left', buttons: 1});
  await devtools.command('Input.dispatchMouseEvent', {type: 'mouseReleased', x: orbit.x + model.content[0] + 20, y: orbit.y + model.content[1] + 10, button: 'left', clickCount: 1});
  assert.notDeepEqual(await panel.evaluate(() => (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!.camera.quaternion.toArray()), orbit.before, 'OrbitControls rotates the panel camera');
  const panelScreenshot = await devtools.command<{data: string}>('Page.captureScreenshot', {format: 'png',
    clip: {x: model.content[0], y: model.content[1], width: model.width, height: model.height, scale: 1}});
  await writeFile(path.join(root, 'test-results/panel.png'), Buffer.from(panelScreenshot.data, 'base64'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.viewerPosition[0] > 0.01 && (window as unknown as SmokeWindow).smoke.state.inputPositions.right?.[0] > 0.51);
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
  console.log('Checking AR screen color, orientation, and alpha compositing');
  async function textureMode(mode: 'transparent' | 'pattern') {
    const frame = await page.evaluate(mode => {
      const smoke = (window as unknown as SmokeWindow).smoke;
      smoke.setTextureMode(mode);
      return smoke.state.frames;
    }, mode);
    await page.waitForFunction(frame => (window as unknown as SmokeWindow).smoke.state.frames > frame + 3, frame);
  }
  await textureMode('transparent');
  const roomPixels = await page.evaluate(readTabletPixels);
  await textureMode('pattern');
  const compositePixels = await page.evaluate(readTabletPixels);
  assert.equal(roomPixels.glError, 0, 'room WebGL error');
  assert.equal(compositePixels.glError, 0, 'compositor WebGL error');
  const near = (actual: number[], expected: number[], label: string) => expected.forEach((value, i) =>
    assert(Math.abs(actual[i] - value) <= 4, `${label} channel ${i}: ${actual[i]} vs ${value}`));
  near(compositePixels.pixels[0], [64, 128, 191, 255], 'opaque top patch');
  near(compositePixels.pixels[1], [191, 64, 32, 255], 'opaque bottom patch');
  near(compositePixels.pixels[3], roomPixels.pixels[3], 'transparent patch preserves room');
  const decode = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const encode = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const mixed = [0.2, 0.6, 0.8].map((v, i) => encode((decode(v) + decode(roomPixels.pixels[2][i] / 255)) / 2));
  near(compositePixels.pixels[2], [...mixed, 255], 'half alpha blends in linear light');
  await page.screenshot({path: path.join(root, 'test-results/ar-texture.png')});
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
  assert.deepEqual(panel.errors, [], 'no panel runtime or WebGL errors');
  assert.deepEqual(consoleErrors, [], 'no page shader, WebGL, or loader errors');
  console.log(JSON.stringify({browser: await context.browser()!.version(), passed: ['MV3 service worker and popup', 'worker shutdown/recovery in both directions', 'same-origin and cross-origin frames, frame removal, tab isolation', 'malformed page message rejection', 'synchronous injection with restrictive script CSP', 'real DevTools panel and assets', 'device and stereo persistence after panel reload', 'bidirectional pose messages, reset, and headset/controller gizmo drags', 'OrbitControls pointer drag', 'VR select/squeeze press and release', 'panel exit immersive', 'AR virtual room hit testing, transient touch/select, and cancellation', 'AR mouse camera movement', 'AR screen sRGB, orientation, and transparent/half-alpha/opaque texture pixels', 'XRRay rigid transform', 'page reload startup'], vrEvents: vr.events, roomPixels, compositePixels, arHitCounts, arFrames: ar.frames}, null, 2));
} finally {
  for (const target of attached.reverse()) await target.detach().catch(() => {});
  await context.close();
  server.close();
  await rm(profile, {recursive: true, force: true});
}
