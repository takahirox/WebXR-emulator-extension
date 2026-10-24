import type {SessionMode} from '../src/types/contracts';

/** Pinned WPT ray bodies run unchanged in injected frames. Subscription tests
 * adapt fake-device setup to the genuine extension and its simulated room. */
export async function hitTestCases(mode: SessionMode) {
  const w = window as any, passed: string[] = [], measurements: any[] = [], sessions: any[] = [];
  function check(value: unknown, label: string) { if (!value) throw new Error(`${mode}: ${label}`); passed.push(label); }
  function throws(fn: () => unknown, name: string, label: string) { let error: any; try { fn(); } catch (e) { error = e; } check(error?.name === name, label + (error ? ` (${error.name})` : '')); }
  async function rejects(p: Promise<unknown>, name: string, label: string) { check(Object.prototype.toString.call(p) === '[object Promise]', 'binding returns Promise'); let error: any; try { await p; } catch (e) { error = e; } check(error?.name === name, label + ` (${error?.name})`); }
  function request(options: any) { return new Promise<any>((resolve, reject) => {
    const b = document.createElement('button'); b.id = 'reference-space-session'; b.textContent = 'Start hit-test contract'; b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick = () => { b.remove(); w.navigator.xr.requestSession(mode, options).then(resolve, reject); }; document.body.append(b);
  }); }
  const frame = (s: any, fn: (f: any) => any) => new Promise<any>((resolve, reject) => s.requestAnimationFrame((_t: number, f: any) => { try { resolve(fn(f)); } catch (e) { reject(e); } }));
  async function layer(s: any, realm = w) { const c = realm.document.createElement('canvas'), gl = c.getContext('webgl2'); await gl.makeXRCompatible(); s.updateRenderState({baseLayer: new realm.XRWebGLLayer(s, gl)}); }
  const child = document.createElement('iframe'); child.src = '/frame';
  const ready = new Promise<void>(resolve => { child.onload = () => resolve(); }); document.body.append(child); await ready;
  const other = child.contentWindow as any;
  try {
    // Upstream testharness, assertions and constructor/matrix bodies are unchanged.
    for (const name of ['xrRay_constructor', 'xrRay_matrix']) {
      const test = document.createElement('iframe'); test.src = `/wpt/webxr/hit-test/${name}.https.html`; document.body.append(test);
      const deadline = Date.now() + 20000;
      while (!(test.contentWindow as any)?.wptResults) { if (Date.now() > deadline) throw new Error('WPT timeout ' + name); await new Promise(r => setTimeout(r, 20)); }
      const result = (test.contentWindow as any).wptResults;
      check(result.status === 0 && result.tests.length > 0 && result.tests.every((t: any) => t.status === 0), `unchanged pinned WPT ${name}: ${JSON.stringify(result)}`);
      measurements.push({wpt: name, result}); test.remove();
    }
    const registry = w[Symbol.for('WebXR-emulator.interface-brands')];
    for (const name of ['rays', 'hitSources', 'transientHitSources', 'hitResults', 'transientHitResults']) {
      check(Object.isFrozen(registry[name]) && !registry[name].set && !registry[name].delete && !registry[name].clear, 'shared ' + name + ' registry has no writers');
      check(!Reflect.set(registry[name], 'set', () => {}), 'page cannot install registry writer');
    }
    for (const realm of [w, other]) {
      for (const name of ['XRHitTestSource', 'XRTransientInputHitTestSource', 'XRHitTestResult', 'XRTransientInputHitTestResult']) {
        throws(() => new realm[name](), 'TypeError', `${name} illegal constructor`); check(realm[name].length === 0, 'nonconstructible interface length');
        check(Object.getOwnPropertyDescriptor(realm[name].prototype, Symbol.toStringTag)?.value === name, 'IDL interface prototype tag');
        throws(() => new realm[name]({}, {}, {}), 'TypeError', 'constructor rejects caller-supplied arguments');
        const names = name.endsWith('Source') ? ['cancel'] : name === 'XRHitTestResult' ? ['getPose', 'createAnchor'] : [];
        for (const member of names) {
          const d = Object.getOwnPropertyDescriptor(realm[name].prototype, member)!;
          check(d.enumerable && d.configurable && d.writable && typeof d.value === 'function', 'IDL operation descriptor');
        }
      }
      const log: string[] = [];
      const origin = Object.create(Object.fromEntries(['w', 'x', 'y', 'z'].map((k, i) => [k, {valueOf() { log.push('convert-' + k); return i === 0 ? 1 : i; }}])));
      const dict = new Proxy(origin, {get(o, k) { log.push('get-' + String(k)); return Reflect.get(o, k); }});
      const ray = new realm.XRRay(dict, {x: '3', y: null, z: '-4'});
      check(log.join(',') === 'get-w,convert-w,get-x,convert-x,get-y,convert-y,get-z,convert-z', 'inherited ray members convert once in IDL order');
      check(Object.prototype.toString.call(ray) === '[object XRRay]', 'ray interface tag');
      check(ray.origin.x === 1 && Math.abs(ray.direction.x - 0.6) < 1e-12 && Math.abs(ray.direction.z + 0.8) < 1e-12, 'ray numeric coercion and normalization');
      check(new realm.XRRay(null, null).direction.z === -1, 'null dictionaries use defaults');
      check(new realm.XRRay({x: null}).origin.x === 0, 'null numeric member converts to zero');
      check(Number.isNaN(new realm.XRRay({x: NaN}).origin.x) && new realm.XRRay({x: Infinity}).origin.x === Infinity, 'unrestricted origin permits nonfinite coordinates');
      for (const bad of [42, 'x', true, Symbol(), BigInt(1)]) throws(() => new realm.XRRay(bad), 'TypeError', 'primitive origin dictionary rejected');
      for (const bad of [Infinity, NaN, BigInt(1), Symbol()]) throws(() => new realm.XRRay({}, {x: bad}), 'TypeError', 'restricted direction numeric conversion');
      for (const args of [[{w: 0}], [{}, {w: 1}], [{}, {x: 0, y: 0, z: 0}], [{w: null}]]) throws(() => new realm.XRRay(...args), 'TypeError', 'ray homogeneous and zero direction validation');
      const huge = new realm.XRRay({}, {x: 1e308, y: 1e308, z: 1e308});
      check(Math.abs(Math.hypot(huge.direction.x, huge.direction.y, huge.direction.z) - 1) < 1e-12, 'large finite direction normalizes');
      for (const d of [{x: 0, z: 1}, {x: 1, z: 0}, {x: 1, y: 2, z: -3}, {x: 1e-7, z: 1}, {x: -1e-7, z: 1}, {y: 1e-7, z: 1}, {x: 1e-12, z: 1}, {x: 1e-12, z: -1}, {y: -1e-12, z: -1}]) {
        const r = new realm.XRRay({x: 2, y: 3, z: 4}, d), m = r.matrix;
        check([r.direction.x, r.direction.y, r.direction.z].every((v, i) => Math.abs(v + m[8 + i]) < Math.max(1e-12, Math.abs(v) * 1e-6)) && m[12] === 2, 'translated rotated/opposite ray matrix');
        check(r.origin === r.origin && r.direction === r.direction && r.matrix === m, 'readonly point and cached matrix identity');
        m[12] = 999; const point = r.origin;
        check(point.x === 2 && r.matrix === m, 'exported matrix writes preserve ray geometry');
        structuredClone(m, {transfer: [m.buffer]});
        check(m.byteLength === 0 && r.matrix !== m && r.matrix[12] === 2 && r.origin === point, 'detached matrix regenerated from retained geometry');
        check([r.direction.x, r.direction.y, r.direction.z].every((v, i) => Math.abs(v + r.matrix[8 + i]) < Math.max(1e-12, Math.abs(v) * 1e-6)), 'regenerated matrix represents near-opposite and near-forward directions');
        const retained = registry.rays.get(r), proxy = new Proxy(r, {});
        check(Object.isFrozen(retained) && !Reflect.set(retained, 'direction', new DOMPointReadOnly(0, 0, 1, 0)), 'page cannot alter retained ray state');
        throws(() => registry.rays.set(proxy, retained), 'TypeError', 'page cannot copy a ray brand onto a proxy');
        for (const key of ['origin', 'direction', 'matrix']) {
          const descriptor = Object.getOwnPropertyDescriptor(realm.XRRay.prototype, key)!;
          check(descriptor.enumerable && descriptor.configurable && !descriptor.set, 'ray readonly enumerable accessor');
          for (const bad of [null, {}, Object.create(realm.XRRay.prototype), new Proxy(r, {})]) throws(() => descriptor.get!.call(bad), 'TypeError', 'ray getter brand');
          check(Object.getOwnPropertyDescriptor((realm === w ? other : w).XRRay.prototype, key)!.get!.call(r) === r[key], 'cross-realm borrowed ray getter');
        }
      }
      const t = new other.XRRigidTransform({x: 2, y: 3, z: 4}, {y: 1, w: 0}); t.matrix.fill(99);
      const r = new realm.XRRay(t);
      check(r.origin.x === 2 && Math.abs(r.direction.z - 1) < 1e-12, 'cross-realm transform overload uses private geometry');
      check(new realm.XRRay(t, {}).origin.x === 0, 'two-argument overload converts transform as a dictionary');
    }
    for (const name of ['requestHitTestSource', 'requestHitTestSourceForTransientInput']) for (const bad of [null, {}, Object.create(w.XRSession.prototype)]) await rejects(w.XRSession.prototype[name].call(bad, {}), 'TypeError', 'session receiver brand');
    const peer = await other.navigator.xr.requestSession('inline'); sessions.push(peer); await layer(peer, other);
    const foreignSpace = await peer.requestReferenceSpace('viewer');
    if (mode !== 'immersive-ar') {
      await rejects(request({requiredFeatures: ['hit-test']}), 'NotSupportedError', 'policy rejects required hit-test in VR/inline');
      const session = await request({optionalFeatures: ['hit-test']}); sessions.push(session); await layer(session);
      const space = await session.requestReferenceSpace('viewer');
      check(!session.enabledFeatures.includes('hit-test'), 'policy omits optional hit-test');
      await rejects(session.requestHitTestSource({space: {}}), 'TypeError', 'conversion precedes absent feature');
      await rejects(session.requestHitTestSource({space}), 'NotSupportedError', 'converted absent feature');
      await session.end();
      await rejects(session.requestHitTestSource({space: {}}), 'TypeError', 'conversion precedes ended unenabled state');
      await rejects(session.requestHitTestSource({space}), 'NotSupportedError', 'absent feature precedes ended state');
      await rejects(session.requestHitTestSourceForTransientInput({profile: 'generic-touchscreen'}), 'NotSupportedError', 'transient absent feature precedes ended');
      return {mode, assertions: passed.length, passed, measurements};
    }
    const session = await request({requiredFeatures: ['hit-test', 'anchors']}); sessions.push(session); await layer(session);
    const viewer = await session.requestReferenceSpace('viewer'), reference = await session.requestReferenceSpace('local');
    const shifted = reference.getOffsetReferenceSpace(new w.XRRigidTransform({x: 1, y: 2, z: 3}));
    for (const bad of [undefined, null, {}, 42, {space: {}}, {space: Object.create(w.XRSpace.prototype)}, {space: new Proxy(viewer, {})}, {space: viewer, entityTypes: null}, {space: viewer, entityTypes: 'plane'}, {space: viewer, entityTypes: ['wrong']}, {space: viewer, entityTypes: [Symbol()]}, {space: viewer, offsetRay: {}}, {space: viewer, offsetRay: null}, {space: viewer, offsetRay: new Proxy(new w.XRRay(), {})}]) await rejects(session.requestHitTestSource(bad), 'TypeError', 'persistent invalid dictionary/member');
    for (const bad of [undefined, null, {}, 42, {profile: Symbol()}, {profile: 'x', entityTypes: null}, {profile: 'x', offsetRay: {}}]) await rejects(session.requestHitTestSourceForTransientInput(bad), 'TypeError', 'transient invalid dictionary/member');
    check(session._hitSources.size === 0 && session._transientSources.size === 0, 'failed conversion installs no subscriptions');
    for (const bad of [new Proxy(session, {}), Object.create(session)]) await rejects(w.XRSession.prototype.requestHitTestSource.call(bad, {space: viewer}), 'TypeError', 'proxied/forged session rejected');
    await rejects(session.requestHitTestSource({space: foreignSpace}), 'InvalidStateError', 'emulator policy rejects foreign subscription space');
    const log: string[] = []; let iterators = 0, nextReads = 0, closes = 0;
    const iterable = { [Symbol.iterator]() { iterators++; let n = 0; return {get next() { nextReads++; return () => n++ === 0 ? {done: false, value: {toString() { log.push('enum'); return 'plane'; }}} : {done: true}; }, return() { closes++; return {}; }}; }};
    const options = Object.create({get entityTypes() { log.push('entityTypes'); return iterable; }, get offsetRay() { log.push('offsetRay'); return new other.XRRay(); }, get space() { log.push('space'); return viewer; }});
    const inherited = await other.XRSession.prototype.requestHitTestSource.call(session, options);
    check(iterators === 1 && nextReads === 1 && closes === 0 && log.join(',') === 'entityTypes,enum,offsetRay,space', 'one-shot inherited options in IDL order');
    let closeOnFailure = 0, advances = 0;
    const brokenSequence = {[Symbol.iterator]() { return {next() { advances++; return {done: false, value: 'bad-enum'}; }, return() { closeOnFailure++; return {}; }}; }};
    await rejects(session.requestHitTestSource({space: viewer, entityTypes: brokenSequence}), 'TypeError', 'invalid iterable enum');
    check(advances === 1 && closeOnFailure === 0, 'WebIDL conversion stops without IteratorClose');
    const transientLog: string[] = [];
    const transient = await session.requestHitTestSourceForTransientInput({get entityTypes() { transientLog.push('entityTypes'); return []; }, get offsetRay() { transientLog.push('offsetRay'); return new other.XRRay(); }, get profile() { transientLog.push('profile'); return {toString() { transientLog.push('DOMString'); return 'generic-touchscreen'; }}; }});
    check(transientLog.join(',') === 'entityTypes,offsetRay,profile,DOMString', 'transient DOMString conversion order');
    const nullProfile = await session.requestHitTestSourceForTransientInput({profile: null}); check(nullProfile._profile === 'null', 'null profile is DOMString null'); nullProfile.cancel();
    const mutable = ['plane'], ray = new other.XRRay();
    const source = await session.requestHitTestSource({space: viewer, entityTypes: mutable, offsetRay: ray}); mutable.length = 0; ray.matrix.fill(999);
    for (const [name, genuine] of [['hitSources', source], ['transientHitSources', transient]] as const) {
      const retained = registry[name].get(genuine);
      check(Object.isFrozen(retained) && Object.isFrozen(retained.entityTypes), 'retained source record and entity snapshot frozen');
      check(!Reflect.set(retained, 'active', false) && !Reflect.set(retained, 'offsetRay', new w.XRRay()), 'page cannot alter retained subscription data');
      throws(() => registry[name].set(new Proxy(genuine, {}), retained), 'TypeError', 'page cannot copy source brands');
    }
    const defaults = await session.requestHitTestSource({space: viewer});
    const crossSpace = new other.XRSpace(session, () => viewer._update());
    const crossSpaceSource = await session.requestHitTestSource({space: crossSpace});
    const crossBase = new other.XRSpace(session, () => reference._update());
    const mesh = await session.requestHitTestSource({space: viewer, entityTypes: ['mesh']});
    const mixed = await session.requestHitTestSource({space: viewer, entityTypes: ['point', 'plane', 'mesh']});
    const empty = await session.requestHitTestSource({space: viewer, entityTypes: []});
    const points = await session.requestHitTestSource({space: viewer, entityTypes: ['point']});
    const offsetSource = await session.requestHitTestSource({space: viewer, offsetRay: new w.XRRay({x: 0.25}, {y: -0.1})});
    const referenceOffsetSource = await session.requestHitTestSource({space: shifted, offsetRay: new w.XRRay({x: -1, y: -0.4, z: -3})});
    const miss = await session.requestHitTestSource({space: reference, offsetRay: new w.XRRay({x: 1e4, y: 1e4, z: 1e4})});
    const deadline = Date.now() + 20000; while (!session._device.arScene?.room) { if (Date.now() > deadline) throw new Error('room timeout'); await new Promise(r => setTimeout(r, 20)); }
    const first = await frame(session, f => {
      const hits = f.getHitTestResults(source), plain = f.getHitTestResults(defaults), meshes = f.getHitTestResults(mesh);
      check(hits.length > 0 && hits.length === plain.length && f.getHitTestResults(inherited).length === plain.length, 'default plane and retained iterable snapshots');
      check(f.getHitTestResults(crossSpaceSource).length === plain.length && !!hits[0].getPose(crossBase), 'genuine separately allocated same-session space arguments');
      check(meshes.length > 0 && f.getHitTestResults(mixed).length === meshes.length + plain.length, 'mixed retains both independently computed representations alongside point');
      check(f.getHitTestResults(points).length === 0 && f.getHitTestResults(empty).length === 0 && f.getHitTestResults(miss).length === 0, 'point without data, empty and misses return no hits');
      check(f.getHitTestResultsForTransientInput(transient).length === 0, 'transient no active matching input');
      const matrices = hits.map((h: any) => Array.from(h.getPose(reference).transform.matrix) as number[]);
      const base = viewer._update(), origin = [base[12], base[13], base[14]], referenceWorld = reference._update();
      const worldPoints = matrices.map((m: number[]) => [0, 1, 2].map(i => referenceWorld[i] * m[12] + referenceWorld[4+i] * m[13] + referenceWorld[8+i] * m[14] + referenceWorld[12+i]));
      const distances = worldPoints.map((p: number[]) => Math.hypot(...p.map((v, i) => v - origin[i])));
      check(distances.every((d: number, i: number) => !i || d >= distances[i - 1] - 1e-5), 'persistent nearest-first results');
      const original = session._device.arScene.getHitTestResults(origin, [-base[8], -base[9], -base[10]])[0];
      check(original && Math.hypot(...worldPoints[0].map((v: number, i: number) => v - original.point.toArray()[i])) < 1e-4, `plane point matches independent source mesh raycast: ${JSON.stringify({plane:worldPoints[0],mesh:original?.point.toArray()})}`);
      check(original.normal.toArray().every((v: number, i: number) => Math.abs(v - matrices[0][4 + i]) < 1e-4), 'pose Y aligns with actual surface normal without twist assumption');
      const shiftedPose = hits[0].getPose(shifted).transform.matrix;
      check([1, 2, 3].every((v, i) => Math.abs(matrices[0][12 + i] - shiftedPose[12 + i] - v) < 1e-4), 'result reference-space offset');
      for (const sub of [offsetSource, referenceOffsetSource]) {
        const r = sub._offsetRay, b = sub._space._update();
        const o = [0, 1, 2].map(i => b[i] * r.origin.x + b[4 + i] * r.origin.y + b[8 + i] * r.origin.z + b[12 + i]);
        const d = [0, 1, 2].map(i => b[i] * r.direction.x + b[4 + i] * r.direction.y + b[8 + i] * r.direction.z);
        const expected = session._device.arScene.getHitTestResults(o, d)[0]?.point.toArray(), actual = f.getHitTestResults(sub)[0]?.getPose(reference).transform.position;
        const actualWorld = actual && [0,1,2].map(i => referenceWorld[i]*actual.x+referenceWorld[4+i]*actual.y+referenceWorld[8+i]*actual.z+referenceWorld[12+i]);
        check(expected && actualWorld && Math.hypot(...actualWorld.map((v: number,i:number)=>v-expected[i])) < 1e-4, 'source-space and ray offsets match independent mesh intersection');
      }
      for (const realm of [w, other]) {
        check(realm.XRFrame.prototype.getHitTestResults.call(f, inherited).length === hits.length, 'borrowed cross-realm frame operation');
        const h = hits[0]; check(realm.XRHitTestResult.prototype.getPose.call(h, reference).transform.position.x === h.getPose(reference).transform.position.x, 'cross-realm result operation');
        for (const bad of [null, {}, Object.create(realm.XRHitTestSource.prototype), new Proxy(source, {})]) throws(() => f.getHitTestResults(bad), 'TypeError', 'source argument rejects forgeries/proxies');
        for (const bad of [null, {}, Object.create(realm.XRTransientInputHitTestSource.prototype), new Proxy(transient, {})]) throws(() => f.getHitTestResultsForTransientInput(bad), 'TypeError', 'transient source argument brand');
        for (const bad of [null, {}, Object.create(realm.XRFrame.prototype), new Proxy(f, {})]) throws(() => realm.XRFrame.prototype.getHitTestResults.call(bad, source), 'TypeError', 'frame receiver brand');
        for (const bad of [null, {}, Object.create(realm.XRHitTestResult.prototype), new Proxy(h, {})]) throws(() => realm.XRHitTestResult.prototype.getPose.call(bad, reference), 'TypeError', 'result receiver brand');
        throws(() => h.getPose(new Proxy(reference, {})), 'TypeError', 'pose base space interface conversion');
        throws(() => h.getPose(foreignSpace), 'InvalidStateError', 'foreign pose base space rejected');
        for (const bad of [null, {}, new Proxy(source, {})]) throws(() => realm.XRHitTestSource.prototype.cancel.call(bad), 'TypeError', 'source cancel receiver brand');
        for (const bad of [null, {}, new Proxy(transient, {})]) throws(() => realm.XRTransientInputHitTestSource.prototype.cancel.call(bad), 'TypeError', 'transient cancel receiver brand');
      }
      const record = registry.hitResults.get(hits[0]);
      check(Object.isFrozen(record) && !Reflect.set(record, 'transform', new w.XRRigidTransform({x: 999})), 'page cannot replace retained hit geometry');
      throws(() => registry.hitResults.set(new Proxy(hits[0], {}), record), 'TypeError', 'page cannot copy result brand');
      const saved = hits[0]; hits.length = 0; check(f.getHitTestResults(source)[0] === saved, 'sequence mutation cannot corrupt frame map');
      const p = reference.matrixProvider; reference.matrixProvider = () => null;
      try { check(saved.getPose(reference) === null, 'unavailable result base pose returns null'); } finally { reference.matrixProvider = p; }
      inherited.cancel(); check(f.getHitTestResults(inherited).length === plain.length, 'cancellation preserves current frame map');
      transient.cancel(); check(f.getHitTestResultsForTransientInput(transient).length === 0, 'transient cancellation preserves current frame empty entry');
      measurements.push({planeHits: plain.length, meshHits: meshes.length, distances, point: matrices[0].slice(12, 15), normal: matrices[0].slice(4, 7)});
      return {frame: f, result: saved, anchor: saved.createAnchor()};
    });
    const anchor = await first.anchor; check(!!anchor, 'hit-result anchor integration');
    await frame(session, f => { check(!!f.getPose(anchor.anchorSpace, reference), 'hit-result anchor tracked'); throws(() => f.getHitTestResults(inherited), 'InvalidStateError', 'cancelled missing later frame entry'); throws(() => f.getHitTestResultsForTransientInput(transient), 'InvalidStateError', 'cancelled transient missing later frame entry'); });
    await frame(peer, f => { throws(() => f.getHitTestResults(source), 'InvalidStateError', 'foreign frame map entry'); throws(() => f.getHitTestResultsForTransientInput(transient), 'InvalidStateError', 'foreign transient frame map entry'); });
    throws(() => inherited.cancel(), 'InvalidStateError', 'repeated persistent cancellation'); throws(() => transient.cancel(), 'InvalidStateError', 'repeated transient cancellation');
    throws(() => first.result.getPose({}), 'TypeError', 'base conversion precedes inactive result');
    throws(() => first.result.getPose(reference), 'InvalidStateError', 'inactive result access');
    throws(() => first.frame.getHitTestResults({}), 'TypeError', 'source conversion precedes inactive frame');
    throws(() => first.frame.getHitTestResults(source), 'InvalidStateError', 'inactive frame hit results');
    await rejects(first.result.createAnchor(), 'InvalidStateError', 'inactive result anchor');
    for (const realm of [w, other]) for (const bad of [null, {}, Object.create(realm.XRHitTestResult.prototype), new Proxy(first.result, {})]) await rejects(realm.XRHitTestResult.prototype.createAnchor.call(bad), 'TypeError', 'anchor result receiver binding rejects Promise');
    const adapter = session._device; await session.end();
    check(adapter.hitTestSources.length === 0 && adapter.hitTestSourcesForTransientInput.length === 0 && adapter.hitTestResults.size === 0 && adapter.hitTestResultsForTransientInput.size === 0, 'shutdown releases backend subscriptions and result maps');
    await rejects(session.requestHitTestSource({space: {}}), 'TypeError', 'ended enabled still converts');
    await rejects(session.requestHitTestSource({space: viewer}), 'InvalidStateError', 'ended enabled request state');
    await rejects(session.requestHitTestSourceForTransientInput({profile: Symbol()}), 'TypeError', 'ended transient conversion');
    await rejects(session.requestHitTestSourceForTransientInput({profile: 'x'}), 'InvalidStateError', 'ended transient enabled state');
    throws(() => source.cancel(), 'InvalidStateError', 'shutdown deactivates source');
    const restarted = await request({requiredFeatures: ['hit-test']}); sessions.push(restarted); await layer(restarted);
    while (!restarted._device.arScene?.room) { if (Date.now() > deadline + 20000) throw new Error('restart room timeout'); await new Promise(r => setTimeout(r, 20)); }
    const fresh = await restarted.requestHitTestSource({space: await restarted.requestReferenceSpace('viewer')});
    await frame(restarted, f => { check(f.getHitTestResults(fresh).length > 0, 'restart computes fresh hits'); throws(() => f.getHitTestResults(source), 'InvalidStateError', 'old source absent from restarted session'); });
    await restarted.end();
    check(adapter.hitTestSources.length === 0 && adapter.hitTestResults.size === 0, 'restart cleanup releases backend');
    return {mode, assertions: passed.length, passed, measurements};
  } finally { for (const s of sessions) if (!s.ended) await s.end(); child.remove(); }
}
