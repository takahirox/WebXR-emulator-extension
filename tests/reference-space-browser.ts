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
import {poseViewCases} from './pose-view';
import {planeCases} from './planes';
import {hitTestCases} from './hit-test';
import {runHitTestApplications} from './hit-test-applications';
import {runPlaneApplications} from './plane-applications';

const browser = process.argv[2];
const hitApplications = process.argv[3] === 'hit-test-applications';
const hitTests = process.argv[3] === 'hit-test';
const applications = process.argv[3] === 'plane-applications' || hitApplications;
const runApplications = hitApplications ? runHitTestApplications : runPlaneApplications;
const planes = process.argv[3] === 'planes';
const transforms = process.argv[3] === 'transforms';
const poses = process.argv[3] === 'poses';
const selection = hitApplications ? 'hit-test-applications' : hitTests ? 'hit-test-contract' : applications ? 'planes-applications' : planes ? 'planes-contract' : poses ? 'pose-view' : transforms ? 'rigid-transform' : 'reference-space';
const cases = hitTests ? hitTestCases : planes ? planeCases : poses ? poseViewCases : transforms ? rigidTransformCases : referenceSpaceCases;
assert(['chromium', 'firefox'].includes(browser), 'Select chromium or firefox');
const {origin, server, provenance} = await serveFirefoxFixtures();
const report: any = {issue: hitTests || hitApplications ? 53 : planes || applications ? 51 : poses ? 49 : transforms ? 47 : 41, browser, status: 'running', startedAt: new Date().toISOString(), results: [], failures: [], skips: [], instrumentation: applications ? [
  ...(hitApplications ? ['Unchanged pinned hit-test applications and dependencies; API and scene observation retains original calls/results/exceptions. Actual panel buttons and phone screen pointer events exercise selection.'] : ['Unchanged pinned applications and their dependencies; only Sample existing overlay checkbox disabled.']),
  'Three.js observe events installed before scripts; original scene.onBeforeRender called with original arguments. Chromium panel bootstrap paused once to install observer, then resumed before running scenarios.',
  ...(hitApplications ? ['XR request/frame/hit-result pose and original scene-node observation preserves calls, return values and exceptions; actual presentation pixels and backend cleanup counters. Additional observer-owned Android transient subscriptions exercise matching/unmatched profiles and pointer movement; application requests remain unchanged.'] : ['XR request/frame/pose/createAnchor observation preserves arguments, return values and exceptions; inspect application scene geometry, actual presentation canvas, retained plane spaces and cleanup counters.']),
  'Genuine panel TransformControls changes viewer/phone poses; real Quest panel button clicks and desktop right-click on the rendered Android phone dispatch selection. No application geometry or logic replaced.',
] : hitTests ? ['Unchanged pinned WPT XRRay constructor/matrix in real injected frames. Genuine request/frame operations across separately injected same-origin realms. Private room, source, matrix-provider and backend collection inspection is restricted to contract cases; unavailable provider restored synchronously. Real RAF, WebGL and extension panel configuration.'] : planes ? [
  'Genuine injected iframe and main realm interfaces and borrowed operations; real RAF and extension panel configuration.',
  'API fixture temporarily moves/scales the actual room, removes/restores its room pointer, and makes one plane native provider unavailable; restored in cleanup. These controls are absent from application scenarios.',
  'WPT assertions adapted from pinned e185958; see docs/webxr-planes.md for fake-device setup differences.',
] : poses ? ['Genuine separately injected iframe and popup constructors, getters and borrowed operations; real inline animation frames in all three realms.', 'Inspect _device, _session, callbacks.size and _presentationCanvas for ownership, calibration/presentation, cleanup and controlled input-button events.', 'Construct explicit unavailable/estimated XRSpace providers; mark _emulatedPosition only for the estimated-provider case. Temporarily remove/restore one gamepad slot synchronously for existing joint tracking loss; toggle/restore one existing input slot for source retirement/reacquisition. Await real AR room readiness. Firefox WebDriver activates the actual main/popup windows for realm inline frames, without modifying visibility. No GL, timers or animation callbacks replaced.'] : transforms ? ['Real injected iframe/popup realms; application-visible matrix transfers, pose queries and WebGL triangle pixels.', 'Inspect _session ownership, callbacks.size and the real layer _presentationCanvas for presented pixels/captures; no adapter, GL or timer replacements.'] : [
  'Inspect session pendingReferenceRequests sizes for release; access _device/_id only for targeted races.',
  'Temporarily replace adapter transform method with controlled Promises; restore in finally.',
  'Capture real timer callbacks through calling-task microtasks; restore timers, shut down, then replay cancelled callbacks.',
  'Proxy transform matrix counts numeric allocation reads; count timer calls from late adapter continuations.',
  'Call real device endSession; inline additionally emits its presentation-end notification because it has no presentation.',
]};
const filename = `test-results/${selection}-${browser}.json`;
await mkdir('test-results', {recursive: true});
async function saveRendering(result: any, device: string) {
  for (const render of result.rendering ?? []) {
    const file = `test-results/${selection}-${browser}-${device.startsWith('Meta') ? 'quest' : 'android'}-${result.mode}-${render.label}.png`;
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
    if (applications) await firefox.bidi('script.addPreloadScript', {functionDeclaration: await readFile('tests/firefox-scenes.js','utf8')});
    await firefox.navigate(origin + '/csp'); await firefox.openPanel();
    if (applications) report.results=await runApplications({
      browser,origin,navigate:url=>firefox.navigate(url),configure:device=>configure(firefox,device,'immersive-ar'),
      evaluate:(script,args)=>firefox.evaluate(script,args),panel:(script,args)=>firefox.panel(script,args),
      clickEntry:async()=>{const button=await firefox.evaluate<Record<string,string>>(`return [...document.querySelectorAll('button')].find(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`);await firefox.request('POST',`/element/${button['element-6066-11e4-a52e-4f735466cecf']}/click`,{});},
      screenshot:async()=>Buffer.from(await firefox.request<string>('GET','/screenshot'),'base64'),
      phoneSelect:(point,moveTo,button='right')=>firefox.request('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:100,origin:'viewport',...point},{type:'pointerDown',button:button==='left'?0:2},{type:'pause',duration:button==='left'?50:200},...(moveTo?[{type:'pointerMove',duration:200,origin:'viewport',...moveTo},{type:'pause',duration:200}]:[]),{type:'pointerUp',button:button==='left'?0:2}]}]}),
    });
    else for (const [device, selected, mode] of scenarios) {
      console.log('scenario', browser, device, mode);
      await configure(firefox, device, selected); await firefox.navigate(origin + '/csp');
      const start = firefox.logs.length;
      const mainHandle = poses ? await firefox.request<string>('GET', '/window') : '';
      await activate(firefox, expression, [mode]);
      const outcome = await eventually(async () => {
        // Firefox may ignore script window.focus(). Activate the actual top-level
        // window needed by this realm's inline RAF, preserving visibility policy.
        if (poses) await firefox.request('POST', '/window', {handle: mainHandle});
        if (await firefox.evaluate(`return !!document.querySelector('#reference-space-session')`)) {
          const element = await firefox.request<Record<string,string>>('POST', '/element', {using:'css selector', value:'#reference-space-session'});
          await firefox.request('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
        }
        const value = await firefox.evaluate<any>('return {...window.referenceSpaceOutcome,progress:window.rigidTransformProgress,visibility:document.visibilityState,realm:window.poseViewRealm}');
        if (poses && value.state === 'running' && value.realm === 'popup') {
          const handles = await firefox.request<string[]>('GET', '/window/handles');
          const popupHandle = handles.find(handle => handle !== mainHandle);
          if (popupHandle) await firefox.request('POST', '/window', {handle: popupHandle});
        }
        return value;
      }, value => value?.state !== 'running', 'focused reference-space outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
      await saveRendering(result, device);
      const errors = firefox.logs.slice(start).filter(log => log.level === 'error');
      assert.deepEqual(errors, [], 'no application runtime errors');
      report.results.push({device, selected, ...result as object, errors});
      await writeFile(filename, JSON.stringify(report, null, 2));
    }
    report.browserFetches=firefox.network;report.runtimeErrors=firefox.logs.filter(log=>log.level==='error');
    if(applications)assert.deepEqual(report.runtimeErrors,[],'no application runtime errors');
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
    const page = await context.newPage();
    if(applications)await page.addInitScript((await readFile('tests/firefox-scenes.js','utf8'))+';observeScenes();');
    await page.goto(origin + '/csp');
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
    await eventually(() => panel.evaluate(() => !!document.querySelector('#rightControllerPosition')?.textContent), Boolean, 'panel controls and model readiness');
    if(applications) {
      const observed=await readFile('tests/firefox-scenes.js','utf8');
      await panel.command('Debugger.enable',{});
      const extensionOrigin=worker.url().slice(0,worker.url().indexOf('/','chrome-extension://'.length));
      const {breakpointId}=await panel.command<{breakpointId:string}>('Debugger.setBreakpointByUrl',{url:extensionOrigin+'/dist/app/panel.js',lineNumber:0});
      const paused=panel.nextEvent<{callFrames:{callFrameId:string}[]}>('Debugger.paused');
      await panel.evaluate(()=>location.reload());const pause=await paused;
      await panel.command('Debugger.evaluateOnCallFrame',{callFrameId:pause.callFrames[0].callFrameId,expression:observed+';observeScenes();'});
      await panel.command('Debugger.removeBreakpoint',{breakpointId});await panel.command('Debugger.resume',{});await panel.command('Debugger.disable',{});
      await eventually(()=>panel.evaluate(()=>!!(window as any).firefoxScenes?.length && !!document.querySelector('#rightControllerPosition')?.textContent),Boolean,'observed real panel/assets');
      report.results=await runApplications({
        browser,origin,navigate:async url=>{await page.goto(url);await page.bringToFront();},
        configure:async device=>{
          await panel.evaluate(device=>{const d=document.querySelector('#deviceSelect') as HTMLSelectElement;d.value=device;d.dispatchEvent(new Event('change'));const m=document.querySelector('#questModeSelect') as HTMLSelectElement;m.value='immersive-ar';m.dispatchEvent(new Event('change'));},device);
          await eventually(()=>worker.evaluate(async()=>JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string || '{}')),v=>v.deviceKey===device && v.questMode==='immersive-ar','saved real panel configuration');
        },
        evaluate:(script,args=[])=>page.evaluate(`(function(){${script}}).apply(null,${JSON.stringify(args)})`),
        panel:async(script,args=[])=>{const r=await panel.command<any>('Runtime.evaluate',{expression:`(function(){${script}}).apply(null,${JSON.stringify(args)})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;},
        clickEntry:async()=>{await page.getByRole('button',{name:/START AR|ENTER AR/}).click();},
        screenshot:()=>page.screenshot(),phoneSelect:async(point,moveTo,button='right')=>{await page.mouse.move(point.x,point.y);await page.mouse.down({button});await page.waitForTimeout(button==='left'?50:200);if(moveTo){await page.mouse.move(moveTo.x,moveTo.y,{steps:8});await page.waitForTimeout(200);}await page.mouse.up({button});},
      });
      assert.deepEqual(errors,[],'no application runtime errors');
    } else for (const [device, selected, mode] of scenarios) {
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
  report.servedSources=[...provenance.values()];
  report.provenance = {};
  for (const file of ['src/polyfill/api/runtime.ts', 'src/polyfill/api/interface-brand.ts', 'src/polyfill/api/hit-test-allocation.ts', 'src/polyfill/api/geometry.ts', 'src/polyfill/api/XRRay.ts', 'src/polyfill/api/XRHitTestResult.ts', 'src/polyfill/api/layers.ts', 'src/polyfill/CustomWebXRPolyfill.ts', 'tests/firefox-upstream.ts', 'src/polyfill/EmulatedXRDevice.ts', 'package-lock.json', 'package.json', 'src/polyfill/api/layer-allocation.ts', 'tests/environment.ts', 'tests/rigid-transform.ts', 'tests/reference-space.ts', 'tests/pose-view.ts', 'src/polyfill/api/environment.ts', 'src/polyfill/api/plane-regions.ts', 'tests/planes.ts', 'tests/plane-applications.ts', 'tests/hit-test.ts', 'tests/hit-test-applications.ts', 'tests/hit-test-sample-observer.js', 'src/polyfill/api/hit-test-options.ts', 'src/polyfill/api/hit-test-geometry.ts', 'src/polyfill/api/XRHitTestSource.ts', 'src/polyfill/api/XRTransientInputHitTestSource.ts', 'src/polyfill/api/XRTransientInputHitTestResult.ts', 'src/polyfill/ARScene.ts', 'src/polyfill/api/sensing.ts', 'tests/reference-space-browser.ts', 'polyfill/webxr-polyfill.js', 'build/firefox/polyfill/webxr-polyfill.js']) {
    report.provenance[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, browser, scenarios: report.results.length, assertions: report.results.reduce((n: number, r: any) => n+(r.assertions??0), 0), failures: report.failures}));
}
