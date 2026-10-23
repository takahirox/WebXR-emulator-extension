import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {serveFirefoxFixtures} from './firefox-upstream';
import {launchFirefox, eventually} from './firefox-driver';
import {activate, configure} from './firefox-contract';
import {attachTarget, getTargets} from './cdp-target';
import {visibilityCases} from './visibility';

const browser = process.argv[2];
assert(['chromium', 'firefox'].includes(browser), 'Select chromium or firefox');
const {origin, server} = await serveFirefoxFixtures();
const report: any = {issue: 43, browser, status: 'running', startedAt: new Date().toISOString(), results: [], failures: [], skips: [], instrumentation: [
  'Native background tab selection changes document.visibilityState and document.hidden; neither property is overridden.',
  'Chromium connects with noDefaults:true to a directly launched fresh profile: Playwright default focus emulation otherwise keeps documents visible even in background tabs/minimized windows.',
  'Chromium retains normal background scheduling flags and clicks the real entry button with force:true to bypass Playwright RAF stability checks; focus/visibility are never emulated.',
  'Invoke real session tick with performance.now(), cancel its extra RAF, and retain the original handle to test hidden/suppressed processing without tab-throttling ambiguity.',
  'Inspect queued callback counts and document listener identity; temporarily wrap document add/removeEventListener and restore in finally.',
  'Device-driven exit uses the real adapter endSession notification; session entry uses real activation buttons.',
]};
const filename = `test-results/visibility-${browser}.json`;
await mkdir('test-results', {recursive: true});
report.command = `${browser === 'firefox' ? 'WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" ' : ''}npm run test:visibility:${browser}`;
report.tools = {};
for (const name of ['playwright', 'tsx', 'typescript']) report.tools[name] = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8')).version;
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
  const expression = `const __name=value=>value;window.visibilityOutcome={state:'running'};
    (${visibilityCases.toString()})(arguments[0]).then(value=>{window.visibilityOutcome={state:'passed',value}},error=>{window.visibilityOutcome={state:'failed',failure:String(error),stack:error.stack}});return true;`;
  if (browser === 'firefox') {
    const firefox = await launchFirefox(); close = async () => { await firefox.close(); report.cleanup = firefox.cleanup; };
    report.versions = firefox.versions;
    let lastGate = 0;
    const hide = async () => firefox.chrome(`const w = Services.wm.getMostRecentWindow('navigator:browser');
      w.visibilityOriginalTab = w.gBrowser.selectedTab;
      w.visibilityOtherTab = w.gBrowser.addTab('about:blank', {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
      w.gBrowser.selectedTab = w.visibilityOtherTab;`);
    const show = async () => firefox.chrome(`const w = Services.wm.getMostRecentWindow('navigator:browser');
      w.gBrowser.selectedTab = w.visibilityOriginalTab; w.gBrowser.removeTab(w.visibilityOtherTab);`);
    await firefox.navigate(origin + '/csp'); await firefox.openPanel();
    for (const [device, selected, mode] of scenarios) {
      console.log('scenario', browser, device, mode);
      await configure(firefox, device, selected); await firefox.navigate(origin + '/csp');
      lastGate = 0;
      const start = firefox.logs.length;
      await activate(firefox, expression, [mode]);
      const outcome = await eventually(async () => {
        if (await firefox.evaluate(`return !!document.querySelector('#visibility-session')`)) {
          const element = await firefox.request<Record<string,string>>('POST', '/element', {using:'css selector', value:'#visibility-session'});
          await firefox.request('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
        }
        const gate = await firefox.evaluate<any>('return window.visibilityGate');
        if (gate && gate.id !== lastGate) {
          if (gate.state === 'hidden') await hide(); else await show();
          await eventually(() => firefox.evaluate<string>('return document.visibilityState'), state => state === gate.state, 'native document visibility');
          lastGate = gate.id; await firefox.evaluate('window.visibilityGate.ready = true');
        }
        return firefox.evaluate<any>('return window.visibilityOutcome');
      }, value => value?.state !== 'running', 'focused visibility outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
      const errors = firefox.logs.slice(start).filter(log => log.level === 'error');
      assert.deepEqual(errors, [], 'no application runtime errors');
      report.results.push({device, selected, ...result as object, errors});
      await writeFile(filename, JSON.stringify(report, null, 2));
    }
    await close(); close = undefined;
    report.cleanup = firefox.cleanup;
    assert(Object.values(firefox.cleanup).every(Boolean), 'Firefox owned resources cleaned up');
  } else {
    const profile = await mkdtemp(path.join(tmpdir(), 'webxr-visibility-'));
    const executable = process.env.WEBXR_CHROMIUM_EXECUTABLE ?? chromium.executablePath();
    // Playwright's normal launch forces Emulation.setFocusEmulationEnabled on
    // its own CDP session. A separate CDP session cannot clear that override.
    // Connect without defaults so tab selection exercises native visibility.
    const child = spawn(executable, [
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
      `--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`,
      '--auto-open-devtools-for-tabs', '--enable-unsafe-swiftshader', '--disable-background-networking',
      '--password-store=basic', '--use-mock-keychain', '--disable-component-extensions-with-background-pages',
      '--disable-popup-blocking', '--disable-search-engine-choice-screen', '--disable-sync',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', 'about:blank',
    ], {stdio: 'ignore'});
    const stopped = new Promise<void>(resolve => child.once('close', () => resolve()));
    let launchError: Error | undefined; child.on('error', error => { launchError = error; });
    let connection: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    const targets: Awaited<ReturnType<typeof attachTarget>>[] = [];
    close = async () => {
      for (const target of targets) await target.detach().catch(() => {});
      await connection?.close(); child.kill('SIGTERM');
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped; }
      await rm(profile, {recursive: true, force: true});
      report.cleanup = {contextClosed: true, profileRemoved: true, browserStopped: child.exitCode !== null || child.signalCode !== null};
    };
    const port = await eventually(async () => {
      if (launchError) throw launchError;
      return readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    }, Boolean, 'owned Chromium debugging endpoint');
    const [number, route] = port.trim().split('\n');
    connection = await chromium.connectOverCDP(`ws://127.0.0.1:${number}${route}`, {noDefaults: true});
    const context = connection.contexts()[0];
    report.versions = {browser: context.browser()!.version(), node: process.version, playwright: JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version,
      executableSHA256: createHash('sha256').update(await readFile(executable)).digest('hex')};
    const worker = await eventually(async () => context.serviceWorkers().find(worker => worker.url().endsWith('/dist/extension/background.js')), Boolean, 'actual extension worker');
    const page = await context.newPage(); await page.bringToFront();
    await page.goto(origin + '/csp', {waitUntil: 'domcontentloaded'}).catch(async error => {
      report.navigation = await page.evaluate(() => ({url: location.href, ready: document.readyState, visible: document.visibilityState}));
      throw error;
    });
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
    const other = await context.newPage();
    for (const [device, selected, mode] of scenarios) {
      let lastGate = 0;
      console.log('scenario', browser, device, mode);
      await panel.evaluate(({device, selected}) => {
        const d = document.querySelector('#deviceSelect') as HTMLSelectElement; d.value = device; d.dispatchEvent(new Event('change'));
        const m = document.querySelector('#questModeSelect') as HTMLSelectElement; m.value = selected; m.dispatchEvent(new Event('change'));
      }, {device, selected});
      await eventually(() => worker!.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string || '{"deviceKey":"Meta Quest 3","questMode":"immersive-vr"}')), value => value.deviceKey === device && value.questMode === selected, 'saved panel configuration');
      await page.bringToFront(); await page.goto(origin + '/csp', {waitUntil: 'domcontentloaded'});
      await eventually(async () => { await page.bringToFront(); return page.evaluate(() => document.visibilityState); }, state => state === 'visible', 'initial native visible document');
      await page.mouse.click(10,10);
      await page.evaluate(`(function(){${expression}})(${JSON.stringify(mode)})`);
      const outcome = await eventually(async () => {
        if (await page.locator('#visibility-session').count()) {
          await page.bringToFront();
          await page.locator('#visibility-session').click({force: true});
        }
        const gate = await page.evaluate(() => (window as any).visibilityGate);
        if (gate && gate.id !== lastGate) {
          if (gate.state === 'hidden') await other.bringToFront(); else await page.bringToFront();
          await eventually(() => page.evaluate(() => document.visibilityState), state => state === gate.state, 'native document visibility');
          lastGate = gate.id; await page.evaluate(() => { (window as any).visibilityGate.ready = true; });
        }
        return page.evaluate(() => (window as any).visibilityOutcome);
      }, value => value?.state !== 'running', 'focused visibility outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
      assert.deepEqual(errors, [], 'no application runtime errors');
      report.results.push({device, selected, ...result, errors: [...errors]});
      await writeFile(filename, JSON.stringify(report, null, 2));
    }
    await close(); close = undefined;
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failures.push(String(error)); throw error; }
finally {
  await close?.(); server.close();
  report.completedAt = new Date().toISOString();
  report.provenance = {};
  for (const file of ['src/polyfill/api/runtime.ts', 'src/polyfill/EmulatedXRDevice.ts', 'package.json', 'package-lock.json', 'tests/firefox-upstream.ts', 'tests/firefox-contract.ts', 'tests/visibility.ts', 'tests/conformance.ts', 'tests/cdp-target.ts', 'tests/firefox-driver.ts', 'tests/visibility-browser.ts', 'polyfill/webxr-polyfill.js', 'build/firefox/polyfill/webxr-polyfill.js']) {
    report.provenance[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, browser, scenarios: report.results.length, assertions: report.results.reduce((n: number, r: any) => n+r.assertions, 0), failures: report.failures}));
}
