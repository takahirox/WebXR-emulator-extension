import assert from 'node:assert/strict';
import {Matrix4, Vector3, Quaternion, Euler} from 'three';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serveFirefoxFixtures, revisions} from './firefox-upstream';
import {eventually} from './firefox-driver';
import {trackingBrowser} from './tracking-browser';
import {observeSample, trackingPixels, trackingLifetime} from './tracking-observation';

const browser = process.argv[2];
assert(['chromium', 'firefox'].includes(browser), 'Select chromium or firefox');
const {origin, server, provenance, upstream} = await serveFirefoxFixtures();
const report: any = {issue: 45, browser, status: 'running', startedAt: new Date().toISOString(), command: `${browser==='firefox'?'WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" ':''}npm run test:tracking:${browser}`, revisions, results: [], failures: [], blockers: ['Pinned Input Tracking computes NaN cursors and does not apply grip transforms to its registered generic meshes; see docs/webxr-tracking.md'], skips: [], unperformed: ['Full WPT suite; other applications, devices and browser versions'], units: {position: 'metres', rotation: 'radians', matrixTolerance: 0.0001, releaseTolerance: 0.00001}};
await mkdir('test-results', {recursive: true});
report.tools = {};
for (const name of ['tsx','typescript','playwright','three']) report.tools[name] = JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8')).version;
const filename = `test-results/tracking-${browser}.json`;
let b: Awaited<ReturnType<typeof trackingBrowser>> | undefined;
const save = () => writeFile(filename, JSON.stringify(report, null, 2));
const expression = (f: Function) => `const __name=value=>value;return (${f.toString()})();`;
const matrixDifference = (a: number[], c: number[]) => Math.max(...a.map((v, i) => Math.abs(v - c[i])));
function closeMatrix(a: number[], c: number[], label: string, tolerance = 1e-4) {assert(a && c && a.length === c.length && matrixDifference(a, c) < tolerance, label + ': ' + JSON.stringify({a, c}));}
try {
  for (const name of ['xrInputSource_sameObject.https.html', 'xrFrame_lifetime.https.html']) await upstream(`https://raw.githubusercontent.com/web-platform-tests/wpt/${revisions.wpt}/webxr/${name}`);
  b = await trackingBrowser(browser, origin); report.versions = b.versions;
  console.log('browser', report.versions);
  for (const app of ['input-tracking', 'dragging']) {
    console.log('scenario', browser, app);
    const result: any = {app, status: app === 'input-tracking' ? 'blocked-upstream' : 'running', cycles: []}; report.results.push(result);
    const logStart = b.logs.length;
    await b.panel(`document.querySelector('#resetPoseButton').click();`);
    const settings: any = result.settings = await b.panel(`return {device:document.querySelector('#deviceSelect').value,mode:document.querySelector('#questModeSelect').value,stereo:document.querySelector('#stereoCheckbox').checked,overlay:document.querySelector('#domOverlayPreviewCheckbox').checked};`);
    assert.deepEqual(settings, {device: 'Meta Quest 3', mode: 'immersive-vr', stereo: true, overlay: false});
    await b.navigate(origin + (app === 'input-tracking' ? '/samples/input-tracking.html' : '/three/examples/webxr_xr_dragging.html'));
    await eventually(() => b!.evaluate(`return !!window.tracking`), Boolean, 'XR observation installed');
    if (app === 'input-tracking') await b.realm(`(${observeSample.toString()})();`);
    const positions: Record<string, number[]> = {viewer: [0, 1.6, 0], right: [0.5, 1.5, -1], left: [-0.5, 1.5, -1]};
    async function pose(hand: string, position: number[], yaw = 0, pitch = 0) {
      const count = await b!.panel<number>(`let n=0;window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o)return;if(c.object.position.toArray().some((v,i)=>Math.abs(v-arguments[0][i])>0.001))return;c.object.position.fromArray(arguments[1]);c.object.rotation.set(arguments[3],arguments[2],0);c.dispatchEvent({type:'change'});n++;});return n;`, [positions[hand], position, yaw, pitch]);
      assert.equal(count, 1, hand + ' real panel TransformControls'); positions[hand] = position;
      await eventually(() => b!.evaluate<any>(`const r=window.tracking.sessions.filter(s=>s.mode==='immersive-vr').at(-1);return arguments[0]==='viewer'?r.viewer?.slice(12,15):r.poses[arguments[0]+'-ray']?.slice(12,15);`, [hand]), p => p?.every((v: number, i: number) => Math.abs(v - position[i]) < 1e-4), 'application consumes panel pose');
    }
    const expectedMatrix = (position: number[], yaw: number, pitch: number) => new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(pitch,yaw,0)), new Vector3(1,1,1)).elements;
    const current = () => b!.evaluate<any>(`return window.tracking.sessions.filter(s=>s.mode==='immersive-vr').at(-1)`);
    const pixels = async () => {
      const value = await b!.evaluate<any>(expression(trackingPixels));
      assert.equal(value.layer, app === 'input-tracking' ? 'base' : 'projection');
      assert(value.width > 0 && value.height > 0 && value.presented, 'positive connected presented output');
      assert(value.regions.every((r: any) => r.foreground > 100 && r.colors > 100), 'identifiable non-background application pixels in both eyes');
      return value;
    };
    const screenshot = async (suffix: string) => {
      const file = `test-results/tracking-${browser}-${app}-${suffix}.png`;
      await writeFile(file, await b!.screenshot()); return file;
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      await b.click('START|ENTER');
      await eventually(current, r => r?.frames >= 30, '30 immersive application callbacks', 60000);
      const c: any = {cycle, before: await current()}; result.cycles.push(c);
      if (cycle) {
        const fresh = await b.evaluate(`const lives=window.trackingLive.filter(v=>v.record.mode==='immersive-vr'),a=lives[0],z=lives.at(-1);return {sources:[...z.session.inputSources].every(s=>!a.sources.some(old=>old.source===s||old.ray===s.targetRaySpace||old.grip===s.gripSpace)&&s.gamepad.buttons.every(b=>!b.pressed)),layers:a.session.renderState.baseLayer!==z.session.renderState.baseLayer||a.session.renderState.layers?.[0]!==z.session.renderState.layers?.[0],oldDisconnected:a.sources.every(v=>!v.source.gamepad.connected),oldCanvasDetached:!a.finalCanvas?.isConnected};`);
        assert(fresh.sources && fresh.layers && fresh.oldDisconnected && fresh.oldCanvasDetached, 'restart uses fresh sources/spaces/resources and reset input'); c.fresh = fresh;
      }
      c.pixelsBefore = await pixels();
      if (app === 'input-tracking') {
        c.tracking = [];
        for (const [hand, p, yaw, pitch] of [
          ['right', [0.35, 1.35, -0.65], 0.35, -0.2],
          ['left', [-0.3, 1.45, -0.7], -0.4, 0.15],
          ['viewer', [0.12, 1.7, 0.15], 0.1, 0],
        ] as [string, number[], number, number][]) {
          // Distinct second-cycle poses prove meaningful restarted tracking.
          const position = p.map((v, i) => v + (cycle && i === 0 ? 0.04 : 0));
          const before = await current();
          const beforePixels = await pixels();
          await pose(hand, position, yaw + cycle * 0.05, pitch);
          const after = await current();
          closeMatrix(hand==='viewer'?after.viewer:after.poses[hand+'-ray'], expectedMatrix(position,yaw+cycle*0.05,pitch), 'commanded translation and rotation');
          const afterPixels = await pixels();
          assert(afterPixels.regions.every((r: any) => r.changedOutsideStats > 5), 'presented pixels change in both eyes outside the animated stats region: ' + JSON.stringify({hand,beforePixels,afterPixels}));
          if (hand !== 'viewer') {
            assert(matrixDifference(before.poses[hand + '-ray'], after.poses[hand + '-ray']) > 0.01, 'controller pose changes');
            const other = hand === 'right' ? 'left' : 'right';
            closeMatrix(before.poses[other + '-ray'], after.poses[other + '-ray'], 'independent other controller');
          }
          const consumed = await b.evaluate(`return window.sampleConsumed`);
          for (const h of ['right', 'left']) {
            const ray = after.poses[h + '-ray'], grip = after.poses[h + '-grip'];
            closeMatrix(consumed[h + '-addLaserPointer'].matrix, ray, h + ' application ray');
            closeMatrix(consumed[h + '-addController'].matrix, grip, h + ' application grip');
            assert(!consumed[h + '-addCursor'].finite, 'record pinned upstream non-finite cursor defect');
            assert(!consumed[h + '-addController'].rendered, 'record pinned upstream grip profile lookup defect');
            assert(consumed[h + '-addLaserPointer'].rendered && consumed[h + '-addCursor'].rendered, 'ray and cursor nodes visible');
          }
          c.tracking.push({hand, commanded: {position, yaw: yaw + cycle * 0.05, pitch}, after, consumed, beforePixels, pixels: afterPixels, screenshot: await screenshot(`${cycle}-${hand}-moved`)});
        }
        assert.deepEqual((await current()).events, [], 'Sample deliberately has no button interactions');
        // The pinned Sample registers generic meshes but indexes by profiles[0].
        // Record its upstream rendering mismatch without modifying valid profiles.
        c.upstreamLimitations = ['Cursor coordinates are NaN: Sample passes a transform object to matrix-array Ray and reads typed-array .x/.y/.z', 'Grip model lookup misses: registered _right/_left, requested meta-quest-touch-plus_right/left'];
        c.gripMeshObservation = await b.evaluate(`return Object.fromEntries(Object.entries(window.sampleConsumed).filter(([k])=>k.endsWith('addController')))`);
      } else {
        c.drags = [];
        await pose('viewer', [0, 1.6, 0]);
        for (const hand of ['right', 'left']) {
          const target = await b.evaluate(`const e=window.firefoxScenes.find(e=>e.renderer?.xr?.isPresenting);const group=e.scene.children.find(o=>o.isGroup&&o.children.length===50&&o.children.every(c=>c.isMesh));if(!group)throw Error('original 50-object group missing');const candidates=group.children.filter(o=>o.geometry.type==='BoxGeometry'&&o.position.z<-.3).sort((a,b)=>Math.abs(a.position.x)-Math.abs(b.position.x));const object=candidates[0]??group.children.find(o=>o.geometry.type==='BoxGeometry');return {id:object.id,position:object.position.toArray(),group:group.id};`);
          const aim = [target.position[0], target.position[1], target.position[2] + 0.65];
          await pose(hand, aim);
          // Observe existing controllers, never replace application hit testing.
          await b.evaluate(`const e=window.firefoxScenes.find(e=>e.renderer?.xr?.isPresenting),s=window.firefoxSession,index=[...s.inputSources].findIndex(i=>i.handedness===arguments[0]);const controller=e.renderer.xr.getController(index);window.dragObservation={controller,group:e.scene.getObjectById(arguments[1])};`, [hand, target.group]);
          await b.panel(`document.querySelector('#'+arguments[0]+'SelectButton').click()`, [hand]);
          const selected: any = await eventually<any>(() => b!.evaluate<any>(`const d=window.dragObservation,o=d.controller.userData.selected;if(!o)return null;d.object=o;d.initial=o.matrixWorld.clone();d.controllerInitial=d.controller.matrixWorld.clone();return {id:o.id,parent:o.parent.id,controller:d.controller.id,world:o.matrixWorld.elements.slice(),geometry:o.geometry.type};`), Boolean, 'application selects existing object');
          assert.equal(selected.parent, selected.controller, 'selected object attaches to actual controller');
          const moved = [aim[0] + 0.18, aim[1] + 0.12, aim[2] - 0.1];
          await pose(hand, moved, 0.3);
          const held: any = await b.evaluate(`const d=window.dragObservation;const expected=d.controller.matrixWorld.clone().multiply(d.controllerInitial.clone().invert()).multiply(d.initial);return {id:d.object.id,parent:d.object.parent.id,world:d.object.matrixWorld.elements.slice(),expected:expected.elements.slice()};`);
          assert.equal(held.id, selected.id); assert.equal(held.parent, selected.controller);
          assert(matrixDifference(held.world, selected.world) > 0.05, 'held object changes world transform');
          closeMatrix(held.world, held.expected, 'held rigid transform follows translated/rotated controller');
          const heldScreenshot = await screenshot(`${cycle}-${hand}-held`);
          await b.panel(`document.querySelector('#'+arguments[0]+'SelectButton').click()`, [hand]);
          const released = await eventually(() => b!.evaluate<any>(`const d=window.dragObservation;return {id:d.object.id,parent:d.object.parent.id,group:d.group.id,cleared:d.controller.userData.selected===undefined,world:d.object.matrixWorld.elements.slice()};`), v => v?.cleared, 'application releases selected object');
          assert.equal(released.id, selected.id); assert.equal(released.parent, released.group, 'same object returns to original group');
          closeMatrix(released.world, held.world, 'release preserves held world transform');
          await pose(hand, [moved[0] - 0.3, moved[1] + 0.1, moved[2] + 0.2], -0.2);
          const stable = await b.evaluate(`return window.dragObservation.object.matrixWorld.elements.slice()`);
          closeMatrix(stable, released.world, 'released placement stable after later controller motion', 1e-5);
          c.drags.push({hand, target, aim, moved, selected, held, released, stable, heldScreenshot, pixels: await pixels()});
        }
        const events = (await current()).events;
        assert.deepEqual(events.map((e: any) => e.type + ':' + e.hand), ['right','left'].flatMap(hand => ['selectstart','select','selectend'].map(type => type + ':' + hand)));
        assert(events.every((e: any) => e.sameSource && e.pose?.length === 16), 'event identity and active event-frame poses');
      }
      c.lifetime = await b.evaluate(expression(trackingLifetime));
      assert(c.lifetime.identityChecks > 60);
      assert(c.lifetime.inactive.every((name: string) => name === 'InvalidStateError'));
      assert.deepEqual(c.lifetime.foreignSpace, ['InvalidStateError','InvalidStateError']);
      c.retiredUnchanged = await b.evaluate(`const a=window.trackingLive.find(v=>v.record.mode==='immersive-vr'&&v.session.ended);return !a||a.sources.every((v,i)=>!v.source.gamepad.connected&&JSON.stringify([v.source.gamepad.axes,v.source.gamepad.buttons,v.source.gamepad.timestamp])===a.finalPads[i]);`);
      assert(c.retiredUnchanged, 'new input never updates retired session gamepads');
      c.after = await current(); c.pixelsAfter = await pixels();
      assert(c.pixelsAfter.regions.every((r: any, i: number) => r.hash !== c.pixelsBefore.regions[i].hash), 'visible output changes in each eye');
      assert.deepEqual(c.after.views.map((v: any) => v.eye), ['left','right']);
      assert(c.after.views.every((v: any) => v.width > 0 && v.height > 0));
      c.screenshot = await screenshot(`${cycle}-completed`);
      const inlineBefore = await b.evaluate(`return window.tracking.sessions.find(s=>s.mode==='inline')?.frames`);
      await b.click('STOP|EXIT');
      await eventually(current, r => r.ends === 1, 'one application-driven end');
      const stopped = await current();
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal((await current()).frames, stopped.frames, 'ended immersive session has no callbacks');
      if (app === 'input-tracking') {
        const inline = await b.evaluate(`return window.tracking.sessions.find(s=>s.mode==='inline')`);
        assert(inline && inline.ends === 0 && inline.frames > inlineBefore, 'original separate inline session resumes');
        c.inlineResumed = {before: inlineBefore, after: inline.frames};
      }
      c.shutdown = {endEvents: stopped.ends, frames: stopped.frames, callbacksStopped: true};
      await save();
    }
    result.logs = b.logs.slice(logStart);
    assert.deepEqual(result.logs.filter((l: any) => l.level === 'error'), [], 'no application runtime errors');
    assert.deepEqual(await b.evaluate(`return window.tracking.failures`), []);
    if(app==='dragging')result.status='passed';
    await save();
  }
  report.extensionChecks = 'passed';
  report.status = 'blocked-upstream';
  process.exitCode = 1;
} catch (error) {
  report.status = 'failed'; report.failures.push(String(error));
  if (b) {report.diagnostic = await b.evaluate(`return {tracking:window.tracking,consumed:window.sampleConsumed,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent)}`).catch(String);report.logs = b.logs;}
  throw error;
} finally {
  try {await b?.close(); report.cleanup = b?.cleanup;} finally {server.close();}
  report.browserFetches = b?.network;
  report.externalAssets = [];
  for (const url of new Set<string>((b?.network ?? []).map((r: any)=>r.url).filter((url: string)=>url.startsWith('https://')))) {
    try {await upstream(url);report.externalAssets.push({url,...provenance.get(url),method:'separate source retrieval after observed browser fetch; original browser response metadata retained'});} catch(error) {report.externalAssets.push({url,failure:String(error)});}
  }
  report.provenance = [...provenance.values()];
  report.sources = {};
  for (const file of ['package.json','package-lock.json','tests/tracking.ts','tests/tracking-browser.ts','tests/tracking-observation.ts','tests/firefox-driver.ts','tests/firefox-upstream.ts','tests/firefox-scenes.js','src/polyfill/api/runtime.ts','src/polyfill/api/layers.ts','src/polyfill/EmulatedXRDevice.ts','src/polyfill/device-adapter.ts','polyfill/webxr-polyfill.js','build/firefox/polyfill/webxr-polyfill.js','dist/app/panel.js']) {
    report.sources[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  if (b && !Object.values(b.cleanup).every(Boolean)) {report.status='failed';report.failures.push('Incomplete owned browser cleanup');process.exitCode=1;}
  report.completedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({status: report.status, browser, scenarios: report.results.length, failures: report.failures}));
}
