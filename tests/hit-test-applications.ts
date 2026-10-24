import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {eventually} from './firefox-driver';
import {observeXR, applicationPixels, presentedPixels} from './firefox-observation';
import {panelPose} from './firefox-contract';
import type {Driver} from './plane-applications';

/** Observe successful values after the original operation; preserve its thrown
 * exception and return identity. No capability, request or app source rewrite. */
function observeHitTests() {
  const w = window as any;
  const probe: any = w.hitProbe = {frames: 0, sources: [] as any[], flowers: [] as any[], errors: [] as string[], last: null as any, reticle: null as any, select: null as any, placements: [] as any[]};
  const byResult = new WeakMap<object, any>();
  const request = w.XRSession.prototype.requestHitTestSource;
  w.XRSession.prototype.requestHitTestSource = function (...args: any[]) {
    const result: any = Reflect.apply(request, this, args) as Promise<any>;
    void result.then((source: any) => probe.sources.push({source, session: this, options: args[0]}), () => {});
    return result;
  };
  const hits = w.XRFrame.prototype.getHitTestResults;
  w.XRFrame.prototype.getHitTestResults = function (...args: any[]) {
    const result: any = Reflect.apply(hits, this, args);
    for (const hit of result) byResult.set(hit, {frame: this, source: args[0], first: result[0] === hit});
    return result;
  };
  const pose = w.XRHitTestResult.prototype.getPose;
  w.XRHitTestResult.prototype.getPose = function (...args: any[]) {
    const result: any = Reflect.apply(pose, this, args);
    try {
      const entry = byResult.get(this);
      if (result && entry?.first) {
        const {source, frame} = entry, space = args[0], m = space._update(), p = result.transform.position;
        const world = [0, 1, 2].map(i => m[i] * p.x + m[4 + i] * p.y + m[8 + i] * p.z + m[12 + i]);
        const b = source._space._update(), ray = source._offsetRay;
        const o = [0, 1, 2].map(i => b[i] * ray.origin.x + b[4 + i] * ray.origin.y + b[8 + i] * ray.origin.z + b[12 + i]);
        const d = [0, 1, 2].map(i => b[i] * ray.direction.x + b[4 + i] * ray.direction.y + b[8 + i] * ray.direction.z);
        // The direct source-mesh raycaster is independent of plane-region hits.
        const room = frame.session._device.arScene.getHitTestResults(o, d)[0];
        probe.last = {local: [p.x, p.y, p.z], world, room: room?.point.toArray(), normal: room?.normal.toArray(), viewer: w.firefoxViewer, error: room ? Math.hypot(...world.map((v, i) => v - room.point.toArray()[i])) : null};
        w.hitReference = space;
      }
    } catch (error) { probe.errors.push(String(error)); }
    return result;
  };
  const raf = w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame = function (callback: any) {
    return Reflect.apply(raf, this, [function (this: any, ...args: any[]) {
      const result: any = Reflect.apply(callback, this, args);
      try {
        if (!probe.last || args[1].session._mode !== 'immersive-ar') return result;
        probe.frames++;
        const scene = w.firefoxScenes?.find((e: any) => e.scene.children.some((o: any) => o.geometry?.type === 'RingGeometry'))?.scene;
        const ring = scene?.children.find((o: any) => o.geometry?.type === 'RingGeometry');
        const sample = probe.sampleScene?.children.find((o: any) => o._url?.includes('reticle'));
        const reticle = ring ?? sample;
        probe.reticle = reticle?.visible ? Array.from((reticle.matrix.elements ?? reticle.matrix) as ArrayLike<number>).slice(12, 15) : null;
        const objects = scene ? scene.children.filter((o: any) => o.geometry?.type === 'CylinderGeometry') : probe.flowers;
        probe.placements = objects.map((o: any) => ({position: Array.from((o.matrix.elements ?? o.matrix) as ArrayLike<number>).slice(12, 15), visible: o.visible, renderables: o.children?.length ?? 0}));
      } catch (error) { probe.errors.push(String(error)); }
      return result;
    }]);
  };
  const original = w.navigator.xr.requestSession;
  w.navigator.xr.requestSession = function (...args: any[]) {
    const result: any = Reflect.apply(original, this, args) as Promise<any>;
    void result.then((s: any) => s.addEventListener('select', () => { probe.select = {last: probe.last, reticle: probe.reticle}; }), () => {});
    return result;
  };
}

async function observeTransient() {
  const w = window as any, session = w.firefoxSession;
  const child = document.createElement('iframe'); child.src = '/frame'; child.style.cssText='position:fixed;bottom:0;left:0;width:1px;height:1px;pointer-events:none';
  const ready = new Promise<void>(resolve => { child.onload = () => resolve(); }); document.body.append(child); await ready;
  const other = child.contentWindow as any;
  const source = await session.requestHitTestSourceForTransientInput({profile: {toString: () => 'generic-touchscreen'}});
  const unmatched = await session.requestHitTestSourceForTransientInput({profile: 'unmatched-profile'});
  const t = w.hitTouch = {trace: [] as any[], errors: [] as string[], assertions: 0, running: true, cancelNext: false, cancelled: false, laterInvalid: 0, retained: null as any, source, unmatched};
  const identities = new WeakMap<object, number>(); let next = 0;
  function check(v: unknown, label: string) { if (!v) throw new Error(label); t.assertions++; }
  const callback = (_time: number, f: any) => {
    try {
      check(f.getHitTestResultsForTransientInput(unmatched).length === 0, 'unmatched profiles have no groups');
      if (t.cancelled) {
        let error: any; try { f.getHitTestResultsForTransientInput(source); } catch (e) { error = e; }
        check(error?.name === 'InvalidStateError', 'later cancelled transient map missing'); t.laterInvalid++;
      } else {
        const groups = f.getHitTestResultsForTransientInput(source), group = groups[0];
        const item: any = {groups: groups.length, inputs: session.inputSources.length};
        if (group) {
          const input = group.inputSource;
          if (!identities.has(input)) identities.set(input, ++next);
          item.id = identities.get(input); item.hits = group.results.length;
          const pose = group.results[0]?.getPose(w.hitReference); item.point = pose && Array.from(pose.transform.matrix).slice(12, 15);
          check(Array.from(session.inputSources).includes(input) && input.profiles.includes('generic-touchscreen'), 'group retains associated actual input');
          check(group.results === group.results && Object.isFrozen(group.results), 'transient FrozenArray identity');
          const registry = w[Symbol.for('WebXR-emulator.interface-brands')], retained = registry.transientHitResults.get(group);
          check(Object.isFrozen(registry.transientHitResults) && !registry.transientHitResults.set && Object.isFrozen(retained), 'page cannot write transient result registry');
          check(!Reflect.set(retained, 'inputSource', {}) && !Reflect.set(retained, 'results', []), 'page cannot replace retained transient data');
          let forged: any; try { registry.transientHitResults.set(new Proxy(group, {}), {inputSource: {}, results: []}); } catch (e) { forged = e; }
          check(forged?.name === 'TypeError', 'page cannot forge transient group registration');
          for (const realm of [w, other]) for (const name of ['inputSource', 'results']) {
            const d = Object.getOwnPropertyDescriptor(realm.XRTransientInputHitTestResult.prototype, name)!;
            check(d.get!.call(group) === group[name] && !d.set && d.enumerable && d.configurable, 'cross-realm readonly transient accessor');
            for (const bad of [null, {}, Object.create(realm.XRTransientInputHitTestResult.prototype), new Proxy(group, {})]) {
              let error: any; try { d.get!.call(bad); } catch (e) { error = e; } check(error?.name === 'TypeError', 'transient accessor brand');
            }
          }
          let error: any; try { group.results.push({}); } catch (e) { error = e; } check(error?.name === 'TypeError', 'results reject writes');
          groups.length = 0; check(f.getHitTestResultsForTransientInput(source)[0] === group, 'transient outer sequence cannot alter frame map');
          t.retained = {group, input, results: group.results};
          if (t.cancelNext) {
            other.XRTransientInputHitTestSource.prototype.cancel.call(source);
            check(f.getHitTestResultsForTransientInput(source)[0] === group, 'cancellation preserves computed transient group');
            let error: any; try { source.cancel(); } catch (e) { error = e; } check(error?.name === 'InvalidStateError', 'repeated transient cancellation');
            t.cancelled = true;
          }
        }
        t.trace.push(item);
      }
      if (t.retained) check(t.retained.group.inputSource === t.retained.input && t.retained.group.results === t.retained.results && Object.isFrozen(t.retained.results), 'retained transient data stable through release');
    } catch (e) { t.errors.push(String(e)); }
    if (t.running && !session.ended) session.requestAnimationFrame(callback);
  };
  session.requestAnimationFrame(callback);
}

export async function runHitTestApplications(driver: Driver) {
  const results: any[] = [];
  await mkdir('test-results', {recursive: true});
  for (const [profile, device] of [['quest', 'Meta Quest 3'], ['android', 'Generic Android Phone (ARCore)']]) for (const app of ['sample', 'three']) {
    if (process.env.WEBXR_HIT_TEST_APP && process.env.WEBXR_HIT_TEST_APP !== `${profile}:${app}`) continue;
    console.log('hit-test application', driver.browser, profile, app);
    await driver.configure(device);
    await driver.panel(panelPose, [[0.3, 1.7, 0], [0, 1.6, 0], -0.15]);
    await driver.panel(panelPose, [[0, 1.6, 0], [0, 1.6, 0], -0.15]);
    if (profile === 'android') await driver.panel(`window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0,1.6,-0.075);c.object.rotation.x=-0.15;c.dispatchEvent({type:'change'});});`);
    await driver.navigate(driver.origin + (app === 'sample' ? '/samples/hit-test.html' : '/three/examples/webxr_ar_hittest.html'));
    await eventually(() => driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`), Boolean, 'pinned hit-test entry', 60000);
    await driver.evaluate(`const __name=value=>value;(${observeXR.toString()})();(${observeHitTests.toString()})();`);
    if (app === 'sample') {
      await driver.evaluate(`const s=document.createElement('script');s.type='module';s.src='/hit-test-sample-observer.js';document.body.append(s);`);
      await eventually(() => driver.evaluate('return window.hitSampleObserverReady'), Boolean, 'original sample module observer');
    }
    await driver.clickEntry();
    await eventually(() => driver.evaluate('return {frames:window.hitProbe.frames,reticle:window.hitProbe.reticle,last:window.hitProbe.last,errors:window.hitProbe.errors}'), v => v.frames >= 30 && v.reticle && v.last?.room, 'visible hit-test reticle', 60000);
    const snapshot = () => driver.evaluate(`const p=window.hitProbe;return {frames:p.frames,last:p.last,reticle:p.reticle,placements:p.placements,select:p.select,errors:p.errors};`);
    const before = await snapshot(); assert.deepEqual(before.errors, []); assert(before.last.error < 1e-4);
    assert(Math.hypot(...before.reticle.map((v: number, i: number) => v - before.last.local[i])) < 1e-4, 'reticle matches actual hit pose');
    const start = before.frames;
    assert.equal(await driver.panel(panelPose, [[0, 1.6, 0], [0.3, 1.7, 0], -0.3]), 1);
    if (profile === 'android') assert.equal(await driver.panel(`let n=0;window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0.3,1.7,-0.075);c.object.rotation.x=-0.3;c.dispatchEvent({type:'change'});n++;});return n;`), 1);
    await eventually(snapshot, v => v.frames > start + 20 && Math.hypot(...v.last.world.map((n: number, i: number) => n - before.last.world[i])) > 0.05, 'panel movement moves measured reticle');
    const moved = await snapshot(); assert(moved.last.error < 1e-4); assert(Math.hypot(...moved.reticle.map((v: number, i: number) => v - moved.last.local[i])) < 1e-4);
    const captures: string[] = [];
    async function capture(label: string) { const file = `test-results/hit-test-${driver.browser}-${profile}-${app}-${label}.png`; await writeFile(file, await driver.screenshot()); captures.push(file); }
    await capture('reticle');
    async function phonePoint(u = 0.5, v = 0.5) { return driver.evaluate<{x: number; y: number}>(`let result;for(const e of window.firefoxScenes){if(!e.renderer)continue;e.scene.traverse(o=>{if(o.material?.customProgramCacheKey()!=='ar-screen-composite-v1')return;o.geometry.computeBoundingBox();const box=o.geometry.boundingBox,p=e.camera.position.clone().set(box.min.x+(box.max.x-box.min.x)*arguments[0],box.min.y+(box.max.y-box.min.y)*arguments[1],0);o.localToWorld(p).project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();result={x:Math.round(r.left+(p.x+1)*r.width/2),y:Math.round(r.top+(1-p.y)*r.height/2)};});}return result;`, [u, v]); }
    if (profile === 'quest') {
      await driver.panel(`document.querySelector('#rightSelectButton').click()`);
      await eventually(() => driver.evaluate('return window.firefoxXR.events'), v => v.includes('selectstart'), 'genuine panel press');
      await driver.panel(`document.querySelector('#rightSelectButton').click()`);
    } else { const p = await phonePoint(); assert(p); await driver.phoneSelect(p); }
    await eventually(snapshot, v => v.placements.some((p: any) => p.visible) && v.select?.reticle, 'visible original placed object');
    const placement = await snapshot();
    assert(placement.placements.some((p: any) => p.visible && Math.hypot(...p.position.map((v: number, i: number) => v - placement.select.reticle[i])) < 1e-4), 'placed object matches reticle at actual selection');
    assert(placement.select.last.error < 1e-4, 'selected placement independently matches room mesh intersection');
    if (profile === 'android') {
      // Actual phone control clicks cycle translate -> rotate -> disabled,
      // removing the editor gizmo that can cover the application's reticle.
      const controlPoint = await phonePoint(0.3, 0.65);
      await driver.phoneSelect(controlPoint, undefined, 'left');
      await driver.phoneSelect(controlPoint, undefined, 'left');
    }
    await capture('placed');
    const pixels = await driver.evaluate(`return (${applicationPixels.toString()})()`);
    assert.equal(pixels.regions.length, profile === 'quest' ? 2 : 1);
    for (const eye of pixels.regions) assert(eye.colored > 100 && eye.colors > 5 && eye.transparent > 0, 'visible object pixels with transparent AR environment');
    const presented = await driver.evaluate(`const __name=value=>value;return (${presentedPixels.toString()})()`);
    await writeFile(`test-results/hit-test-${driver.browser}-${profile}-${app}-pixels.json`,JSON.stringify({pixels,presented,placement},null,2));
    for (const eye of presented) {
      if (profile === 'quest') assert(eye.difference <= 2, 'application pixels reach each stereo eye');
      else assert(eye.foregroundContrast >= 12 && eye.correlation > 0, 'application object pixels reach phone screen');
      assert(eye.room[3] === 255 && eye.room.slice(0, 3).some((v: number) => v > 30), 'transparent app pixels show room');
    }
    const texture = await driver.evaluate(`const s=window.firefoxSession,l=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation;return l._presentationCanvas.toDataURL()`);
    const textureFile = `test-results/hit-test-${driver.browser}-${profile}-${app}-application.png`; await writeFile(textureFile, Buffer.from(texture.replace(/^data:image\/png;base64,/, ''), 'base64')); captures.push(textureFile);
    let transient: any = null;
    if (profile === 'android') {
      await driver.evaluate(`const __name=value=>value;return (${observeTransient.toString()})()`);
      await eventually(() => driver.evaluate('return window.hitTouch.trace'), v => v.length > 3 && v.every((r: any) => r.groups === 0), 'no transient groups before press');
      const p = await phonePoint(0.4, 0.5), q = await phonePoint(0.6, 0.5);
      console.log('touch targets',JSON.stringify(await driver.evaluate('return arguments[0].map(p=>({point:p,target:document.elementFromPoint(p.x,p.y)?.tagName,rect:document.elementFromPoint(p.x,p.y)?.getBoundingClientRect().toJSON()}));',[[p,q]])));
      await capture('touch-setup');
      await driver.phoneSelect(p, q);
      await eventually(() => driver.evaluate('const t=window.hitTouch;return {count:t.trace.length,active:t.trace.filter(r=>r.groups>0).length,last:t.trace.at(-1),errors:t.errors.slice(0,3)};'), v => v.active > 0 && v.last?.groups === 0, 'touch release removes groups');
      const first = await driver.evaluate('return window.hitTouch.trace.filter(r=>r.groups>0)');
      assert(first.every((r: any) => r.hits > 0));
      assert(first.some((r: any) => Math.hypot(...r.point.map((n: number, i: number) => n - first[0].point[i])) > 0.01), 'moving touchscreen ray changes hit point');
      await driver.phoneSelect(p);
      await eventually(() => driver.evaluate('return window.hitTouch.trace'), v => v.some((r: any) => r.id > first[0].id) && v.at(-1)?.groups === 0, 'reacquisition supplies fresh group input identity');
      await driver.evaluate('window.hitTouch.cancelNext=true'); await driver.phoneSelect(p);
      await eventually(() => driver.evaluate('return window.hitTouch.laterInvalid'), v => v > 2, 'cancellation later frame missing');
      transient = await driver.evaluate('const t=window.hitTouch;t.running=false;t.unmatched.cancel();return {trace:t.trace,errors:t.errors,assertions:t.assertions,cancelled:t.cancelled,laterInvalid:t.laterInvalid};');
      assert.deepEqual(transient.errors, []); assert(transient.cancelled);
    }
    const state = await driver.evaluate(`const s=window.firefoxSession;window.hitOld=s;window.hitOldSources=window.hitProbe.sources.filter(r=>r.session===s).map(r=>r.source);window.hitOldLayer=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation;return {requests:window.firefoxXR.requests.map(([mode,o])=>({mode,requiredFeatures:o?.requiredFeatures,optionalFeatures:o?.optionalFeatures})),enabled:[...s.enabledFeatures],views:window.firefoxXR.views,frames:window.firefoxXR.frames,sourceCount:s._hitSources.size};`);
    assert(state.requests.every((r: any) => r.requiredFeatures.includes('hit-test'))); assert(state.enabled.includes('hit-test'));
    assert.deepEqual(state.views.map((v: any) => v.eye), profile === 'quest' ? ['left', 'right'] : ['none']);
    await driver.evaluate('return window.firefoxSession.end()');
    const stopped = await driver.evaluate('return window.firefoxXR.frames');
    const shutdown = await eventually(() => driver.evaluate(`const s=window.hitOld,d=s._device;return {frames:window.firefoxXR.frames,ends:window.firefoxXR.ends,sources:s._hitSources.size,transient:s._transientSources.size,backend:d.hitTestSources.length+d.hitTestSourcesForTransientInput.length,maps:d.hitTestResults.size+d.hitTestResultsForTransientInput.size,callbacks:s.callbacks.size,layers:s._webglLayers.size,connected:window.hitOldLayer._presentationCanvas.isConnected}`), v => v.ends === 1, 'end notification');
    assert.equal(shutdown.frames, stopped); for (const name of ['sources', 'transient', 'backend', 'maps', 'callbacks', 'layers']) assert.equal(shutdown[name], 0); assert(!shutdown.connected);
    await eventually(() => driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`), Boolean, 'unchanged application restart entry');
    await driver.clickEntry();
    await eventually(() => driver.evaluate('return {frames:window.firefoxXR.frames,session:window.firefoxSession!==window.hitOld,reticle:window.hitProbe.reticle,sources:window.hitProbe.sources.filter(r=>r.session===window.firefoxSession).length}'), v => v.frames > stopped + 30 && v.session && v.reticle && v.sources > 0, 'fresh restarted application hit-test reticle', 60000);
    const restart = await driver.evaluate(`const s=window.firefoxSession;return {fresh:s!==window.hitOld,oldAbsent:window.hitOldSources.every(r=>!s._hitSources.has(r)),freshInputs:[...s.inputSources].every(i=>!i.gamepad||i.gamepad.buttons.every(b=>!b.pressed)),last:window.hitProbe.last,reticle:window.hitProbe.reticle,errors:window.hitProbe.errors}`);
    assert(restart.fresh && restart.oldAbsent && restart.freshInputs && restart.last.error < 1e-4); assert.deepEqual(restart.errors, []); await capture('restart');
    await driver.evaluate('return window.firefoxSession.end()');
    const cleanup = await eventually(() => driver.evaluate(`const s=window.firefoxSession,d=s._device;return {ends:window.firefoxXR.ends,backend:d.hitTestSources.length+d.hitTestSourcesForTransientInput.length,maps:d.hitTestResults.size+d.hitTestResultsForTransientInput.size,callbacks:s.callbacks.size,layers:s._webglLayers.size}`), v => v.ends === 2, 'final end notification');
    for (const name of ['backend', 'maps', 'callbacks', 'layers']) assert.equal(cleanup[name], 0);
    const dependencies = await driver.evaluate(`return Promise.all([...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(url=>url.startsWith('https://cdn.jsdelivr.net/')||url.startsWith('https://fonts.gstatic.com/')))].map(async url=>{const response=await fetch(url,{cache:'force-cache'}),bytes=await response.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);return {url,status:response.status,bytes:bytes.byteLength,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),evidence:'browser force-cache reread of dependency requested by the unchanged pinned application'};}));`);
    results.push({profile, device, app, dependencies, before, moved, placement, pixels, presented, transient, state, shutdown, restart, cleanup, captures});
    await writeFile(`test-results/hit-test-applications-${driver.browser}-progress.json`, JSON.stringify(results, null, 2));
  }
  return results;
}
