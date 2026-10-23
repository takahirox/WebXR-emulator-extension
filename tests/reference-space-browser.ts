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

const browser = process.argv[2];
assert(['chromium', 'firefox'].includes(browser), 'Select chromium or firefox');
const {origin, server} = await serveFirefoxFixtures();
const report: any = {browser, status: 'running', startedAt: new Date().toISOString(), results: [], failures: [], skips: []};
const filename = `test-results/reference-space-${browser}.json`;
await mkdir('test-results', {recursive: true});
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
    (${referenceSpaceCases.toString()})(arguments[0]).then(value=>{window.referenceSpaceOutcome={state:'passed',value}},error=>{window.referenceSpaceOutcome={state:'failed',failure:String(error),stack:error.stack}});return true;`;
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
        return firefox.evaluate<any>('return window.referenceSpaceOutcome');
      }, value => value?.state !== 'running', 'focused reference-space outcome', 60000);
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
    const profile = await mkdtemp(path.join(tmpdir(), 'webxr-reference-space-'));
    const context = await chromium.launchPersistentContext(profile, {
      ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
      headless: false, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`, '--auto-open-devtools-for-tabs', '--enable-unsafe-swiftshader'],
    }).catch(async error => { await rm(profile, {recursive: true, force: true}); throw error; });
    const targets: Awaited<ReturnType<typeof attachTarget>>[] = [];
    close = async () => { for (const target of targets) await target.detach().catch(() => {}); await context.close(); await rm(profile, {recursive: true, force: true}); };
    report.versions = {browser: context.browser()!.version(), node: process.version, playwright: JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version};
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
        return page.evaluate(() => (window as any).referenceSpaceOutcome);
      }, value => value?.state !== 'running', 'focused reference-space outcome', 60000);
      assert.equal(outcome.state, 'passed', outcome.failure + '\n' + outcome.stack);
      const result = outcome.value;
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
  for (const file of ['src/polyfill/api/runtime.ts', 'src/polyfill/api/interface-brand.ts', 'tests/reference-space.ts', 'tests/reference-space-browser.ts', 'polyfill/webxr-polyfill.js', 'build/firefox/polyfill/webxr-polyfill.js']) {
    report.provenance[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, browser, scenarios: report.results.length, assertions: report.results.reduce((n: number, r: any) => n+r.assertions, 0), failures: report.failures}));
}
