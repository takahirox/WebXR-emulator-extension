import type {SessionMode} from '../src/types/contracts';

/** Self-contained so both real extension runners execute identical page code.
 * WPT adaptations and deliberate inline-policy differences are documented in
 * docs/webxr-reference-space.md. Shutdown races use the narrowly scoped adapter,
 * timer and pending-record instrumentation disclosed there. */
export async function referenceSpaceCases(mode: SessionMode) {
  const w = window as any;
  const passed: string[] = [];
  function check(value: unknown, label: string) {
    if (!value) throw new Error(`${mode}: ${label}`);
    passed.push(label);
  }
  async function rejection(action: () => Promise<unknown>, expected: unknown, label: string, identity = false) {
    const promise = action(); // A synchronous throw must fail the case.
    check(promise instanceof w.Promise, `${label}: returns Promise`);
    let caught = false, reason: any;
    try { await promise; } catch (error) { caught = true; reason = error; }
    check(caught && (identity ? reason === expected : reason?.name === expected), `${label}: rejection preserved`);
  }
  async function microtasks() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  function observe(promise: Promise<any>) {
    const result = {count: 0, value: undefined as any, error: undefined as any};
    const done = promise.then(value => { result.count++; result.value = value; }, error => { result.count++; result.error = error; });
    return {result, done};
  }
  function near(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string) {
    check(actual.length === expected.length && Array.from(actual).every((v, i) => Math.abs(v - expected[i]) < 0.0001), label);
  }
  function throws(action: () => unknown, label: string) {
    let reason: any;
    try { action(); } catch (error) { reason = error; }
    check(reason?.name === 'InvalidStateError', label);
  }
  // Every negotiated session starts from its own real automation click; costly
  // phone scene setup must not depend on an earlier transient activation.
  function start(sessionMode: string, options?: object): Promise<any> {
    return new w.Promise((resolve: (value: any) => void, reject: (reason: any) => void) => {
      const button = document.createElement('button');
      button.id = 'reference-space-session'; button.textContent = 'Start reference-space case';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      button.onclick = () => {
        button.remove();
        w.navigator.xr.requestSession(sessionMode, options).then(resolve, reject);
      };
      document.body.append(button);
    });
  }
  const types = ['viewer', 'local', 'local-floor', 'bounded-floor', 'unbounded'];
  const request = w.XRSession.prototype.requestReferenceSpace;
  const descriptor = Object.getOwnPropertyDescriptor(w.XRSession.prototype, 'requestReferenceSpace')!;
  check(descriptor.value === request && descriptor.writable && descriptor.enumerable && descriptor.configurable && !descriptor.get, 'WebIDL operation descriptor');
  check(request.name === 'requestReferenceSpace' && request.length === 1, 'operation name and required arity');
  let coercions = 0;
  const argument = {[Symbol.toPrimitive](hint: string) { check(hint === 'string', 'enum uses string hint'); coercions++; return 'viewer'; }};
  let traps = 0;
  const proxy = new Proxy({}, {get() { traps++; throw new Error('receiver property accessed'); }});
  for (const receiver of [undefined, null, {}, w.XRSession.prototype, Object.create(w.XRSession.prototype), proxy]) {
    await rejection(() => Reflect.apply(request, receiver, [argument]), 'TypeError', 'invalid receiver');
    await rejection(() => Reflect.apply(request, receiver, []), 'TypeError', 'invalid receiver before missing argument');
  }
  check(coercions === 0 && traps === 0, 'receiver brand precedes conversion without property access');

  // Open while the runner's real user activation is still available. These are
  // separately injected same-origin documents, never manual polyfill installs.
  const popup = window.open('/frame', 'reference-space-realm') as any;
  check(popup, 'same-origin popup opened');
  const iframe = document.createElement('iframe'); iframe.src = '/frame';
  const childReady = new Promise<void>(resolve => { iframe.onload = () => resolve(); });
  document.body.append(iframe);
  const sessions: any[] = [];
  try {
    await childReady;
    const until = Date.now() + 10000;
    while (!(popup as any).XRSession) {
      check(Date.now() < until, 'popup injection completed before deadline');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const child = iframe.contentWindow as any;
    const realms = [w, child, popup as any];
    for (const [index, realm] of realms.entries()) {
      const session = await realm.navigator.xr.requestSession('inline'); sessions.push(session);
      for (const lender of realms) {
        const promise: Promise<any> = Reflect.apply(lender.XRSession.prototype.requestReferenceSpace, session, ['viewer']);
        check(Object.getPrototypeOf(promise) === realm.Promise.prototype, `realm ${index}: Promise belongs to session realm`);
        const space = await promise;
        check(Object.getPrototypeOf(space) === realm.XRReferenceSpace.prototype && space instanceof realm.XRSpace, `realm ${index}: borrowed allocation belongs to session realm`);
        const offset = space.getOffsetReferenceSpace(new realm.XRRigidTransform({x: 1}));
        check(Object.getPrototypeOf(offset) === realm.XRReferenceSpace.prototype && offset !== space, `realm ${index}: offset remains independently usable`);
      }
      await rejection(() => Reflect.apply(request, new Proxy(session, {}), ['viewer']), 'TypeError', 'Proxy around genuine session rejected');
      const peer = await w.navigator.xr.requestSession('inline'); sessions.push(peer);
      const peerRequest = observe(peer.requestReferenceSpace('viewer'));
      const cancelled = ['viewer', 'local'].map(type => {
        const promise: Promise<any> = Reflect.apply(request, session, [type]);
        check(Object.getPrototypeOf(promise) === realm.Promise.prototype, `realm ${index}: pending borrowed Promise realm`);
        return observe(promise);
      });
      const ending = session.end();
      await Promise.all(cancelled.map(p => p.done));
      check(cancelled.every(p => p.result.count === 1 && p.result.error instanceof realm.DOMException && p.result.error.name === 'InvalidStateError'), `realm ${index}: borrowed cancellation uses owning realm`);
      await ending; await peerRequest.done;
      check(peerRequest.result.value instanceof w.XRReferenceSpace && !peer.ended, `realm ${index}: shutdown does not cancel another session`);
      await peer.end();
    }
    for (const session of sessions) if (!session.ended) await session.end();
    sessions.length = 0;
    // Retain the foreign operations before closing windows; their closures must
    // still allocate main-session objects, including the bounded subclass.
    const borrowed = [child.XRSession.prototype.requestReferenceSpace, (popup as any).XRSession.prototype.requestReferenceSpace];
    popup.close(); iframe.remove();

    const defaults = await start(mode); sessions.push(defaults);
    const allowedDefaults = mode === 'inline' ? ['viewer'] : ['viewer', 'local'];
    check(defaults.enabledFeatures.join(',') === allowedDefaults.join(','), 'default grants preserved');
    for (const type of types) {
      const {result, done} = observe(defaults.requestReferenceSpace(type));
      await microtasks();
      check(result.count === 0, `${type}: support/allocation remains pending through calling-task microtasks`);
      await done;
      check(result.count === 1 && (allowedDefaults.includes(type) ? result.value instanceof w.XRReferenceSpace : result.error?.name === 'NotSupportedError'), `${type}: default support result`);
    }
    for (const args of [[], [null], [undefined], [''], ['VIEWER'], ['invalid'], [123], [Symbol('viewer')], [Object(Symbol('viewer'))]]) {
      const {result, done} = observe(Reflect.apply(request, defaults, args));
      await microtasks();
      check(result.count === 1 && result.error?.name === 'TypeError', 'binding failure settles in calling-task microtasks');
      await done;
    }
    for (const reason of [undefined, null, Symbol('sentinel'), {sentinel: true}, new Error('coercion')]) {
      let calls = 0;
      await rejection(() => defaults.requestReferenceSpace({toString() { calls++; throw reason; }}), reason, 'thrown coercion value', true);
      check(calls === 1, 'throwing conversion occurs once');
    }
    const before = coercions;
    const converted = defaults.requestReferenceSpace(argument);
    check(coercions === before + 1, 'enum conversion occurs once synchronously');
    const boxed = await defaults.requestReferenceSpace(new String('viewer'));
    const primitive = await converted;
    check(primitive !== boxed, 'coercible object and boxed string produce fresh spaces');
    let lateCalls = 0;
    const delayed = {toString() { lateCalls++; return 'viewer'; }};
    const captured = defaults.requestReferenceSpace(delayed);
    delayed.toString = () => { throw new Error('converted argument reread'); };
    check(await captured instanceof w.XRReferenceSpace && lateCalls === 1, 'queued work retains converted enum');
    const settledSuccess = observe(defaults.requestReferenceSpace('viewer'));
    const settledFailure = observe(defaults.requestReferenceSpace('bounded-floor'));
    await Promise.all([settledSuccess.done, settledFailure.done]);
    const settledSpace = settledSuccess.result.value, settledError = settledFailure.result.error;
    check(defaults.pendingReferenceRequests.size === 0, 'settlement releases successful and unsupported pending records');
    const immediate = types.map(type => observe(defaults.requestReferenceSpace(type)));
    await defaults.end();
    await Promise.all(immediate.map(p => p.done));
    check(immediate.every(p => p.result.count === 1 && p.result.error?.name === 'InvalidStateError'), 'immediate shutdown cancels granted and ungranted requests before adapter continuations');
    check(settledSuccess.result.count === 1 && settledSuccess.result.value === settledSpace && settledFailure.result.count === 1 && settledFailure.result.error === settledError && settledError.name === 'NotSupportedError', 'shutdown preserves previously settled success and failure');
    await rejection(() => defaults.requestReferenceSpace(null), 'TypeError', 'ended binding error precedes support');
    await rejection(() => defaults.requestReferenceSpace('bounded-floor'), 'NotSupportedError', 'ended ungranted support');
    await rejection(() => defaults.end(), 'InvalidStateError', 'unrelated repeated-end gate retained');

    for (const conversion of ['viewer', 'bounded-floor', 'invalid', 'throw']) {
      const converting = await w.navigator.xr.requestSession('inline'); sessions.push(converting);
      const outstanding = observe(converting.requestReferenceSpace('viewer'));
      const sentinel = {conversion}; let calls = 0, ending: Promise<void> | undefined;
      const converted = observe(converting.requestReferenceSpace({toString() {
        calls++; ending = converting.end();
        if (conversion === 'throw') throw sentinel;
        return conversion;
      }}));
      check(calls === 1 && converting.ended && converting.pendingReferenceRequests.size === 0, `${conversion}: coercion shutdown precedes new pending registration`);
      await Promise.all([outstanding.done, converted.done, ending]);
      check(outstanding.result.error?.name === 'InvalidStateError', `${conversion}: coercion shutdown cancels older request`);
      check(conversion === 'viewer' ? converted.result.value instanceof w.XRReferenceSpace
        : conversion === 'throw' ? converted.result.error === sentinel
        : converted.result.error?.name === (conversion === 'invalid' ? 'TypeError' : 'NotSupportedError'), `${conversion}: post-coercion promise retains binding/support result`);
    }

    if (mode === 'inline') {
      await rejection(() => start(mode, {requiredFeatures: ['local']}), 'NotSupportedError', 'inline required local remains unavailable');
    } else {
      const required = await start(mode, {requiredFeatures: types.slice(2)}); sessions.push(required);
      for (const type of types) check(await required.requestReferenceSpace(type) instanceof w.XRReferenceSpace, `${type}: required/default grant works`);
      await required.end();
    }
    const session = await start(mode, {optionalFeatures: [...types.slice(1), 'unknown-reference-fixture']}); sessions.push(session);
    check(!session.enabledFeatures.includes('unknown-reference-fixture'), 'unavailable optional feature omitted');
    check(mode !== 'inline' || session.enabledFeatures.join(',') === 'viewer', 'inline optional local/floor/bounded/unbounded remain omitted');
    const spaces = new Map<string, any[]>();
    for (const type of types) {
      if (!session.enabledFeatures.includes(type)) {
        await rejection(() => session.requestReferenceSpace(type), 'NotSupportedError', `${type}: optional omission rejects`);
        continue;
      }
      const pair = await Promise.all([session.requestReferenceSpace(type), session.requestReferenceSpace(type)]);
      const sequential = await session.requestReferenceSpace(type);
      check(new Set([...pair, sequential]).size === 3 && pair.every(space => Object.getPrototypeOf(space) === (type === 'bounded-floor' ? w.XRBoundedReferenceSpace : w.XRReferenceSpace).prototype), `${type}: fresh concurrent and sequential identities with correct subclass`);
      for (const method of borrowed) {
        const promise: Promise<any> = Reflect.apply(method, session, [type]);
        check(Object.getPrototypeOf(promise) === w.Promise.prototype, `${type}: borrowed Promise realm`);
        const space = await promise;
        check(Object.getPrototypeOf(space) === Object.getPrototypeOf(pair[0]) && !pair.includes(space), `${type}: borrowed main-session allocation realm`);
      }
      spaces.set(type, pair);
    }
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl')!; await (gl as any).makeXRCompatible();
    const layer = new w.XRWebGLLayer(session, gl);
    const framebuffer = layer.framebuffer;
    check(mode === 'inline' ? framebuffer === null : framebuffer && gl.isFramebuffer(framebuffer), 'live presentation exposes expected framebuffer before disposal');
    session.updateRenderState({baseLayer: layer});
    const next = <T>(action: (frame: any) => T): Promise<T> => new Promise((resolve, reject) => session.requestAnimationFrame((_time: number, frame: any) => { try { resolve(action(frame)); } catch (error) { reject(error); } }));
    const viewer = spaces.get('viewer')!;
    const offsetA = viewer[0].getOffsetReferenceSpace(new w.XRRigidTransform({x: 1}, {y: Math.SQRT1_2, w: Math.SQRT1_2}));
    const offsetB = offsetA.getOffsetReferenceSpace(new w.XRRigidTransform({z: 2}));
    const independent = viewer[1].getOffsetReferenceSpace(new w.XRRigidTransform({x: -2}));
    const foreign = await start('inline'); sessions.push(foreign);
    const foreignSpace = await foreign.requestReferenceSpace('viewer');
    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const polygon = [[-1,0,-1,1],[1,0,-1,1],[1,0,1,1],[-1,0,1,1]];
    const bounds = spaces.get('bounded-floor');
    const positions: number[][] = [];
    // Deterministic pose injection uses the existing emulator pose bridge, the
    // same adapter path fed by panel TransformControls (not a fake XR device).
    const move = (position: number[], quaternion: number[]) => window.dispatchEvent(new CustomEvent(session.interactionMode === 'screen-space' && mode !== 'inline' ? 'webxr-input-pose' : 'webxr-pose', {detail: {objectName: 'leftController', position, quaternion}}));
    let retained: any;
    for (const [position, orientation] of [[[0,1.6,0],[0,0,0,1]], [[0.4,1.8,-0.7],[0,Math.sin(0.3),0,Math.cos(0.3)]], [[25,2,-30],[0,0,0,1]]]) {
      move(position, orientation);
      retained = await next(frame => {
        for (const space of viewer) near(frame.getViewerPose(space).transform.matrix, identity, 'fresh viewer pose remains identity after movement');
        near(frame.getPose(viewer[0], viewer[1]).transform.matrix, identity, 'independent viewer origins agree');
        near(Array.from(frame.getPose(offsetB, viewer[0]).transform.matrix).slice(12,15) as number[], [3,0,0], 'rotated successive offsets compose independently');
        near(Array.from(frame.getPose(independent, viewer[0]).transform.matrix).slice(12,15) as number[], [-2,0,0], 'second viewer offset remains independent');
        throws(() => frame.getPose(foreignSpace, viewer[0]), 'active frame rejects foreign source');
        throws(() => frame.getPose(viewer[0], foreignSpace), 'active frame rejects foreign base');
        if (mode !== 'inline') {
          const floor = spaces.get('local-floor')![0], local = spaces.get('local')![0], unbounded = spaces.get('unbounded')![0];
          near(Array.from(frame.getPose(viewer[0], floor).transform.matrix).slice(12,15) as number[], position, 'fresh viewer follows virtual world movement');
          near(Array.from(frame.getPose(floor, local).transform.matrix).slice(12,15) as number[], [0,-1.6,0], 'local and floor origins preserved');
          near(frame.getPose(unbounded, local).transform.matrix, identity, 'unbounded retains fixed local origin through distant navigation');
          positions.push(Array.from(frame.getViewerPose(unbounded).transform.matrix).slice(12,15) as number[]);
          for (const bounded of bounds!) {
            check(Object.isFrozen(bounded.boundsGeometry) && bounded.boundsGeometry.length === 4, 'fresh bounded geometry frozen');
            bounded.boundsGeometry.forEach((p: DOMPointReadOnly, i: number) => near([p.x,p.y,p.z,p.w], polygon[i], 'fresh bounded polygon retains authored vertices'));
            near(frame.getPose(bounded, floor).transform.matrix, identity, 'bounded and floor origins agree');
          }
        }
        return frame;
      });
    }
    throws(() => retained.getPose(viewer[0], viewer[1]), 'inactive same-session frame rejected separately');
    let callbacks = 0, inputEvents = 0, ends = 0;
    session.addEventListener('end', () => ends++);
    for (const event of ['inputsourceschange','selectstart','select','selectend']) session.addEventListener(event, () => inputEvents++);
    session.requestAnimationFrame(() => callbacks++);
    // Capture real queued callbacks only through this task's microtasks. Replay
    // them after cancellation too, so guards are tested even if timers clear.
    const timer = w.setTimeout;
    const queued: (() => void)[] = [];
    const adapter = session._device;
    const transform = adapter.requestFrameOfReferenceTransform;
    const late: {resolve: (value: any) => void; reject: (reason: any) => void}[] = [];
    let matrixReads = 0;
    const watchedMatrix = new Proxy(identity, {get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) matrixReads++;
      return Reflect.get(target, key, receiver);
    }});
    const pending: ReturnType<typeof observe>[] = [];
    try {
      w.setTimeout = (callback: (...args: any[]) => void, delay: number, ...args: any[]) => {
        queued.push(() => callback(...args));
        return timer(callback, delay, ...args);
      };
      pending.push(...types.map(type => observe(session.requestReferenceSpace(type))));
      pending.push(...borrowed.map(method => observe(Reflect.apply(method, session, ['viewer']))));
      if (mode !== 'inline') {
        adapter.requestFrameOfReferenceTransform = () => new w.Promise((resolve: (value: any) => void, reject: (reason: any) => void) => late.push({resolve, reject}));
        pending.push(observe(session.requestReferenceSpace('local')), observe(session.requestReferenceSpace('bounded-floor')));
        adapter.requestFrameOfReferenceTransform = () => w.Promise.resolve(watchedMatrix);
        pending.push(observe(session.requestReferenceSpace('bounded-floor')));
        adapter.requestFrameOfReferenceTransform = () => w.Promise.reject(new Error('queued adapter failure'));
        pending.push(observe(session.requestReferenceSpace('local')));
      }
      await microtasks();
    } finally { w.setTimeout = timer; adapter.requestFrameOfReferenceTransform = transform; }
    check(queued.length === pending.length - late.length && pending.every(p => p.result.count === 0), 'all non-delayed outcomes queued before shutdown');
    check(session.pendingReferenceRequests.size === pending.length, 'every concurrent request registered to owning session');
    const isolated = observe(foreign.requestReferenceSpace('viewer'));
    const ending = session.end();
    await Promise.all(pending.map(p => p.done));
    check(pending.every(p => p.result.count === 1 && p.result.error instanceof w.DOMException && p.result.error.name === 'InvalidStateError'), 'shutdown rejection reactions observed for all pending outcomes');
    check(session.pendingReferenceRequests.size === 0, 'shutdown releases all pending operation records');
    await ending;
    const endedCanvasCount = document.querySelectorAll('canvas').length;
    queued.forEach(callback => callback());
    let lateTasks = 0;
    try {
      w.setTimeout = (...args: any[]) => { lateTasks++; return Reflect.apply(timer, w, args); };
      late[0]?.resolve(watchedMatrix); late[1]?.reject(new Error('delayed adapter failure'));
      await microtasks();
    } finally { w.setTimeout = timer; }
    check(lateTasks === 0, 'cancelled adapter continuations queue no settlement tasks');
    check(matrixReads === 0, 'cancelled queued and delayed adapter success never reads allocation matrix');
    await isolated.done;
    check(isolated.result.value instanceof w.XRReferenceSpace && !foreign.ended, 'concurrent other-session request survives immersive or inline shutdown');
    await foreign.end();
    const after = types.map(type => observe(session.requestReferenceSpace(type)));
    await microtasks();
    check(after.every(p => p.result.count === 0), 'after-end requests still queue task settlement');
    await Promise.all(after.map(p => p.done));
    for (const [i, {result}] of after.entries()) {
      check(result.count === 1 && (session.enabledFeatures.includes(types[i]) ? Object.getPrototypeOf(result.value) === (types[i] === 'bounded-floor' ? w.XRBoundedReferenceSpace : w.XRReferenceSpace).prototype && !spaces.get(types[i])!.includes(result.value) : result.error?.name === 'NotSupportedError'), `${types[i]}: after-end support and fresh allocation`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    check(callbacks === 0 && inputEvents === 0 && ends === 1 && session.inputSources.length === 0 && session.requestAnimationFrame(() => callbacks++) === 0, 'requests neither restart callbacks/input nor duplicate shutdown');
    check(pending.every(p => p.result.count === 1) && after.every(p => p.result.count === 1), 'all observed requests settle once');
    check(document.querySelectorAll('canvas').length === endedCanvasCount && (!framebuffer || !gl.isFramebuffer(framebuffer)), 'settlement does not recreate presentation canvases or disposed framebuffers');
    throws(() => session.updateRenderState({baseLayer: layer}), 'ended rendering cannot resume');
    throws(() => retained.getViewerPose(viewer[0]), 'ended frame gate preserved');
    canvas.remove();
    move([0,1.6,0], [0,0,0,1]);
    // Use the adapter's real termination path. Inline has no presentation-end
    // notification, so emit that same private notification after ending it.
    const deviceEnded = await start(mode); sessions.push(deviceEnded);
    const devicePending = types.map(type => observe(deviceEnded.requestReferenceSpace(type)));
    const deviceBorrowed = observe(Reflect.apply(borrowed[0], deviceEnded, ['viewer']));
    deviceEnded._device.endSession(deviceEnded._id);
    if (mode === 'inline') deviceEnded._device.dispatchEvent('@@webxr-polyfill/vr-present-end', deviceEnded._id);
    await Promise.all([...devicePending, deviceBorrowed].map(p => p.done));
    check(deviceEnded.ended && [...devicePending, deviceBorrowed].every(p => p.result.count === 1 && p.result.error?.name === 'InvalidStateError'), 'device-driven shutdown cancels owning session requests');
    check(deviceEnded.pendingReferenceRequests.size === 0, 'device-driven shutdown releases pending records');
    await rejection(() => deviceEnded.end(), 'InvalidStateError', 'device-driven shutdown retains repeated end gate');
    check(await deviceEnded.requestReferenceSpace('viewer') instanceof w.XRReferenceSpace, 'post-device-shutdown request still follows support');
    return {mode, assertions: passed.length, passed, positions, failures: [], skips: []};
  } finally {
    for (const session of sessions) if (!session.ended) await session.end();
    popup.close(); iframe.remove();
  }
}
