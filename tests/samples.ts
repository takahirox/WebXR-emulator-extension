import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root = process.cwd(); const profile = await mkdtemp(path.join(tmpdir(), 'webxr-samples-'));
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
  headless: false, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-swiftshader'],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const results: object[] = []; await mkdir('test-results', {recursive: true});
  for (const [sample, deviceKey, questMode, preview = false] of [
    ['immersive-vr-session.html', 'Meta Quest 3', 'immersive-vr'],
    ['hit-test.html', 'Meta Quest 3', 'immersive-ar'],
    ['proposals/plane-detection.html', 'Meta Quest 3', 'immersive-ar'],
    ['proposals/plane-detection.html', 'Generic Android Phone (ARCore)', 'immersive-ar'],
    ['proposals/mesh-detection.html', 'Meta Quest 3', 'immersive-ar'],
    ['proposals/mesh-detection.html', 'Generic Android Phone (ARCore)', 'immersive-ar'],
    ['hit-test.html', 'Generic Android Phone (ARCore)', 'immersive-ar'],
    ['ar-barebones.html', 'Generic Android Phone (ARCore)', 'immersive-ar'],
    ['ar-barebones.html', 'Meta Quest 3', 'immersive-ar'],
    ['ar-barebones.html', 'Generic Android Phone (ARCore)', 'immersive-ar', true],
    ['ar-barebones.html', 'Meta Quest 3', 'immersive-ar', true],
  ] as const) {
    await worker.evaluate(async ({deviceKey, questMode, preview}) => chrome.storage.local.set({'webxr-extension': JSON.stringify({deviceKey, questMode, stereoEffect: true, domOverlayPreview: preview})}), {deviceKey, questMode, preview});
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = `https://immersive-web.github.io/webxr-samples/${sample}`;
    await page.goto(url, {waitUntil: 'networkidle', timeout: 60000});
    // Observe the real sample's request/frames; the sample and extension files are unmodified.
    await page.evaluate(`(() => {
      window.sampleProbe = {frames: 0, hits: 0, planes: 0, meshes: 0, ended: false};
      const request = navigator.xr.requestSession.bind(navigator.xr);
      navigator.xr.requestSession = (...args) => {
        const originalStyle = args[1]?.domOverlay?.root?.style.cssText;
        return request(...args).then(session => {
          if (args[0] === 'inline') return session;
          window.sampleProbe.session = session;
          window.sampleProbe.overlayRoot = args[1]?.domOverlay?.root;
          window.sampleProbe.originalStyle = originalStyle;
          session.addEventListener('end', () => { window.sampleProbe.ended = true; });
          const raf = session.requestAnimationFrame.bind(session);
          session.requestAnimationFrame = callback => raf((time, frame) => {
            window.sampleProbe.frames++;
            window.sampleProbe.planes = Math.max(window.sampleProbe.planes, frame.detectedPlanes.size);
            window.sampleProbe.meshes = Math.max(window.sampleProbe.meshes, frame.detectedMeshes.size);
            const hits = frame.getHitTestResults.bind(frame);
            frame.getHitTestResults = source => { const results = hits(source); window.sampleProbe.hits = Math.max(window.sampleProbe.hits, results.length); return results; };
            callback(time, frame);
          });
          return session;
        });
      };
    })()`);
    await page.bringToFront();
    const button = page.getByRole('button', {name: /START (VR|AR)|ENTER (VR|AR)/i});
    await button.click({timeout: 20000});
    await page.waitForFunction(() => (window as unknown as {sampleProbe: {frames: number}}).sampleProbe.frames >= 120, undefined, {timeout: 30000}).catch(async error => { console.log(JSON.stringify({url, deviceKey, errors, probe: await page.evaluate('({frames: window.sampleProbe.frames, session: !!window.sampleProbe.session, text: document.body.innerText.slice(-700), ended: window.sampleProbe.session.ended, visibility: window.sampleProbe.session.visibilityState, layer: !!window.sampleProbe.session.renderState.baseLayer, contextLost: window.sampleProbe.session.renderState.baseLayer?.context.isContextLost(), attributes: window.sampleProbe.session.renderState.baseLayer?.context.getContextAttributes()})')}, null, 2)); throw error; });
    if (sample === 'hit-test.html') await page.waitForFunction(() => (window as unknown as {sampleProbe: {hits: number}}).sampleProbe.hits > 0);
    if (sample.includes('plane-detection')) assert(await page.evaluate('window.sampleProbe.planes > 0'), 'published plane sample receives room geometry');
    if (sample.includes('mesh-detection')) assert(await page.evaluate('window.sampleProbe.meshes > 0'), 'published mesh sample receives room geometry');
    await page.screenshot({path: `test-results/sample-${deviceKey.startsWith('Meta') ? 'quest' : 'phone'}-${questMode}-${sample.replace('.html', '').replace(/\//g, '-')}-${preview ? 'preview' : 'default'}.png`});
    let overlay: unknown;
    if (sample === 'ar-barebones.html') {
      overlay = await page.evaluate(`({enabled: window.sampleProbe.session.enabledFeatures.includes('dom-overlay'), type: window.sampleProbe.session.domOverlayState?.type ?? null, sameRoot: window.sampleProbe.overlayRoot === document.getElementById('overlay')})`);
      assert.deepEqual(overlay, {enabled: preview, type: preview ? 'screen' : null, sameRoot: true});
      if (preview) {
        const button = page.getByRole('button', {name: /EXIT AR/i});
        const box = await button.boundingBox(); assert(box && box.width > 0 && box.height > 0);
        assert(await button.evaluate(element => { const r = element.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === element; }), 'sample exit control is visible above the XR compositor');
        await button.click(); // Original sample listener ends the session.
        await page.waitForFunction(() => (window as unknown as {sampleProbe: {ended: boolean}}).sampleProbe.ended);
      } else {
        assert(await page.evaluate(`!window.sampleProbe.overlayRoot.hasAttribute('popover') && window.sampleProbe.overlayRoot.style.cssText === window.sampleProbe.originalStyle`), 'disabled overlay leaves the published sample root untouched');
        await page.evaluate(`window.sampleProbe.session.end()`);
      }
      assert(await page.evaluate(`!window.sampleProbe.overlayRoot.hasAttribute('popover') && window.sampleProbe.overlayRoot.style.cssText === window.sampleProbe.originalStyle`), 'sample root is restored on end');
    } else await page.evaluate(`window.sampleProbe.session.end()`);
    assert.deepEqual(errors, [], `${deviceKey} ${sample} runtime errors`);
    results.push({url, deviceKey, questMode, preview, overlay, probe: await page.evaluate(() => { const probe = (window as unknown as {sampleProbe: {frames: number; hits: number; planes: number; meshes: number}}).sampleProbe; return {frames: probe.frames, hits: probe.hits, planes: probe.planes, meshes: probe.meshes}; }), errors});
    await page.close();
  }
  const report = {browser: await context.browser()!.version(), results}; await writeFile('test-results/webxr-samples.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); await rm(profile, {recursive: true, force: true}); }
