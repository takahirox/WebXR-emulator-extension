import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {serveFirefoxFixtures} from './firefox-upstream';
import {launchFirefox, eventually} from './firefox-driver';
import {activate, configure} from './firefox-contract';
import {attachTarget, getTargets} from './cdp-target';
import {referenceSpaceCases} from './reference-space';
import {rigidTransformCases} from './rigid-transform';

const browser = process.argv[2];
const transforms = process.argv[3] === 'transforms';
const cases = transforms ? rigidTransformCases : referenceSpaceCases;
assert(['chromium', 'firefox'].includes(browser), 'Select chromium or firefox');
const {origin, server} = await serveFirefoxFixtures();
const report: any = {issue: transforms ? 47 : 41, browser, status: 'running', startedAt: new Date().toISOString(), results: [], failures: [], skips: [], instrumentation: transforms ? ['Real injected iframe/popup realms; application-visible matrix transfers, pose queries and WebGL triangle pixels.', 'Inspect _session ownership, callbacks.size and the real layer _presentationCanvas for presented pixels/captures; no adapter, GL or timer replacements.'] : [
  'Inspect session pendingReferenceRequests sizes for release; access _device/_id only for targeted races.',
  'Temporarily replace adapter transform method with controlled Promises; restore in finally.',
  'Capture real timer callbacks through calling-task microtasks; restore timers, shut down, then replay cancelled callbacks.',
  'Proxy transform matrix counts numeric allocation reads; count timer calls from late adapter continuations.',
  'Call real device endSession; inline additionally emits its presentation-end notification because it has no presentation.',
]};
const filename = `test-results/${transforms ? "rigid-transform" : "reference-space"}-${browser}.json`;
await mkdir('test-results', {recursive: true});
async function saveRendering(result: any, device: string) {
  for (const render of result.rendering ?? []) {
    const file = `test-results/rigid-transform-${browser}-${device.startsWith('Meta') ? 'quest' : 'android'}-${result.mode}-${render.label}.png`;
    await writeFile(file, Buffer.from(render.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
    delete render.png; render.capture = file;
  }
}
let close: (() => Promise<void>) | undefined;
try {
  const scenarios = [
    ['Meta Quest 3', 'immersive-vr', 'immersive-vr'],
    ['Meta Quest 3', 'immersive-ar', 'immersive-ar'],
    ['Generic Android Phone (ARCore)', 'immersive-ar', 'immersive-ar'],
    ['Meta Quest 3', 'immersive-vr', 'inline'],
    ['Generic Android Phone (ARCore)', 'immersive-ar', 'inline'],
  ] as const;
  // tsx preserves function names with __name; supply only that identity helper.
  const expression = `const __name=value=>value;window.referenceSpaceOutcome={state:'running'};
    (${cases.toString()})(arguments[0]).then(value=>{window.referenceSpaceOutcome={state:'passed',value}},error=>{window.referenceSpaceOutcome={state:'failed',failure:String(error),stack:error.stack}});return true;`;
  if (browser === 'firefox') {
    const firefox = await launchFirefox(); close = () => firefox.close();
    report.versions = firefox.versions;
    await firefox.navigate(origin + '/csp'); await firefox.openPanel();
    for (const [device, selected, mode] of scenarios) {
      console.log('scenario', browser, device, mode);
      await configure(firefox, device, selected); await firefox.navigate(origin + '/csp');
      const start = firefox.logs.length;
      await activate(firefox, expression, [mode]);
      const outcome = await eventually(async () => {
        if (await firefox.evaluate(`return !!document.querySelector('#reference-space-session')`)) {
          const element = await firefox.request<Record<string,string>>('POST', '/element', {using:'css selector', value:'#reference-space-session'});
          await firefox.request('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
        }
        return firefox.evaluate<any>('return {...window.referenceSpaceOutcome,progress:window.rigidTransformProgress,visibility:document.visibilityState}');
      }, value => value?.state !== 'running', 'focused reference-space outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
      await saveRendering(result, device);
      const errors = firefox.logs.slice(start).filter(log => log.level === 'error');
      assert.deepEqual(errors, [], 'no application runtime errors');
      report.results.push({device, selected, ...result as object, errors});
      await writeFile(filename, JSON.stringify(report, null, 2));
    }
    await close(); close = undefined;
    report.cleanup = firefox.cleanup;
    assert(Object.values(firefox.cleanup).every(Boolean), 'Firefox owned resources cleaned up');
  } else {
    const profile = await mkdtemp(path.join(tmpdir(), 'webxr-reference-space-'));
    const context = await chromium.launchPersistentContext(profile, {
      ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
      headless: false, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`, '--auto-open-devtools-for-tabs', '--enable-unsafe-swiftshader'],
    }).catch(async error => { await rm(profile, {recursive: true, force: true}); throw error; });
    const targets: Awaited<ReturnType<typeof attachTarget>>[] = [];
    close = async () => { for (const target of targets) await target.detach().catch(() => {}); await context.close(); await rm(profile, {recursive: true, force: true}); };
    const executable = process.env.WEBXR_CHROMIUM_EXECUTABLE ?? chromium.executablePath();
    report.versions = {browser: context.browser()!.version(), node: process.version, playwright: JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version,
      executableSHA256: createHash('sha256').update(await readFile(executable)).digest('hex')};
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert(worker.url().endsWith('/dist/extension/background.js'));
    const page = await context.newPage(); await page.goto(origin + '/csp');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    const info = await eventually(async () => (await getTargets(cdp)).find(t => t.url.startsWith('devtools://') && t.title.includes(new URL(origin).host)), Boolean, 'real Chromium DevTools target');
    const devtools = await attachTarget(cdp, info!.targetId); targets.push(devtools);
    await eventually(() => devtools.evaluate(async () => {
      const url = './ui/legacy/legacy.js';
      const ui = await import(url);
      const inspector = ui.InspectorView.InspectorView.instance();
      const id = inspector.tabbedPane.tabIds().find((id: string) => id.endsWith('WebXR'));
      if (!id) return false;
      await inspector.showPanel(id); return true;
    }), Boolean, 'registered WebXR tool');
    const panelInfo = await eventually(async () => (await getTargets(cdp)).find(t => t.url.endsWith('/src/app/panel.html')), Boolean, 'actual panel target');
    const panel = await attachTarget(cdp, panelInfo!.targetId); targets.push(panel);
    await eventually(() => panel.evaluate(() => !!document.querySelector('#deviceSelect')), Boolean, 'panel controls');
    for (const [device, selected, mode] of scenarios) {
      console.log('scenario', browser, device, mode);
      await panel.evaluate(({device, selected}) => {
        const d = document.querySelector('#deviceSelect') as HTMLSelectElement; d.value = device; d.dispatchEvent(new Event('change'));
        const m = document.querySelector('#questModeSelect') as HTMLSelectElement; m.value = selected; m.dispatchEvent(new Event('change'));
      }, {device, selected});
      await eventually(() => worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string || '{"deviceKey":"Meta Quest 3","questMode":"immersive-vr"}')), value => value.deviceKey === device && value.questMode === selected, 'saved panel configuration');
      await page.goto(origin + '/csp'); await page.bringToFront(); await page.mouse.click(10,10);
      await page.evaluate(`(function(){${expression}})(${JSON.stringify(mode)})`);
      const outcome = await eventually(async () => {
        if (await page.locator('#reference-space-session').count()) await page.locator('#reference-space-session').click();
        return page.evaluate(() => ({...(window as any).referenceSpaceOutcome, progress:(window as any).rigidTransformProgress, visibility:document.visibilityState}));
      }, value => value?.state !== 'running', 'focused reference-space outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
      await saveRendering(result, device);
      assert.deepEqual(errors, [], 'no application runtime errors');
      report.results.push({device, selected, ...result, errors: [...errors]});
      await writeFile(filename, JSON.stringify(report, null, 2));
    }
    await close(); close = undefined; report.cleanup = {contextClosed: true, profileRemoved: true};
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failures.push(String(error)); throw error; }
finally {
  await close?.(); server.close();
  report.completedAt = new Date().toISOString();
  report.provenance = {};
  for (const file of ['src/polyfill/api/runtime.ts', 'src/polyfill/api/interface-brand.ts', 'src/polyfill/api/geometry.ts', 'src/polyfill/api/XRRay.ts', 'src/polyfill/api/XRHitTestResult.ts', 'src/polyfill/api/layers.ts', 'src/polyfill/CustomWebXRPolyfill.ts', 'tests/firefox-upstream.ts', 'src/polyfill/EmulatedXRDevice.ts', 'package-lock.json', 'tests/rigid-transform.ts', 'tests/reference-space.ts', 'tests/reference-space-browser.ts', 'polyfill/webxr-polyfill.js', 'build/firefox/polyfill/webxr-polyfill.js']) {
    report.provenance[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, browser, scenarios: report.results.length, assertions: report.results.reduce((n: number, r: any) => n+r.assertions, 0), failures: report.failures}));
}
