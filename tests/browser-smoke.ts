import {runDeferredSessionRequest} from './session-request';
import {runConformance} from './conformance';
import {runDOMOverlayPreview} from './dom-overlay-production';
import {runDOMOverlayNegotiation} from './dom-overlay-negotiation';
import {runDOMOverlayPrototype} from './dom-overlay-prototype';
import ConfigurationManager from '../src/ConfigurationManager';
import type { DeviceDefinitions } from '../src/types/contracts';
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

const definitions = JSON.parse(await readFile(new URL('../src/devices.json', import.meta.url), 'utf8')) as DeviceDefinitions;
assert.deepEqual(Object.keys(definitions.devices), ['Meta Quest 3', 'Generic Android Phone (ARCore)']);
const configuration = new ConfigurationManager(definitions);
for (const deviceKey of ['None', 'HTC Vive', 'Oculus Quest', 'Oculus Quest 2', 'unknown', 'toString']) {
  configuration.deserialize(JSON.stringify({deviceKey}));
  assert.equal(configuration.deviceKey, 'Meta Quest 3');
  assert.equal(configuration.emulationMode, 'immersive-vr');
}
configuration.deserialize(JSON.stringify({deviceKey: 'Samsung Galaxy S8+ (AR)', stereoEffect: false}));
assert.equal(configuration.deviceKey, 'Generic Android Phone (ARCore)');
assert.equal(configuration.emulationMode, 'immersive-ar');
configuration.deserialize('invalid JSON');
assert.equal(configuration.deviceKey, 'Meta Quest 3');
assert.equal(configuration.domOverlayPreview, false);
configuration.updateDOMOverlayPreview(true);
configuration.updateDOMOverlayPreviewFlat(true);
const restoredConfiguration = new ConfigurationManager(definitions);
restoredConfiguration.deserialize(configuration.serialize());
assert.equal(restoredConfiguration.domOverlayPreview, true);
assert.equal(restoredConfiguration.domOverlayPreviewFlat, true);
restoredConfiguration.deserialize('{"domOverlayPreview":"true"}');
assert.equal(restoredConfiguration.domOverlayPreview, false);
const executablePath = process.env.WEBXR_CHROMIUM_EXECUTABLE;
// Defaults to the current Playwright desktop Chromium (npx playwright install chromium).
const root = process.cwd();
const fixture = ts.transpileModule(await readFile(path.join(root, 'tests/fixture.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None},
}).outputText;
const threeModules = new Map<string, string>(await Promise.all(['three.module.js', 'three.core.js'].map(async name =>
  [`/${name}`, await readFile(path.join(root, 'node_modules/three/build', name), 'utf8')] as const)));
const server = createServer((request, response) => {
  const moduleName = request.url?.replace('/node_modules/three/build', '');
  if (threeModules.has(moduleName!)) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(threeModules.get(moduleName!));
  } else if (request.url === '/examples/bounded-floor.js') {
    response.setHeader('Content-Type', 'application/javascript');
    void readFile(path.join(root, 'examples/bounded-floor.js'), 'utf8').then(body => response.end(body));
  } else if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(fixture);
  } else if (request.url === '/' || request.url === '/frame' || request.url === '/csp') {
    // Embedded AR images may use blob URLs, but must not need blob connections.
    if (request.url === '/csp') response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self' http://localhost:*; style-src 'self' 'unsafe-inline'; object-src 'none'");
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
const overlayPrototypes: Awaited<ReturnType<typeof runDOMOverlayPrototype>>[] = [];
try {
  context.setDefaultTimeout(20000);
  console.log('Checking MV3 installation and synchronous injection');
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error(error.message); });
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
  assert.equal(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.startupSessionError), 'SecurityError', 'immersive startup without user activation is rejected');
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
  assert.equal(await panel.evaluate(() => (document.querySelector('#deviceSelect') as HTMLSelectElement).value), 'Meta Quest 3');
  assert.deepEqual(await panel.evaluate(() => Array.from((document.querySelector('#deviceSelect') as HTMLSelectElement).options, option => option.text)), ['Meta Quest 3', 'Generic Android Phone (ARCore)']);
  assert.equal(await panel.evaluate(() => document.querySelectorAll('canvas').length), 1);
  await panel.evaluate(() => {
    const select = document.querySelector('#deviceSelect') as HTMLSelectElement;
    select.value = 'Meta Quest 3';
    select.dispatchEvent(new Event('change'));
    const checkbox = document.querySelector('#stereoCheckbox') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
  });
  await eventually(() => panel.evaluate(async () => JSON.parse((await new Promise<Record<string, unknown>>(resolve => chrome.storage.local.get('webxr-extension', result => resolve(result))))['webxr-extension'] as string) as {deviceKey: string; stereoEffect: boolean}), value => value.deviceKey === 'Meta Quest 3' && value.stereoEffect === false, 'configuration persistence');
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
  await eventually(() => panel.evaluate(() => ({device: (document.querySelector('#deviceSelect') as HTMLSelectElement | null)?.value, stereo: (document.querySelector('#stereoCheckbox') as HTMLInputElement | null)?.checked, pose: document.querySelector('#rightControllerPosition')?.textContent})), value => value.device === 'Meta Quest 3' && value.stereo === false && !!value.pose, 'restored panel configuration');
  async function supportedModes() {
    return page.evaluate(() => Promise.all((['inline', 'immersive-vr', 'immersive-ar'] as const).map(mode => (window as unknown as SmokeWindow).navigator.xr.isSessionSupported(mode))));
  }
  assert.deepEqual(await supportedModes(), [true, true, false]);
  assert.equal(await page.evaluate(async () => {
    try { await (window as unknown as SmokeWindow).navigator.xr.requestSession('immersive-ar', {requiredFeatures: []}); }
    catch (error) { return (error as DOMException).name; }
  }), 'NotSupportedError');
  console.log('Checking Quest VR API conformance');
  const conformance = [await runConformance(page, 'immersive-vr', false)];
  console.log('Checking inline and VR controls');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('inline'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.views[0]?.eye === 'none');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-vr'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.frames > 2);
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.views.length === 2);
  assert.deepEqual(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.views.map(view => view.eye)), ['left', 'right']);
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
  console.log('Checking Quest VR/MR switching and persistence');
  // Switch while presenting.
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-vr'));
  await panel.evaluate(() => {
    const mode = document.querySelector('#questModeSelect') as HTMLSelectElement;
    mode.value = 'immersive-ar'; mode.dispatchEvent(new Event('change'));
    const stereo = document.querySelector('#stereoCheckbox') as HTMLInputElement;
    stereo.checked = true; stereo.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  await eventually(() => panel.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string).questMode), mode => mode === 'immersive-ar', 'MR mode persisted');
  await panel.evaluate(() => { location.reload(); });
  await eventually(() => panel.evaluate(() => (document.querySelector('#questModeSelect') as HTMLSelectElement | null)?.value), mode => mode === 'immersive-ar', 'MR selection restored in panel');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 2, mobile: false});
  await page.reload();
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0 && (window as unknown as SmokeWindow).smoke.state.views.length === 2);
  assert.deepEqual(await supportedModes(), [true, false, true]);
  const mr = await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state);
  assert.deepEqual(mr.inputModes, ['tracked-pointer', 'tracked-pointer']);
  assert(mr.views[1].x > mr.views[0].x, 'MR has separate eye poses');
  assert(mr.views.every(view => view.projection > 0 && view.viewport.width > 0), 'MR projections and viewports are usable');
  assert(mr.views[1].viewport.x > 0, 'MR uses stereo viewports');
  async function assertMRAlignment(width: number, height: number, dpr: number) {
    const sample = await eventually(() => page.evaluate(() => ({
      state: (window as unknown as SmokeWindow).smoke.state,
      room: (window as unknown as import('./browser-types').PanelProbeWindow).roomViews || [],
    })), sample => sample.room.length === 2 && sample.room.every(eye => eye.width === width * dpr && eye.height === height * dpr)
      && sample.state.framebuffer.width === width * dpr && sample.state.framebuffer.height === height * dpr,
    `MR room and application buffers at ${width}x${height}, DPR ${dpr}`);
    for (let i = 0; i < 2; i++) {
      const room = sample.room[i];
      const app = sample.state.views[i];
      const expected = [i * width * dpr / 2, 0, width * dpr / 2, height * dpr];
      assert.deepEqual(room.viewport, expected, 'room eye stays inside its physical render target');
      assert.deepEqual(room.scissor, expected, 'room eye scissor matches its viewport');
      assert.equal(room.scissorTest, true, 'room eyes have separate scissor regions');
      assert.deepEqual([app.viewport.x, app.viewport.y, app.viewport.width, app.viewport.height], expected,
        'application and room eye viewports align');
      assert(Math.abs(room.projection - app.projection) < 0.00001, 'room and application eye projections align');
      assert(Math.abs(app.projection - 2 * height / width) < 0.00001, 'eye projection follows the display aspect');
    }
    assert.equal(sample.state.ended, false, 'resize preserves the active MR session');
  }
  console.log('Checking MR eye alignment at DPR 2 and active-session resizing');
  await assertMRAlignment(1280, 720, 2);
  overlayPrototypes.push(await runDOMOverlayPrototype(page, false, 'dpr2'));
  // Capture through CDP so Playwright does not restore its default viewport metrics.
  const mrDPR2Screenshot = await cdp.send('Page.captureScreenshot', {format: 'png'});
  await writeFile(path.join(root, 'test-results/quest-mr-dpr2.png'), Buffer.from(mrDPR2Screenshot.data, 'base64'));
  // Resize the same active session from a wide display to a square display.
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 900, height: 900, deviceScaleFactor: 2, mobile: false});
  await assertMRAlignment(900, 900, 2);
  overlayPrototypes.push(await runDOMOverlayPrototype(page, false, 'resized-dpr2'));
  const mrResizedScreenshot = await cdp.send('Page.captureScreenshot', {format: 'png'});
  await writeFile(path.join(root, 'test-results/quest-mr-resized.png'), Buffer.from(mrResizedScreenshot.data, 'base64'));
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
  await assertMRAlignment(1280, 720, 1);
  overlayPrototypes.push(await runDOMOverlayPrototype(page, false, 'dpr1'));
  await page.screenshot({path: path.join(root, 'test-results/quest-mr.png')});
  await panel.evaluate(() => { (document.querySelector('#resetPoseButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(() => Math.abs((window as unknown as SmokeWindow).smoke.state.inputPositions.right?.[0] - 0.5) < 0.01);
  await textureMode('transparent');
  const mrRoomPixels = await page.evaluate(readTabletPixels);
  await textureMode('pattern');
  const mrCompositePixels = await page.evaluate(readTabletPixels);
  assert.equal(mrRoomPixels.glError, 0);
  assert.equal(mrCompositePixels.glError, 0);
  for (const [actual, expected] of [[mrCompositePixels.pixels[0], [64, 128, 191, 255]], [mrCompositePixels.pixels[1], [191, 64, 32, 255]], [mrCompositePixels.pixels[3], mrRoomPixels.pixels[3]]]) {
    expected.forEach((value, i) => assert(Math.abs(actual[i] - value) <= 4, 'MR compositor preserves app orientation, color and transparent room pixels'));
  }
  assert(mrRoomPixels.pixels.every(pixel => pixel.slice(0, 3).some(channel => channel > 0)), 'MR room renders in both eyes');
  await page.screenshot({path: path.join(root, 'test-results/quest-mr-texture.png')});
  await panel.evaluate(() => {
    const stereo = document.querySelector('#stereoCheckbox') as HTMLInputElement;
    stereo.checked = false; stereo.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.views[1]?.viewport.width === 0);
  await panel.evaluate(() => {
    const stereo = document.querySelector('#stereoCheckbox') as HTMLInputElement;
    stereo.checked = true; stereo.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.views[1]?.viewport.x > 0);
  const mrPanelScreenshot = await devtools.command<{data: string}>('Page.captureScreenshot', {format: 'png', clip: {x: model.content[0], y: model.content[1], width: model.width, height: model.height, scale: 1}});
  await writeFile(path.join(root, 'test-results/panel-mr.png'), Buffer.from(mrPanelScreenshot.data, 'base64'));
  const beforeMR = {...mr.events};
  await panel.evaluate(() => { (document.querySelector('#rightSelectButton') as HTMLButtonElement).click(); (document.querySelector('#leftSqueezeButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(before => {
    const events = (window as unknown as SmokeWindow).smoke.state.events;
    return events.selectstart > (before.selectstart || 0) && events.squeezestart > (before.squeezestart || 0);
  }, beforeMR);
  await panel.evaluate(() => { (document.querySelector('#rightSelectButton') as HTMLButtonElement).click(); (document.querySelector('#leftSqueezeButton') as HTMLButtonElement).click(); });
  await page.waitForFunction(before => {
    const events = (window as unknown as SmokeWindow).smoke.state.events;
    return events.selectend > (before.selectend || 0) && events.squeezeend > (before.squeezeend || 0);
  }, beforeMR);
  await panel.evaluate(() => {
    const mode = document.querySelector('#questModeSelect') as HTMLSelectElement;
    mode.value = 'immersive-vr'; mode.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-vr'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.views.length === 2 && (window as unknown as SmokeWindow).smoke.state.inputModes.length === 2);
  await page.screenshot({path: path.join(root, 'test-results/quest-vr.png')});
  // Closed frames must not prevent delivery to the remaining top-level document.
  await panel.evaluate(() => {
    const select = document.querySelector('#deviceSelect') as HTMLSelectElement;
    select.value = 'Generic Android Phone (ARCore)';
    select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(200);
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.setTextureMode('default'));
  console.log('Checking AR room and hit tests');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0 && (window as unknown as SmokeWindow).smoke.state.hitPosition?.every(Number.isFinite));
  assert.deepEqual(await supportedModes(), [true, false, true]);
  assert.deepEqual(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.views.map(view => view.eye)), ['none']);
  assert.equal(await panel.evaluate(() => document.querySelector('#leftControllerTitle')?.textContent), 'Phone');
  assert.equal(await panel.evaluate(() => getComputedStyle(document.querySelector('#rightSelectButton')!).display), 'none');
  const phonePanelScreenshot = await devtools.command<{data: string}>('Page.captureScreenshot', {format: 'png', clip: {x: model.content[0], y: model.content[1], width: model.width, height: model.height, scale: 1}});
  await writeFile(path.join(root, 'test-results/panel-phone.png'), Buffer.from(phonePanelScreenshot.data, 'base64'));
  const roomTextures = await page.evaluate(() => {
    const textures = new Map<string, {loaded: boolean; flipY?: boolean; colorSpace?: string}>();
    (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!.scene.traverse(object => {
      const mesh = object as import('three').Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material.name !== 'sky' && material.name !== 'wall') continue;
        const map = (material as import('three').MeshStandardMaterial).map;
        const image = map?.image as HTMLImageElement | ImageBitmap | undefined;
        textures.set(material.name, {loaded: !!image && image.width > 0 && image.height > 0,
          flipY: map?.flipY, colorSpace: map?.colorSpace});
      }
    });
    return Object.fromEntries(textures);
  });
  assert.deepEqual(Object.keys(roomTextures).sort(), ['sky', 'wall'], 'both textured room materials loaded');
  for (const [name, texture] of Object.entries(roomTextures)) {
    assert.deepEqual(texture, {loaded: true, flipY: false, colorSpace: 'srgb'}, `${name} texture loads under connect-src self with glTF orientation and color space`);
  }
  console.log('Checking projected live DOM phone prototype and stereo feasibility');
  overlayPrototypes.push(await runDOMOverlayPrototype(page, true, 'dpr1'));
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 900, height: 900, deviceScaleFactor: 2, mobile: false});
  overlayPrototypes.push(await runDOMOverlayPrototype(page, true, 'resized-dpr2'));
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
  await page.waitForFunction(() => {
    const canvas = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!.renderer.domElement;
    return canvas.width === 1280 && canvas.height === 720 && canvas.getBoundingClientRect().width === 1280;
  });
  assert.equal(await page.locator('canvas').count(), 1, 'AR renderer uses the application canvas as a texture');
  const canvasBox = await page.locator('canvas').boundingBox();
  assert(canvasBox);
  const phoneEventsBeforeTouch = await page.evaluate(() => ({...(window as unknown as SmokeWindow).smoke.state.events}));
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({button: 'right'});
  await page.waitForFunction(before => (window as unknown as SmokeWindow).smoke.state.transientHits > 0 && (window as unknown as SmokeWindow).smoke.state.events.selectstart > (before.selectstart || 0), phoneEventsBeforeTouch);
  const arHitCounts = await page.evaluate(() => ({persistent: (window as unknown as SmokeWindow).smoke.state.hits, transient: (window as unknown as SmokeWindow).smoke.state.transientHits}));
  assert.deepEqual(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.inputModes), ['screen']);
  await page.mouse.up({button: 'right'});
  await page.waitForFunction(before => (window as unknown as SmokeWindow).smoke.state.events.selectend > (before.selectend || 0), phoneEventsBeforeTouch);
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.eventOrder.includes('removed'));
  assert.deepEqual(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.eventOrder), ['added', 'selectstart', 'select', 'selectend', 'removed']);
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
  // Exercise the actual phone transform control and its pose notification.
  await page.evaluate(() => {
    const {scene} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
    scene.traverse(object => {
      const controls = (object as import('three').Object3D & {controls?: import('three/addons/controls/TransformControls.js').TransformControls}).controls;
      if (!controls?.object || controls.getHelper() !== object) return;
      controls.object.position.set(0.025, 1.63, -0.2);
      controls.object.rotation.y = 0.1;
      controls.dispatchEvent({type: 'change'});
    });
  });
  await page.waitForFunction(() => Math.abs((window as unknown as SmokeWindow).smoke.state.viewerPosition[0] - 0.025) < 0.001);
  await eventually(() => panel.evaluate(() => document.querySelector('#leftControllerPosition')?.textContent), value => value === '0.03 1.63 -0.20', 'phone 6DoF transform notification');
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
  // Replace an active phone presentation with Quest MR, exercising renderer disposal.
  await panel.evaluate(() => {
    const device = document.querySelector('#deviceSelect') as HTMLSelectElement;
    device.value = 'Meta Quest 3'; device.dispatchEvent(new Event('change'));
    const mode = document.querySelector('#questModeSelect') as HTMLSelectElement;
    mode.value = 'immersive-ar'; mode.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.ended);
  await eventually(supportedModes, modes => modes[2] && !modes[1], 'Quest MR after phone presentation');
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0 && (window as unknown as SmokeWindow).smoke.state.views.length === 2);
  assert.deepEqual(await page.evaluate(() => (window as unknown as SmokeWindow).smoke.state.inputModes), ['tracked-pointer', 'tracked-pointer']);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  // Ending before the app supplies a base layer must also release presentation.
  await page.evaluate(async () => {
    const session = await (window as unknown as SmokeWindow).navigator.xr.requestSession('immersive-ar', {requiredFeatures: []});
    await session.end();
  });
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.start('immersive-ar'));
  await page.waitForFunction(() => (window as unknown as SmokeWindow).smoke.state.hits > 0);
  await page.evaluate(() => (window as unknown as SmokeWindow).smoke.stop());
  console.log('Checking Quest MR API conformance');
  conformance.push(await runConformance(page, 'immersive-ar', false));
  await panel.evaluate(() => {
    const device = document.querySelector('#deviceSelect') as HTMLSelectElement;
    device.value = 'Generic Android Phone (ARCore)'; device.dispatchEvent(new Event('change'));
  });
  await eventually(() => panel.evaluate(() => (document.querySelector('#deviceSelect') as HTMLSelectElement).value), value => value === 'Generic Android Phone (ARCore)', 'phone conformance profile');
  await eventually(() => page.evaluate(async () => {
    const xr = (window as unknown as SmokeWindow).navigator.xr as unknown as {devicePromise: Promise<{handheld: boolean}>};
    return (await xr.devicePromise).handheld;
  }), Boolean, 'phone profile reaches the page runtime');
  console.log('Checking Android AR API conformance');
  conformance.push(await runConformance(page, 'immersive-ar', true));
  console.log('Checking session requests with deferred device initialization');
  const deferredSessionRequests = [];
  for (const [deviceKey, mode] of [
    ['Meta Quest 3', 'inline'], ['Meta Quest 3', 'immersive-vr'], ['Meta Quest 3', 'immersive-ar'],
    ['Generic Android Phone (ARCore)', 'inline'], ['Generic Android Phone (ARCore)', 'immersive-ar'],
  ] as const) {
    const deferredPage = await context.newPage();
    try {
      await deferredPage.goto(origin);
      await deferredPage.waitForFunction(() => !!(window as unknown as {sessionRequestStartup?: unknown}).sessionRequestStartup);
      const startup = await deferredPage.evaluate(() => (window as unknown as {sessionRequestStartup: {passed: string[]; failures: string[]}}).sessionRequestStartup);
      assert.deepEqual(startup.failures, [], 'session argument conversion and activation without a gesture');
      deferredSessionRequests.push({...await runDeferredSessionRequest(deferredPage, mode, {...definitions.devices[deviceKey], emulationMode: mode === 'inline' ? 'immersive-ar' : mode, domOverlayPreview: true}), deviceKey, startup});
    } finally { await deferredPage.close(); }
  }
  await writeFile(path.join(root, 'test-results/session-request.json'), JSON.stringify({browser: await context.browser()!.version(), deferredSessionRequests, conversion: conformance.map(result => result.sessionRequest)}, null, 2));
  console.log('Checking disabled public DOM overlay negotiation and late shadow attachment');
  const overlayNegotiation = await runDOMOverlayNegotiation(page);
  const setPreview = async (enabled: boolean) => {
    await panel.evaluate((enabled: boolean) => {
      const input = document.querySelector('#domOverlayPreviewCheckbox') as HTMLInputElement;
      input.checked = enabled; input.dispatchEvent(new Event('change'));
    }, enabled);
    await eventually(() => panel.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string).domOverlayPreview), value => value === enabled, 'preview opt-in persisted');
  };
  assert.equal(await panel.evaluate(() => (document.querySelector('#domOverlayPreviewCheckbox') as HTMLInputElement).checked), false, 'preview disabled by default');
  await setPreview(true);
  await panel.evaluate(() => { location.reload(); });
  await eventually(() => panel.evaluate(() => (document.querySelector('#domOverlayPreviewCheckbox') as HTMLInputElement | null)?.checked), value => value === true, 'preview opt-in restored after panel reload');
  await page.reload();
  assert.equal(await page.locator('[popover]').count(), 0, 'opt-in alone does not present an overlay after page reload');
  // The Three.js probe is restored by the existing page init script.
  console.log('Checking public Android interactive DOM overlay preview');
  const overlayPreviews = [await runDOMOverlayPreview(page, true, stopWorker)];
  async function startSwitchPreview() {
    await page.evaluate(async () => {
      const w = window as unknown as {navigator: {xr: import('../src/polyfill/api/runtime').XRSystem}; overlaySwitch: {root: HTMLElement; session: import('../src/polyfill/api/runtime').XRSession}};
      const root = document.createElement('section'); root.id = 'overlay-switch';
      const button = document.createElement('button'); button.textContent = 'Lifecycle action';
      button.addEventListener('click', () => { root.dataset.clicked = 'true'; }); root.append(button);
      document.body.append(root);
      const session = await w.navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['dom-overlay'], domOverlay: {root}});
      w.overlaySwitch = {root, session};
    });
  }
  async function checkSwitchCleanup() {
    await page.waitForFunction(() => (window as unknown as {overlaySwitch: {session: {ended: boolean}}}).overlaySwitch.session.ended);
    assert(await page.evaluate(() => { const s = (window as unknown as {overlaySwitch: {root: HTMLElement}}).overlaySwitch; const clean = !s.root.hasAttribute('popover') && s.root.style.length === 0; s.root.remove(); return clean; }), 'configuration change cleans up overlay');
  }
  await startSwitchPreview();
  await panel.evaluate(() => { const layout = document.querySelector('#domOverlayPreviewLayout') as HTMLSelectElement; layout.value = 'screen'; layout.dispatchEvent(new Event('change')); });
  await checkSwitchCleanup(); await startSwitchPreview();
  const flatRoot = await page.locator('#overlay-switch').boundingBox();
  assert(flatRoot && flatRoot.x === 24 && flatRoot.y === 24 && flatRoot.width > 300, 'manual Android fallback is a readable flat panel');
  await page.getByRole('button', {name: 'Lifecycle action'}).click();
  assert.equal(await page.locator('#overlay-switch').getAttribute('data-clicked'), 'true', 'manual fallback executes original app listener');
  await panel.evaluate(() => { location.reload(); });
  await eventually(() => panel.evaluate(() => (document.querySelector('#domOverlayPreviewLayout') as HTMLSelectElement | null)?.value), value => value === 'screen', 'Android fallback layout persists');
  await panel.evaluate(() => { const layout = document.querySelector('#domOverlayPreviewLayout') as HTMLSelectElement; layout.value = 'auto'; layout.dispatchEvent(new Event('change')); });
  await checkSwitchCleanup();
  await startSwitchPreview();
  await panel.evaluate(() => {
    const device = document.querySelector('#deviceSelect') as HTMLSelectElement;
    device.value = 'Meta Quest 3'; device.dispatchEvent(new Event('change'));
  });
  await checkSwitchCleanup();
  console.log('Checking public Quest MR interactive DOM overlay preview');
  overlayPreviews.push(await runDOMOverlayPreview(page, false, stopWorker));
  await startSwitchPreview();
  await setPreview(false); await checkSwitchCleanup();
  const questDisabledNegotiation = await runDOMOverlayNegotiation(page, false);
  await setPreview(true); await startSwitchPreview();
  await panel.evaluate(() => { const mode = document.querySelector('#questModeSelect') as HTMLSelectElement; mode.value = 'immersive-vr'; mode.dispatchEvent(new Event('change')); });
  await checkSwitchCleanup();
  assert.equal(await page.evaluate(async () => {
    const xr = (window as unknown as {navigator: {xr: import('../src/polyfill/api/runtime').XRSystem}}).navigator.xr;
    try { await xr.requestSession('immersive-vr', {requiredFeatures: ['dom-overlay'], domOverlay: {root: document.body}}); }
    catch (error) { return (error as Error).name; }
  }), 'NotSupportedError', 'preview never enabled in Quest VR');
  await page.reload();
  assert.equal(await page.locator('[popover]').count(), 0, 'page reload starts without stale overlays');
  await panel.evaluate(() => { const mode = document.querySelector('#questModeSelect') as HTMLSelectElement; mode.value = 'immersive-ar'; mode.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => (window as unknown as SmokeWindow).navigator.xr.isSessionSupported('immersive-ar'));
  await page.mouse.click(10, 10);
  await startSwitchPreview();
  console.log('Checking active preview cleanup on extension reload');
  const reloadWorker = context.serviceWorkers().find(worker => worker.url().endsWith('/dist/extension/background.js'));
  assert(reloadWorker);
  await reloadWorker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); });
  await checkSwitchCleanup();
  // In this command-line sideloaded Chromium, runtime.reload unloads the
  // extension without restarting its worker. Reopen the SAME temporary profile
  // with the unpacked extension to check stored settings and a fresh injection.
  await context.close();
  const restarted = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? {executablePath} : {channel: 'chromium'}),
    headless: false, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-swiftshader'],
  });
  try {
    const worker = restarted.serviceWorkers()[0] || await restarted.waitForEvent('serviceworker');
    const stored = await worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string));
    assert.equal(stored.domOverlayPreview, true); assert.equal(stored.domOverlayPreviewFlat, false);
    const reloadedPage = await restarted.newPage(); await reloadedPage.goto(`${origin}/csp`);
    assert.equal(await reloadedPage.evaluate(() => (window as unknown as SmokeWindow).smoke.state.overridesNativeXR), true, 'extension restart injects before application scripts');
    await reloadedPage.mouse.click(10, 10);
    assert.deepEqual(await reloadedPage.evaluate(async () => {
      const xr = (window as unknown as {navigator: {xr: import('../src/polyfill/api/runtime').XRSystem}}).navigator.xr;
      const root = document.createElement('section'); document.body.append(root);
      const session = await xr.requestSession('immersive-ar', {requiredFeatures: ['dom-overlay'], domOverlay: {root}});
      const result = {enabled: session.enabledFeatures.includes('dom-overlay'), type: session.domOverlayState?.type};
      await session.end(); root.remove(); return result;
    }), {enabled: true, type: 'screen'}, 'persisted opt-in enables a fresh session after extension reload/relaunch');
  } finally { await restarted.close(); }
  await writeFile(path.join(root, 'test-results/dom-overlay-preview.json'), JSON.stringify({browser: await context.browser()!.version(), disabledNegotiation: [overlayNegotiation, questDisabledNegotiation], previews: overlayPreviews, lifecycle: ['profile switch', 'opt-out', 'Quest MR to VR', 'page reload', 'panel reload persistence', 'extension reload cleanup', 'same-profile browser relaunch persistence']}, null, 2));
  await writeFile(path.join(root, 'test-results/dom-overlay-feasibility.json'), JSON.stringify({browser: await context.browser()!.version(), overlayPrototypes}, null, 2));
  await writeFile(path.join(root, 'test-results/webxr-conformance.json'), JSON.stringify({browser: await context.browser()!.version(), conformance}, null, 2));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(panel.errors, [], 'no panel runtime or WebGL errors');
  assert.deepEqual(consoleErrors, [], 'no page shader, WebGL, or loader errors');
  console.log(JSON.stringify({browser: await context.browser()!.version(), passed: ['MV3 service worker and popup', 'worker shutdown/recovery in both directions', 'same-origin and cross-origin frames, frame removal, tab isolation', 'malformed page message rejection', 'synchronous injection with restrictive script CSP', 'real DevTools panel and assets', 'profile migration, device/stereo persistence after panel reload', 'Quest VR/MR switching, stereo views, tracked input, mode persistence and session restart', 'inline and monoscopic phone views', 'bidirectional pose messages, reset, and headset/controller gizmo drags', 'OrbitControls pointer drag', 'VR select/squeeze press and release', 'panel exit immersive', 'AR virtual room hit testing, transient touch/select, and cancellation', 'AR mouse camera movement', 'AR screen sRGB, orientation, and transparent/half-alpha/opaque texture pixels', 'XRRay rigid transform', 'page reload startup'], vrEvents: vr.events, roomPixels, compositePixels, arHitCounts, arFrames: ar.frames}, null, 2));
} finally {
  for (const target of attached.reverse()) await target.detach().catch(() => {});
  await context.close();
  server.close();
  await rm(profile, {recursive: true, force: true});
}
