import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const addonId = 'webxr-emulator@takahirox.github.io';
export async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T | undefined;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
}

/** WebDriver Classic for pages, Mozilla's real Marionette actor for the remote
 * DevTools extension frame. No substitute chrome.devtools or page XR messages. */
export async function launchFirefox() {
  const executable = process.env.WEBXR_FIREFOX_EXECUTABLE;
  const geckodriver = process.env.WEBXR_GECKODRIVER;
  assert(executable && path.isAbsolute(executable), 'Set WEBXR_FIREFOX_EXECUTABLE to an absolute Firefox executable path');
  assert(geckodriver && path.isAbsolute(geckodriver), 'Set WEBXR_GECKODRIVER to an absolute geckodriver executable path');
  const driverVersion=execFileSync(geckodriver,['--version'],{encoding:'utf8'}).split('\n')[0];
  const executableSHA256=createHash('sha256').update(await readFile(executable)).digest('hex');
  const driverSHA256=createHash('sha256').update(await readFile(geckodriver)).digest('hex');
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'webxr-firefox-'));
  await mkdir('test-results', {recursive: true});
  const child = spawn(geckodriver, ['--port', '0', '--websocket-port', '0', '--host', '127.0.0.1', '--allow-system-access', '--profile-root', profileRoot]);
  let socket: WebSocket | undefined;
  let browserPid: number | undefined;
  const cleanup = {temporaryAddonRemoved: false, sessionDeleted: false, browserStopped: false, driverStopped: false, profileRemoved: false};
  const logs: {level: string; type: string; text: string; context?: string}[] = [];
  const network: {url: string; status: number; mimeType: string; bytes: number; etag?: string}[] = [];
  let log = ''; let endpoint = ''; let sessionId = ''; let installed = false;
  const listen = (chunk: Buffer) => { log += chunk.toString(); endpoint ||= /Listening on (127\.0\.0\.1:\d+)/.exec(log)?.[1] ?? ''; };
  child.stdout.on('data', listen); child.stderr.on('data', listen);
  const exit = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.on('error', error => { log += String(error); });
  async function request<T = unknown>(method: string, route: string, data?: object): Promise<T> {
    const response = await fetch(`http://${endpoint}${sessionId ? `/session/${sessionId}` : ''}${route}`, {
      method, headers: {'Content-Type': 'application/json'}, ...(data ? {body: JSON.stringify(data)} : {}), signal: AbortSignal.timeout(70000),
    });
    const result = await response.json() as {value: T & {error?: string; message?: string}};
    if (result.value?.error) throw new Error(`${route}: ${result.value.error}: ${result.value.message}`);
    return result.value;
  }
  let closing: Promise<void> | undefined;
  const interrupt = () => {void close().finally(() => process.exit(130));};
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  async function close() {
    if (closing) return closing;
    closing = cleanupOwnedProcesses();
    return closing;
  }
  async function cleanupOwnedProcesses() {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    socket?.close();
    if (sessionId) {
      if (installed) await request('POST', '/moz/addon/uninstall', {id: addonId}).then(() => {cleanup.temporaryAddonRemoved = true;}, error => {log += String(error);});
      await request('DELETE', '').then(() => {cleanup.sessionDeleted = true;}, error => {log += String(error);});
      sessionId = '';
    }
    child.kill('SIGTERM');
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL'); await exit;}
    cleanup.driverStopped = !child.pid || child.exitCode !== null || child.signalCode !== null;
    if (browserPid) {try {process.kill(browserPid, 0);} catch {cleanup.browserStopped = true;}}
    await rm(profileRoot, {recursive: true, force: true});
    cleanup.profileRemoved = true;
    await writeFile('test-results/firefox-driver.log', log);
  }
  async function chrome<T>(script: string, args: unknown[] = []): Promise<T> {
    await request('POST', '/moz/context', {context: 'chrome'});
    try {
      const result = await request<{value?: T; failure?: string}>('POST', '/execute/async', {
        script: `const done = arguments[arguments.length-1]; (async () => { ${script} })().then(value => done({value}), error => done({failure: String(error) + '\\n' + error.stack}));`, args,
      });
      if (result.failure) throw new Error(result.failure);
      return result.value as T;
    } finally { await request('POST', '/moz/context', {context: 'content'}); }
  }
  async function evaluate<T = unknown>(script: string, args: unknown[] = []): Promise<T> {
    return request('POST', '/execute/sync', {script, args});
  }
  async function panel<T = unknown>(script: string, args: unknown[] = []): Promise<T> {
    try { return await chrome<T>(`
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const t = w.webxrTestToolbox;
      const d = t.getAdditionalTools().find(d => d.label === 'WebXR');
      const b = t.doc.getElementById('toolbox-panel-iframe-' + d.id).contentDocument.querySelector('browser');
      if (!b?.currentURI.spec.endsWith('/src/app/panel.html')) return null;
      return b.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(arguments[0], arguments[1], {timeout: 20000});
    `, [script, args]); } catch (error) {
      if (String(error).includes("Actor 'MarionetteCommands' destroyed before query")) return undefined as T;
      throw error;
    }
  }
  try {
    await eventually(async () => endpoint, Boolean, 'geckodriver listener');
    const session = await request<{sessionId: string; capabilities: Record<string, unknown>}>('POST', '/session', {capabilities: {alwaysMatch: {
      webSocketUrl: true,
      'moz:firefoxOptions': {binary: executable, prefs: {'devtools.chrome.enabled': true}},
      timeouts: {script: 30000, pageLoad: 60000, implicit: 0},
    }}});
    sessionId = session.sessionId;
    browserPid = session.capabilities['moz:processID'] as number;
    assert.equal(session.capabilities.browserVersion, '157.0', 'runner pinned to Firefox 157.0');
    assert.equal(session.capabilities['moz:buildID'], '20260924084938', 'runner pinned to official Firefox build');
    assert.equal(session.capabilities['moz:geckodriverVersion'], '0.37.1', 'runner pinned to geckodriver 0.37.1');
    assert.equal(await request('POST', '/moz/addon/install', {path: path.resolve('build/firefox'), temporary: true}), addonId);
    installed = true;
    socket = new WebSocket(session.capabilities.webSocketUrl as string);
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(new Error('BiDi socket failed')); });
    let nextId = 0;
    const pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void}>();
    socket.onmessage = event => {
      const message = JSON.parse(event.data as string);
      if (message.method === 'log.entryAdded') {const p=message.params;logs.push({level:p.level,type:p.type,text:p.text,context:p.source?.context});}
      if (message.method === 'network.responseCompleted') {const r=message.params.response;network.push({url:r.url,status:r.status,mimeType:r.mimeType,bytes:r.bytesReceived,etag:r.headers?.find((h:any)=>h.name.toLowerCase()==='etag')?.value?.value});}
      const callback = pending.get(message.id); if (!callback) return;
      pending.delete(message.id);
      if (message.type === 'error') callback.reject(new Error(JSON.stringify(message))); else callback.resolve(message.result);
    };
    async function bidi<T = unknown>(method: string, params: object): Promise<T> { const id = ++nextId; const result = new Promise<unknown>((resolve, reject) => pending.set(id, {resolve, reject})); socket!.send(JSON.stringify({id, method, params})); return result as Promise<T>; }
    await bidi('session.subscribe', {events: ['log.entryAdded', 'network.responseCompleted']});
    // This is the same MV3 site grant as Firefox's extension permissions UI.
    const observeScenes = await readFile('tests/firefox-scenes.js', 'utf8');
    const processScript = `const observers = Cc['@mozilla.org/observer-service;1'].getService(Ci.nsIObserverService);
      observers.addObserver({observe(document) {
        const w = document.defaultView;
        if (!w?.location.href.endsWith('/src/app/panel.html')) return;
        const sandbox = Cu.Sandbox(w, {sandboxPrototype: w, wantXrays: false});
        Cu.evalInSandbox(${JSON.stringify(observeScenes + '\nobserveScenes()')}, sandbox, 'latest', 'webxr-firefox-observer.js');
      }}, 'document-element-inserted');`;
    await chrome(`Services.ppmm.loadProcessScript(arguments[1], true);
      const {ExtensionPermissions} = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      await ExtensionPermissions.add(arguments[0], {permissions: [], origins: ['http://127.0.0.1/*', 'http://localhost/*']});`, [addonId, 'data:application/javascript,' + encodeURIComponent(processScript)]);
    return {
      request, chrome, evaluate, panel, close, bidi, logs, network, cleanup,
      versions: {browser: session.capabilities.browserVersion, buildID: session.capabilities['moz:buildID'], geckodriver: driverVersion, executableSHA256, driverSHA256, platform: session.capabilities.platformName, platformVersion: session.capabilities['moz:platformVersion'], node: process.version},
      async navigate(url: string) { await request('POST', '/url', {url}); },
      async openPanel() {
        await chrome(`const {require} = ChromeUtils.importESModule('resource://devtools/shared/loader/Loader.sys.mjs');
          const {gDevTools} = require('devtools/client/framework/devtools');
          const w = Services.wm.getMostRecentWindow('navigator:browser');
          w.webxrTestToolbox = await gDevTools.showToolboxForTab(w.gBrowser.selectedTab, {hostType: 'window'});`);
        await eventually(() => chrome<boolean>(`const t = Services.wm.getMostRecentWindow('navigator:browser').webxrTestToolbox;
          const d = t.getAdditionalTools().find(d => d.label === 'WebXR');
          if (!d) return false; await t.selectTool(d.id); return true;`), Boolean, 'registered real WebXR panel');
        await eventually(() => panel<string>(`return document.querySelector('#rightControllerPosition')?.textContent;`), Boolean, 'panel model assets');
      },
      async uninstall() { await request('POST', '/moz/addon/uninstall', {id: addonId}); installed = false; cleanup.temporaryAddonRemoved = true; },
    };
  } catch (error) { await close(); throw error; }
}
