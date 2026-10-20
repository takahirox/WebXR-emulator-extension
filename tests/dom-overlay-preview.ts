/** Focused reproduction of the public preview checks also run by test:browser. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {installThreeProbe} from './three-probe';
import {runDOMOverlayPreview} from './dom-overlay-production';

const root = process.cwd();
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body>Preview test page</body>');
});
server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP port');
const profile = await mkdtemp(path.join(tmpdir(), 'webxr-preview-'));
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
  headless: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: {width: 1280, height: 720},
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-swiftshader'],
}).catch(async error => { server.close(); await rm(profile, {recursive: true, force: true}); throw error; });
try {
  await mkdir('test-results', {recursive: true});
  await context.addInitScript(installThreeProbe);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const results = [];
  for (const deviceKey of ['Generic Android Phone (ARCore)', 'Meta Quest 3']) {
    await worker.evaluate(async deviceKey => chrome.storage.local.set({'webxr-extension': JSON.stringify({deviceKey, questMode: 'immersive-ar', domOverlayPreview: true})}), deviceKey);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    results.push(await runDOMOverlayPreview(page, deviceKey.startsWith('Generic'), async () => {}));
    assert.deepEqual(errors, [], `${deviceKey}: no page runtime errors`);
    await page.close();
  }
  await writeFile('test-results/dom-overlay-preview-focused.json', JSON.stringify({browser: await context.browser()!.version(), results}, null, 2));
  console.log('Android and Quest public preview checks passed');
} finally { await context.close(); server.close(); await rm(profile, {recursive: true, force: true}); }
