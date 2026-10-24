import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {eventually, launchFirefox} from './firefox-driver';
import {configure} from './firefox-contract';
import {attachTarget, getTargets} from './cdp-target';
import {observeTracking} from './tracking-observation';

export async function trackingBrowser(browser: string, origin: string) {
  const scenes = await readFile('tests/firefox-scenes.js', 'utf8');
  const preload = `${scenes}\nobserveScenes();const __name=value=>value;(${observeTracking.toString()})();`;
  if (browser === 'firefox') {
    const f = await launchFirefox();
    try {
      await f.bidi('script.addPreloadScript', {functionDeclaration: `() => {${preload}}`});
      await f.navigate(origin + '/csp'); await f.openPanel();
      await configure(f, 'Meta Quest 3', 'immersive-vr');
      return {
        versions: f.versions, cleanup: f.cleanup,
        logs: f.logs, network: f.network,
        navigate: f.navigate,
        evaluate: async <T = any>(script: string, args: unknown[] = []): Promise<T> => f.evaluate<T>(script, args),
        panel: async <T = any>(script: string, args: unknown[] = []): Promise<T> => f.panel<T>(script, args),
        async realm(expression: string) {
          const result = await f.bidi<any>('script.evaluate', {expression, target: {context: await f.request('GET', '/window')}, awaitPromise: true});
          assert.equal(result.type, 'success', JSON.stringify(result));
        },
        async click(pattern: string) {
          const element = await eventually(() => f.evaluate<Record<string, string>>(`return [...document.querySelectorAll('button')].find(b=>new RegExp(arguments[0]).test(b.textContent)&&!b.disabled);`, [pattern]), Boolean, 'application control', 60000);
          if (pattern === 'STOP|EXIT') {
            await f.chrome(`const w=Services.wm.getMostRecentWindow('navigator:browser');w.focus();w.gBrowser.selectedBrowser.focus();`);
            await f.evaluate(`arguments[0].focus();`, [element]);
            await f.request('POST', '/actions', {actions: [{type: 'key', id: 'exit-keyboard', actions: [{type: 'keyDown', value: '\uE007'}, {type: 'keyUp', value: '\uE007'}]}]});
          }
          else await f.request('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
        },
        async screenshot() { return Buffer.from(await f.request<string>('GET', '/screenshot'), 'base64'); },
        close: f.close,
      };
    } catch (error) { await f.close(); throw error; }
  }
  const profile = await mkdtemp(path.join(tmpdir(), 'webxr-tracking-'));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
    headless: false, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`, '--auto-open-devtools-for-tabs', '--enable-unsafe-swiftshader'],
  }).catch(async error => {await rm(profile, {recursive: true, force: true}); throw error;});
  const targets: Awaited<ReturnType<typeof attachTarget>>[] = [];
  const cleanup: Record<string, boolean> = {};
  const close = async () => {
    try {for (const t of targets) await t.detach().catch(() => {}); await context.close(); cleanup.browserStopped = true;}
    finally {await rm(profile, {recursive: true, force: true}); cleanup.profileRemoved = true;}
  };
  try {
    // Panel scene observer must precede panel construction too.
    await context.addInitScript({content: scenes + '\nobserveScenes();'});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert(worker.url().endsWith('/dist/extension/background.js'));
    const page = await context.newPage();
    const logs: any[] = [], network: any[] = [];
    page.on('pageerror', error => logs.push({level: 'error', text: error.message}));
    page.on('console', message => logs.push({level: message.type(), text: message.text()}));
    page.on('response', response => network.push({url: response.url(), status: response.status(), mimeType: response.headers()['content-type'], etag: response.headers()['etag'], bytes: response.headers()['content-length']}));
    await page.addInitScript({content: `const __name=value=>value;(${observeTracking.toString()})();`});
    await page.goto(origin + '/csp');
    const cdp = await context.newCDPSession(page);
    const info = await eventually(async () => (await getTargets(cdp)).find(t => t.url.startsWith('devtools://') && t.title.includes(new URL(origin).host)), Boolean, 'real Chromium DevTools');
    const devtools = await attachTarget(cdp, info!.targetId); targets.push(devtools);
    await eventually(() => devtools.evaluate(async () => {
      const url = './ui/legacy/legacy.js', ui = await import(url);
      const inspector = ui.InspectorView.InspectorView.instance();
      const id = inspector.tabbedPane.tabIds().find((id: string) => id.endsWith('WebXR'));
      if (!id) return false; await inspector.showPanel(id); return true;
    }), Boolean, 'registered WebXR panel');
    const panelInfo = await eventually(async () => (await getTargets(cdp)).find(t => t.url.endsWith('/src/app/panel.html')), Boolean, 'real panel target');
    const panel = await attachTarget(cdp, panelInfo!.targetId); targets.push(panel);
    await panel.command('Debugger.enable', {});
    const extensionOrigin = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length));
    const {breakpointId} = await panel.command<{breakpointId: string}>('Debugger.setBreakpointByUrl', {url: extensionOrigin + '/dist/app/panel.js', lineNumber: 0});
    const paused = panel.nextEvent<{callFrames: {callFrameId: string}[]}>('Debugger.paused');
    await panel.evaluate(() => { location.reload(); });
    const pause = await paused;
    await panel.command('Debugger.evaluateOnCallFrame', {callFrameId: pause.callFrames[0].callFrameId, expression: scenes + '\nobserveScenes();'});
    await panel.command('Debugger.removeBreakpoint', {breakpointId});
    await panel.command('Debugger.resume', {}); await panel.command('Debugger.disable', {});
    await eventually(() => panel.evaluate(() => !!(window as any).firefoxScenes?.length && !!document.querySelector('#rightControllerPosition')?.textContent), Boolean, 'panel scene/assets');
    const evaluate = async <T = any>(script: string, args: unknown[] = []): Promise<T> => page.evaluate(`(function(){${script}}).apply(null,${JSON.stringify(args)})`);
    const panelEval = async <T = any>(script: string, args: unknown[] = []): Promise<T> => {
      const result = await panel.command<any>('Runtime.evaluate', {expression: `(function(){${script}}).apply(null,${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    await panelEval(`const d=document.querySelector('#deviceSelect');d.value='Meta Quest 3';d.dispatchEvent(new Event('change'));const m=document.querySelector('#questModeSelect');m.value='immersive-vr';m.dispatchEvent(new Event('change'));`);
    await eventually(() => worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('webxr-extension'))['webxr-extension'] as string || '{"deviceKey":"Meta Quest 3","questMode":"immersive-vr"}')), v => v.deviceKey === 'Meta Quest 3' && v.questMode === 'immersive-vr', 'saved panel configuration');
    const executable = process.env.WEBXR_CHROMIUM_EXECUTABLE ?? chromium.executablePath();
    return {
      versions: {browser: context.browser()!.version(), build: await cdp.send('Browser.getVersion'), playwright: JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version, node: process.version, executableSHA256: createHash('sha256').update(await readFile(executable)).digest('hex')},
      cleanup, logs, network,
      async navigate(url: string) {await page.goto(url); await page.bringToFront();},
      evaluate, panel: panelEval,
      async realm(expression: string) {await page.evaluate(expression);},
      async click(pattern: string) {
        await eventually(() => evaluate<number>(`return [...document.querySelectorAll('button')].filter(b=>new RegExp(arguments[0]).test(b.textContent)&&!b.disabled).length`, [pattern]), n => n > 0, 'application control', 60000);
        const control = page.locator('button').filter({hasText: new RegExp(pattern)});
        if (pattern === 'STOP|EXIT') await control.press('Enter'); else await control.click();
      },
      async screenshot() {return page.screenshot();}, close,
    };
  } catch (error) { await close(); throw error; }
}
