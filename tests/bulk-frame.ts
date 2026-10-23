import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Geometry from '../src/polyfill/api/geometry';
import type * as Sensing from '../src/polyfill/api/sensing';
import type * as Layers from '../src/polyfill/api/layers';

type TestWindow = typeof Runtime & typeof Geometry & typeof Sensing & typeof Layers & {navigator: {xr: Runtime.XRSystem}};

/** Hands WD bulk algorithms + pinned WebIDL conversion, through the real extension. */
export async function runBulkFrame(page: Page, mode: SessionMode, handheld: boolean) {
  // Navigate before the evaluate call grants transient activation, so the new
  // same-origin document also has activation for its real immersive session.
  await page.evaluate(() => {
    const realm = document.createElement('iframe'); realm.id = 'bulk-interface-realm'; realm.src = '/frame'; document.body.append(realm);
  });
  await page.frameLocator('#bulk-interface-realm').locator('body').waitFor();
  try { return await page.evaluate(async ({mode, handheld}) => {
    const w = window as unknown as TestWindow;
    const passed: string[] = [], skipped: string[] = [];
    let context = '';
    function check(value: unknown, label: string): asserts value {
      if (!value) throw new Error(`${context}: ${label}`);
      passed.push(`${context}: ${label}`);
    }
    function throws(action: () => unknown, name: string, label: string) {
      let error: unknown; try { action(); } catch (caught) { error = caught; }
      check(error !== null && typeof error === 'object' && (error as Error).name === name, `${label}: ${name} (got ${String(error)})`);
    }
    const sentinel = 12345;
    function untouched(buffer: Float32Array, action: () => unknown, name: string, label: string) {
      buffer.fill(sentinel); throws(action, name, label);
      check(buffer.every(value => value === sentinel), `${label}: no output writes`);
    }
    async function setup(sessionMode: SessionMode, hands: boolean, realmWindow: Window = window) {
      const api = realmWindow as unknown as TestWindow;
      const session = await api.navigator.xr.requestSession(sessionMode, {requiredFeatures: hands ? ['hand-tracking'] : [], optionalFeatures: sessionMode === 'inline' ? ['hand-tracking'] : []});
      const canvas = realmWindow.document.createElement('canvas'); realmWindow.document.body.append(canvas);
      session.updateRenderState({baseLayer: new api.XRWebGLLayer(session, canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!)});
      const base = await session.requestReferenceSpace('viewer');
      const next = <T>(read: (frame: Runtime.XRFrame) => T) => new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bulk frame timeout')), 5000);
        session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(read(frame)); } catch (error) { reject(error); } });
      });
      const close = async () => { if (!session.ended) await session.end(); canvas.remove(); };
      return {session, base, next, close};
    }
    // Retain real spaces from a different (ended) session, including genuine joints.
    const foreign = await setup(mode, !handheld);
    const foreignJoint = await foreign.next(() => foreign.session.inputSources[0]?.hand?.get('wrist'));
    await foreign.close();
    // A navigated frame gets a separate real MAIN-world extension injection.
    const realm = document.querySelector<HTMLIFrameElement>('#bulk-interface-realm')!;
    const other = realm.contentWindow as unknown as TestWindow & {Float32Array: typeof Float32Array; ArrayBuffer: typeof ArrayBuffer; EventTarget: typeof EventTarget; Object: typeof Object};
    let child: Awaited<ReturnType<typeof setup>> | undefined;
    try {
      child = await setup(mode, !handheld, realm.contentWindow!);
      const childTest = child;
      const childJoint = await childTest.next(() => childTest.session.inputSources[0]?.hand?.get('wrist'));
      check(other.XRFrame !== w.XRFrame && other.XRSpace !== w.XRSpace, 'separate iframe interface constructors');
      check(childTest.base instanceof other.EventTarget && !(childTest.base instanceof w.XRSpace), 'iframe spaces preserve their realm inheritance');
      for (const sessionMode of ['inline', mode] as const) {
        context = sessionMode;
        const test = await setup(sessionMode, !handheld && sessionMode !== 'inline');
        const {session, base, next} = test;
        let held!: Runtime.XRFrame;
        const poses = new Float32Array(64), radii = new Float32Array(32);
        try {
          await next(frame => {
            held = frame;
            // Borrow methods in both directions. The receiver and its owned
            // interfaces must convert independently of the method's realm.
            const childPoses = other.XRFrame.prototype.fillPoses;
            const childRadii = other.XRFrame.prototype.fillJointRadii;
            poses.fill(sentinel);
            check(childPoses.call(frame, [base], base, poses) && poses[0] === 1 && poses.slice(16).every(v => v === sentinel), 'iframe pose method accepts parent receiver and owned spaces');
            radii.fill(sentinel);
            check(childRadii.call(frame, [], radii) && radii.every(v => v === sentinel), 'iframe radius method accepts parent receiver with empty input');
            for (const method of [frame.fillPoses, childPoses]) {
              untouched(poses, () => method.call(frame, [base, childTest.base], base, poses), 'InvalidStateError', 'iframe space reaches ownership validation before writes');
              untouched(poses, () => method.call(frame, [], childTest.base, poses), 'InvalidStateError', 'iframe base reaches ownership validation even for empty input');
              untouched(poses, () => method.call(frame, [base, childTest.base], base, poses.subarray(0, 1)), 'InvalidStateError', 'iframe ownership precedes short pose capacity');
              for (const fake of [Object.create(other.XRSpace.prototype), new Proxy(childTest.base, {})]) {
                untouched(poses, () => method.call(frame, [fake], base, poses), 'TypeError', 'iframe space forgeries and proxies rejected');
              }
            }
            for (const method of [frame.fillJointRadii, childRadii]) {
              if (childJoint) untouched(radii, () => method.call(frame, [childJoint], radii.subarray(0, 0)), 'InvalidStateError', 'iframe joint ownership precedes short radius capacity');
              untouched(radii, () => method.call(frame, [Object.create(other.XRJointSpace.prototype)], radii), 'TypeError', 'iframe joint forgery rejected');
              if (childJoint) untouched(radii, () => method.call(frame, [new Proxy(childJoint, {})], radii), 'TypeError', 'iframe joint proxy rejected');
            }
            for (const method of [childPoses, childRadii]) {
              for (const fake of [Object.create(w.XRFrame.prototype), new Proxy(frame, {})]) {
                throws(() => Reflect.apply(method, fake, []), 'TypeError', 'borrowed method rejects forged/proxy receiver');
              }
            }
            check(sessionMode !== 'inline' || (!session.enabledFeatures.includes('hand-tracking') && session.inputSources.length === 0), 'inline has no articulated hands');
            check(frame.fillPoses([], base, new Float32Array(0)) && frame.fillJointRadii([], new Float32Array(0)), 'empty sequences and exact empty outputs succeed');
            poses.fill(sentinel); radii.fill(sentinel);
            check(frame.fillPoses([], base, poses) && frame.fillJointRadii([], radii) && poses.every(v => v === sentinel) && radii.every(v => v === sentinel), 'empty fills preserve oversized output');
            const offset = base.getOffsetReferenceSpace(new w.XRRigidTransform({x: 0.25, y: -0.5, z: 1}));
            const list = [offset, base, offset];
            const expected = list.flatMap(space => [...frame.getPose(space, base)!.transform.matrix]);
            for (const output of [new Float32Array(48), new Float32Array(53), new Float32Array(60).subarray(3, 56), new other.Float32Array(53)]) {
              output.fill(sentinel);
              const backing = new Float32Array(output.buffer); backing.fill(sentinel);
              check(frame.fillPoses(list, base, output), 'exact/oversized/subarray/cross-realm pose output succeeds');
              check(expected.every((value, index) => Math.abs(value - output[index]) < 1e-6), 'matrix input order, duplicates and getPose agreement');
              check(backing.every((value, index) => index >= output.byteOffset / 4 && index < output.byteOffset / 4 + 48 || value === sentinel), 'offsets and unused pose elements preserved');
              check(frame.fillPoses(list, offset, output) && output.buffer === backing.buffer, 'caller-owned pose buffer reusable with another base');
            }
            let iteratorCalls = 0, nextReads = 0, advances = 0;
            const once = { [Symbol.iterator]() {
              check(++iteratorCalls === 1, 'one-shot iterable requested once');
              return {get next() { nextReads++; return () => ++advances <= 2 ? {value: base, done: false} : {done: true, get value() { throw new Error('done value must not be read'); }}; }};
            }};
            check(frame.fillPoses(once as unknown as Iterable<Geometry.XRSpace>, base, poses) && nextReads === 1 && advances === 3, 'iterator next captured once; values converted in order');
            const poison = new Error('conversion sentinel');
            let caught: unknown;
            try { frame.fillPoses({get [Symbol.iterator](): never { throw poison; }}, foreign.base, poses); } catch (error) { caught = error; }
            check(caught === poison, 'iterator getter error propagates before ownership');
            let closed = false, advanced = false;
            const badElements = { [Symbol.iterator]() { return {next() { if (advanced) throw poison; advanced = true; return {value: {}, done: false}; }, return() { closed = true; return {done: true}; }}; }};
            throws(() => frame.fillPoses(badElements as Iterable<Geometry.XRSpace>, base, poses), 'TypeError', 'element conversion precedes next iteration');
            check(!closed, 'pinned WebIDL conversion does not close iterator on element failure');
            for (const input of [undefined, null, 'string', 1, {}, {length: 1, 0: base}, {[Symbol.iterator]: 1}, {[Symbol.iterator]: () => 1}, {[Symbol.iterator]: () => ({next: () => 1})}]) {
              throws(() => frame.fillPoses(input as Iterable<Geometry.XRSpace>, base, poses), 'TypeError', 'nonsequence or malformed iterator rejected');
              throws(() => frame.fillJointRadii(input as Iterable<Sensing.XRJointSpace>, radii), 'TypeError', 'radii nonsequence or malformed iterator rejected');
            }
            for (const fake of [{}, Object.create(w.XRSpace.prototype), new Proxy(base, {})]) {
              untouched(poses, () => frame.fillPoses([base, fake], base, poses), 'TypeError', 'nonspace late element rejected');
              untouched(poses, () => frame.fillPoses([], fake, poses), 'TypeError', 'nonspace base rejected even when empty');
              untouched(radii, () => frame.fillJointRadii([fake], radii), 'TypeError', 'nonjoint rejected');
            }
            let observed = false;
            const observedSequence = {get [Symbol.iterator](): never { observed = true; throw poison; }};
            for (const receiver of [null, {}, Object.create(w.XRFrame.prototype), new Proxy(frame, {})]) {
              throws(() => w.XRFrame.prototype.fillPoses.call(receiver, observedSequence, base, poses), 'TypeError', 'receiver brand checked before conversion');
              throws(() => w.XRFrame.prototype.fillJointRadii.call(receiver, observedSequence, radii), 'TypeError', 'radius receiver brand checked before conversion');
            }
            check(!observed, 'invalid receiver never reads arguments');
            const poseCall = frame.fillPoses.bind(frame) as (...args: unknown[]) => boolean;
            const radiusCall = frame.fillJointRadii.bind(frame) as (...args: unknown[]) => boolean;
            for (const args of [[], [observedSequence], [observedSequence, base]]) throws(() => poseCall(...args), 'TypeError', 'missing pose arguments checked before conversion');
            for (const args of [[], [observedSequence]]) throws(() => radiusCall(...args), 'TypeError', 'missing radius arguments checked before conversion');
            check(!observed, 'insufficient arguments do not start conversion');
            // Genuine Float32Array brand and backing checks, including empty fills.
            const forged = {length: 100, set() {}, fill() {}, [Symbol.toStringTag]: 'Float32Array'};
            const wrongTagged = new Uint32Array(64); Object.defineProperty(wrongTagged, Symbol.toStringTag, {value: 'Float32Array'});
            const invalidOutputs: unknown[] = [undefined, null, [], forged, Object.create(Float32Array.prototype), new Proxy(poses, {}), new Float64Array(64), wrongTagged, new DataView(new ArrayBuffer(256))];
            const rabConstructor = ArrayBuffer as unknown as new (length: number, options: {maxByteLength: number}) => ArrayBuffer & {resizable: boolean; resize(length: number): void};
            const rab = new rabConstructor(256, {maxByteLength: 512});
            if (rab.resizable) {
              invalidOutputs.push(new Float32Array(rab), new Float32Array(rab, 0, 16));
              Object.defineProperty(rab, 'resizable', {value: false});
              check(true, 'resizable fixed-length and length-tracking views exercised with shadowed resizable property');
              const crossRab = new (other.ArrayBuffer as unknown as typeof rabConstructor)(256, {maxByteLength: 512});
              invalidOutputs.push(new other.Float32Array(crossRab));
              rab.resize(0); invalidOutputs.push(new Float32Array(rab));
            } else skipped.push(`${context}: resizable ArrayBuffer unavailable`);
            if (typeof SharedArrayBuffer !== 'undefined') {
              invalidOutputs.push(new Float32Array(new SharedArrayBuffer(256)));
              const growable = new (SharedArrayBuffer as unknown as typeof rabConstructor)(256, {maxByteLength: 512});
              invalidOutputs.push(new Float32Array(growable));
            } else skipped.push(`${context}: SharedArrayBuffer/growable SharedArrayBuffer unavailable (page is not cross-origin isolated)`);
            for (const output of invalidOutputs) {
              throws(() => frame.fillPoses([], base, output as Float32Array), 'TypeError', 'invalid pose output brand/backing rejected for empty input');
              throws(() => frame.fillJointRadii([], output as Float32Array), 'TypeError', 'invalid radius output brand/backing rejected for empty input');
            }
            const disguised = new Float32Array(64);
            Object.defineProperties(disguised, {
              length: {get() { throw poison; }}, buffer: {get() { throw poison; }},
              set: {value: () => { throw poison; }}, fill: {value: () => { throw poison; }}, [Symbol.toStringTag]: {value: 'Uint8Array'},
            });
            check(frame.fillPoses([base], base, disguised) && disguised[0] === 1, 'writes ignore shadowed set/fill/length/buffer/tag');
            const short = new Float32Array(1); Object.defineProperty(short, 'length', {value: 10000});
            throws(() => frame.fillPoses([base], base, short), 'TypeError', 'shadowed length cannot inflate capacity');
            untouched(poses, () => frame.fillPoses([base, foreign.base], base, poses), 'InvalidStateError', 'late foreign space validated before writes');
            untouched(poses, () => frame.fillPoses([base], foreign.base, poses), 'InvalidStateError', 'foreign base validated before writes');
            untouched(poses, () => frame.fillPoses([], foreign.base, poses), 'InvalidStateError', 'empty fill validates foreign base');
            untouched(short, () => frame.fillPoses([base, foreign.base], base, short), 'InvalidStateError', 'foreign input precedes insufficient pose capacity');
            untouched(short, () => frame.fillPoses([base], foreign.base, short), 'InvalidStateError', 'foreign base precedes insufficient pose capacity');
            untouched(poses.subarray(0, 15), () => frame.fillPoses([base], base, poses.subarray(0, 15)), 'TypeError', 'short pose buffer unchanged');
            const unavailable = new w.XRSpace(session, () => null);
            poses.fill(sentinel);
            check(!frame.fillPoses([base, unavailable, offset], base, poses) && poses.slice(16, 32).every(Number.isNaN) && poses[0] === 1 && poses[44] === expected[44] && poses.slice(48).every(v => v === sentinel), 'unavailable matrix is 16 NaNs while other entries populate');
            check(frame.getPose(unavailable, base) === null, 'unavailable individual pose agrees');
            check(!frame.fillPoses([base, offset], unavailable, poses) && poses.slice(0, 32).every(Number.isNaN), 'unavailable base makes all requested matrices NaN');
            check(frame.fillPoses([], unavailable, poses), 'untracked base with empty sequence succeeds');
            if (foreignJoint) untouched(radii, () => frame.fillJointRadii([foreignJoint], radii.subarray(0, 0)), 'InvalidStateError', 'foreign joint precedes capacity');
            const detached = new Float32Array(16); structuredClone(detached.buffer, {transfer: [detached.buffer]});
            check(frame.fillPoses([], base, detached) && frame.fillJointRadii([], detached), 'detached fixed buffer retains IDL brand for empty fills');
            throws(() => frame.fillPoses([base], base, detached), 'TypeError', 'detached pose buffer has no usable capacity');
          });
          untouched(poses, () => held.fillPoses([], base, poses), 'InvalidStateError', 'retained inactive frame rejects poses');
          untouched(radii, () => held.fillJointRadii([], radii), 'InvalidStateError', 'retained inactive frame rejects radii');
          throws(() => held.fillPoses([], {} as Geometry.XRSpace, poses), 'TypeError', 'base conversion precedes inactive frame');
          throws(() => held.fillJointRadii([base as unknown as Sensing.XRJointSpace], radii), 'TypeError', 'joint conversion precedes inactive frame');
          throws(() => held.fillPoses([], base, {} as Float32Array), 'TypeError', 'buffer conversion precedes inactive frame');
          throws(() => held.fillJointRadii([], {} as Float32Array), 'TypeError', 'radius buffer conversion precedes inactive frame');

          if (!handheld && sessionMode !== 'inline') {
            const device = session._device;
            const savedActive = device.gamepadInputSources.map(input => input.active);
            const sources = await next(() => [...session.inputSources]);
            const joints = sources.map(source => [...source.hand!.values()]);
            const first = joints[0][0], tip = joints[0][4], survivor = joints[1][0];
            function handResult(frame: Runtime.XRFrame, list: Sensing.XRJointSpace[], availability: boolean[], label: string) {
              const matrices = new Float32Array(list.length * 16 + 3).fill(sentinel);
              const sizes = new Float32Array(list.length + 3).fill(sentinel);
              check(frame.fillPoses(list, base, matrices) === availability.every(Boolean) && frame.fillJointRadii(list, sizes) === availability.every(Boolean), `${label}: bulk validity`);
              list.forEach((joint, index) => {
                const pose = frame.getJointPose(joint, base), general = frame.getPose(joint, base);
                check(Boolean(pose) === availability[index] && Boolean(general) === availability[index], `${label}: individual tracking agrees ${index}`);
                check(availability[index] ? Math.abs(sizes[index] - pose!.radius) < 1e-8 && sizes[index] > 0 && sizes[index] < 0.1 && pose!.transform.matrix.every((value, component) => Math.abs(value - matrices[index * 16 + component]) < 1e-6) : Number.isNaN(sizes[index]) && matrices.slice(index * 16, index * 16 + 16).every(Number.isNaN), `${label}: meters/matrices/NaNs ${index}`);
              });
              check(matrices.slice(list.length * 16).every(v => v === sentinel) && sizes.slice(list.length).every(v => v === sentinel), `${label}: unused tails preserved`);
            }
            try {
              await next(frame => {
                handResult(frame, joints.flat(), joints.flat().map(() => true), 'both tracked hands');
                check(other.XRFrame.prototype.fillJointRadii.call(frame, [first, tip], radii) && Math.abs(radii[0] - first._radius) < 1e-8, 'iframe radius method accepts parent joints');
                for (const output of [new Float32Array(3), new Float32Array(8), new Float32Array(12).subarray(2, 10), new other.Float32Array(8)]) {
                  const backing = new Float32Array(output.buffer).fill(sentinel);
                  check(frame.fillJointRadii([first, tip, first], output), 'exact/oversized/subarray/cross-realm radius buffers');
                  check(Math.abs(output[0] - 0.018) < 1e-8 && Math.abs(output[1] - 0.007) < 1e-8 && output[0] === output[2], 'duplicate radius entries in input order and meters');
                  check(backing.every((value, index) => index >= output.byteOffset / 4 && index < output.byteOffset / 4 + 3 || value === sentinel), 'radius offsets and unused elements preserved');
                }
                const disguised = new Float32Array(3); Object.defineProperties(disguised, {length: {value: 0}, set: {value: null}, fill: {value: null}});
                check(frame.fillJointRadii([first, first], disguised) && disguised[0] === disguised[1] && disguised[0] > 0, 'radii ignore shadowed length/set/fill and permit reuse');
                untouched(radii, () => frame.fillJointRadii([first, foreignJoint!], radii), 'InvalidStateError', 'late foreign joint leaves output unchanged');
                untouched(radii.subarray(0, 1), () => frame.fillJointRadii([first, foreignJoint!], radii.subarray(0, 1)), 'InvalidStateError', 'late foreign joint precedes short capacity');
                untouched(radii.subarray(0, 1), () => frame.fillJointRadii([first, survivor], radii.subarray(0, 1)), 'TypeError', 'short radius buffer unchanged');
                untouched(radii, () => frame.fillJointRadii([first, Object.create(w.XRJointSpace.prototype)], radii), 'TypeError', 'late forged joint leaves output unchanged');
                untouched(radii, () => frame.fillJointRadii([first, new Proxy(first, {})], radii), 'TypeError', 'proxy joint rejected');
                let consumed = 0;
                check(frame.fillJointRadii((function* () { consumed++; yield survivor; yield first; })(), radii) && consumed === 1, 'one-shot joint generator converted once');
                // Controlled tracking-loss fixture: remove the native hand slot only
                // during synchronous reads, after the real adapter sampled the frame.
                // Restore before the next adapter tick, without a production test API.
                const descriptor = Object.getOwnPropertyDescriptor(device.gamepads, '0')!;
                try {
                  delete (device.gamepads as unknown as Record<number, unknown>)[0];
                  handResult(frame, joints.flat(), joints.flat().map((_joint, index) => index >= 25), 'one hand tracking lost');
                  check(!frame.fillPoses(joints[1], first, new Float32Array(400)), 'lost joint can be unavailable base');
                  check(frame.fillJointRadii(joints[1], radii), 'valid radii independent of unavailable base');
                } finally { Object.defineProperty(device.gamepads, '0', descriptor); }
              });
              await next(frame => {
                check(session.inputSources[0] === sources[0] && session.inputSources[1] === sources[1] && sources[0].hand!.get('wrist') === first, 'tracking recovery preserves source and joint identities');
                handResult(frame, joints.flat(), joints.flat().map(() => true), 'tracking recovered');
              });
              device.gamepadInputSources[0].active = false;
              await next(frame => {
                check(session.inputSources.length === 1 && session.inputSources[0] === sources[1] && sources[1].hand!.get('wrist') === survivor, 'surviving source and joint identities stable after removal');
                handResult(frame, joints.flat(), joints.flat().map((_joint, index) => index >= 25), 'retired hand mixed with survivor');
              });
              device.gamepadInputSources[0].active = true;
              await next(frame => {
                const recovered = session.inputSources[0];
                check(recovered !== sources[0] && recovered.hand!.get('wrist') !== first && session.inputSources[1] === sources[1], 'reacquisition exposes new hand while survivor stays stable');
                handResult(frame, [...joints[0], ...recovered.hand!.values()], joints[0].map(() => false).concat(joints[0].map(() => true)), 'retired joints remain unavailable after reacquisition');
              });
              let eventFrame!: Runtime.XRFrame, eventError: unknown;
              let events = 0;
              const onInput = (event: Event) => {
                try {
                  const input = event as Runtime.XRInputSourceEvent; eventFrame = input.frame; events++;
                  check(!eventFrame._animation && eventFrame.fillPoses([input.inputSource.targetRaySpace], base, poses) && eventFrame.fillJointRadii(input.inputSource.hand!.values(), radii), 'active input-event frame allows bulk methods');
                } catch (error) { eventError = error; }
              };
              session.addEventListener('selectstart', onInput);
              try {
                device._updateInputButtonPressed(true, 0, 0); await next(() => {});
                if (eventError) throw eventError;
                check(events === 1, 'real adapter emitted active input event');
                throws(() => eventFrame.fillJointRadii([], radii), 'InvalidStateError', 'retained event frame inactive');
              } finally { session.removeEventListener('selectstart', onInput); device._updateInputButtonPressed(false, 0, 0); }
            } finally { device.gamepadInputSources.forEach((input, index) => { input.active = savedActive[index]; }); }
          }
          if (handheld && sessionMode !== 'inline') {
            let eventError: unknown, eventFrame: Runtime.XRFrame | undefined;
            const onInput = (event: Event) => {
              try {
                const input = event as Runtime.XRInputSourceEvent; eventFrame = input.frame;
                check(!input.inputSource.hand && eventFrame.fillPoses([input.inputSource.targetRaySpace], base, poses) && eventFrame.fillJointRadii([], radii), 'Android active input-event bulk poses and empty radii');
              } catch (error) { eventError = error; }
            };
            session.addEventListener('selectstart', onInput);
            try {
              session._device._updateInputButtonPressed(true, 0, 0); await next(() => {});
              if (eventError) throw eventError;
              check(eventFrame, 'Android real adapter emitted active input event');
              throws(() => eventFrame!.fillPoses([], base, poses), 'InvalidStateError', 'Android retained event frame inactive');
            } finally { session.removeEventListener('selectstart', onInput); session._device._updateInputButtonPressed(false, 0, 0); }
          }
          await session.end();
          untouched(poses, () => other.XRFrame.prototype.fillPoses.call(held, [base], base, poses), 'InvalidStateError', 'borrowed iframe method retains shutdown validation');
          untouched(poses, () => held.fillPoses([base], base, poses), 'InvalidStateError', 'session shutdown rejects bulk poses without writes');
          untouched(radii, () => held.fillJointRadii([], radii), 'InvalidStateError', 'session shutdown rejects bulk radii without writes');
        } finally { await test.close(); }
      }
      context = 'iframe';
      let childFrame!: Runtime.XRFrame;
      await childTest.next(frame => {
        childFrame = frame;
        check(frame instanceof other.Object && Object.getPrototypeOf(other.XRFrame.prototype) === other.Object.prototype, 'iframe frame preserves its realm prototype chain');
        const poses = new Float32Array(32).fill(sentinel), radii = new Float32Array(3).fill(sentinel);
        check(w.XRFrame.prototype.fillPoses.call(frame, [childTest.base], childTest.base, poses) && poses[0] === 1 && poses.slice(16).every(v => v === sentinel), 'parent pose method accepts iframe receiver and owned spaces');
        check(w.XRFrame.prototype.fillJointRadii.call(frame, childJoint ? [childJoint] : [], radii) && (childJoint ? Math.abs(radii[0] - childJoint._radius) < 1e-8 : radii[0] === sentinel), 'parent radius method accepts iframe receiver and joints');
        untouched(poses, () => w.XRFrame.prototype.fillPoses.call(frame, [foreign.base], childTest.base, poses), 'InvalidStateError', 'parent space reaches iframe ownership check');
      });
      const inactiveOutput = new Float32Array(16);
      untouched(inactiveOutput, () => w.XRFrame.prototype.fillPoses.call(childFrame, [], childTest.base, inactiveOutput), 'InvalidStateError', 'parent method checks inactive iframe receiver');
      untouched(inactiveOutput, () => w.XRFrame.prototype.fillJointRadii.call(childFrame, [], inactiveOutput), 'InvalidStateError', 'parent radius method checks inactive iframe receiver');
    } finally { if (child) await child.close(); realm.remove(); }
    return {mode, handheld, assertions: passed.length, passed, skipped};
  }, {mode, handheld}); } finally { await page.locator('#bulk-interface-realm').evaluateAll(frames => frames.forEach(frame => frame.remove())); }
}

/** A real window.open() injection must share interface brands with its opener. */
export async function runPopupBulkFrame(page: Page, mode: SessionMode, handheld: boolean) {
  const opened = page.waitForEvent('popup');
  const handle = await page.evaluateHandle(() => window.open('/frame'));
  const popup = await opened;
  try {
    await popup.waitForLoadState();
    await popup.waitForFunction(() => !!(window as unknown as TestWindow).XRFrame);
    return await page.evaluate(async ({popupWindow, mode, handheld}) => {
      const w = window as unknown as TestWindow;
      const other = popupWindow as unknown as TestWindow & {EventTarget: typeof EventTarget};
      const passed: string[] = [];
      let context = '';
      const sentinel = 12345;
      function check(value: unknown, label: string): asserts value {
        if (!value) throw new Error(`${context}: ${label}`);
        passed.push(`${context}: ${label}`);
      }
      function untouched(output: Float32Array, action: () => unknown, name: string, label: string) {
        output.fill(sentinel);
        let error: unknown; try { action(); } catch (caught) { error = caught; }
        check(error !== null && typeof error === 'object' && (error as Error).name === name, `${label}: ${name} (got ${String(error)})`);
        check(output.every(value => value === sentinel), `${label}: no output writes`);
      }
      async function setup(realm: Window, sessionMode: SessionMode) {
        const api = realm as unknown as TestWindow;
        const session = await api.navigator.xr.requestSession(sessionMode, {requiredFeatures: !handheld && sessionMode !== 'inline' ? ['hand-tracking'] : []});
        const canvas = realm.document.createElement('canvas'); realm.document.body.append(canvas);
        session.updateRenderState({baseLayer: new api.XRWebGLLayer(session, canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!)});
        const base = await session.requestReferenceSpace('viewer');
        const next = <T>(read: (frame: Runtime.XRFrame) => T) => new Promise<T>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Popup bulk frame timeout')), 5000);
          session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(read(frame)); } catch (error) { reject(error); } });
        });
        const close = async () => { try { if (!session.ended) await session.end(); } finally { canvas.remove(); } };
        return {session, base, next, close};
      }
      check(popupWindow!.opener === window && popupWindow!.parent === popupWindow, 'fixture is a popup with a real opener');
      check(other.XRFrame !== w.XRFrame && other.XRSpace !== w.XRSpace, 'popup has separate injected interface constructors');
      for (const sessionMode of ['inline', mode] as const) {
        context = sessionMode;
        const parent = await setup(window, sessionMode);
        let child: Awaited<ReturnType<typeof setup>> | undefined;
        try {
          child = await setup(popupWindow!, sessionMode);
          const childTest = child;
          check(childTest.base instanceof other.EventTarget && !(childTest.base instanceof w.XRSpace), 'popup space retains its realm inheritance');
          const parentJoint = await parent.next(() => parent.session.inputSources[0]?.hand?.get('wrist'));
          const childJoint = await childTest.next(() => childTest.session.inputSources[0]?.hand?.get('wrist'));
          check(handheld || sessionMode === 'inline' || !!parentJoint && !!childJoint, 'Quest immersive fixture exposes genuine joints in both windows');
          for (const [owned, foreign, ownAPI, borrowedAPI, joint, foreignJoint, direction] of [
            [parent, childTest, w, other, parentJoint, childJoint, 'popup to opener'],
            [childTest, parent, other, w, childJoint, parentJoint, 'opener to popup'],
          ] as const) {
            context = `${sessionMode} ${direction}`;
            let held!: Runtime.XRFrame;
            const poses = new Float32Array(48), radii = new Float32Array(3);
            const borrowedPoses = borrowedAPI.XRFrame.prototype.fillPoses;
            const borrowedRadii = borrowedAPI.XRFrame.prototype.fillJointRadii;
            await owned.next(frame => {
              held = frame;
              poses.fill(sentinel); radii.fill(sentinel);
              check(borrowedPoses.call(frame, [owned.base], owned.base, poses) && poses[0] === 1 && poses.slice(16).every(v => v === sentinel), 'borrowed pose method accepts genuine receiver and owned spaces');
              check(borrowedRadii.call(frame, joint ? [joint] : [], radii) && (joint ? Math.abs(radii[0] - joint._radius) < 1e-8 : radii[0] === sentinel) && radii.slice(1).every(v => v === sentinel), 'borrowed radius method accepts genuine receiver and owned joints');
              for (const method of [ownAPI.XRFrame.prototype.fillPoses, borrowedPoses]) {
                untouched(poses, () => method.call(frame, [owned.base, foreign.base], owned.base, poses), 'InvalidStateError', 'late foreign popup/opener space reaches ownership validation');
                untouched(poses, () => method.call(frame, [], foreign.base, poses), 'InvalidStateError', 'foreign popup/opener base checked for empty input');
                untouched(poses, () => method.call(frame, [owned.base, foreign.base], owned.base, poses.subarray(0, 1)), 'InvalidStateError', 'foreign ownership precedes short pose capacity');
                for (const fake of [Object.create(borrowedAPI.XRSpace.prototype), new Proxy(foreign.base, {})]) {
                  untouched(poses, () => method.call(frame, [fake], owned.base, poses), 'TypeError', 'popup/opener space forgery and proxy rejected');
                  untouched(poses, () => method.call(frame, [], fake, poses), 'TypeError', 'popup/opener base forgery and proxy rejected');
                }
              }
              for (const method of [ownAPI.XRFrame.prototype.fillJointRadii, borrowedRadii]) {
                if (foreignJoint) {
                  untouched(radii, () => method.call(frame, joint ? [joint, foreignJoint] : [foreignJoint], radii), 'InvalidStateError', 'late foreign popup/opener joint reaches ownership validation');
                  untouched(radii, () => method.call(frame, [foreignJoint], radii.subarray(0, 0)), 'InvalidStateError', 'foreign joint ownership precedes short radius capacity');
                  untouched(radii, () => method.call(frame, [new Proxy(foreignJoint, {})], radii), 'TypeError', 'popup/opener joint proxy rejected');
                }
                untouched(radii, () => method.call(frame, [Object.create(borrowedAPI.XRJointSpace.prototype)], radii), 'TypeError', 'popup/opener joint forgery rejected');
              }
              for (const fake of [Object.create(ownAPI.XRFrame.prototype), new Proxy(frame, {})]) {
                untouched(poses, () => borrowedPoses.call(fake, [], owned.base, poses), 'TypeError', 'borrowed pose method rejects forged/proxy receiver');
                untouched(radii, () => borrowedRadii.call(fake, [], radii), 'TypeError', 'borrowed radius method rejects forged/proxy receiver');
              }
            });
            untouched(poses, () => borrowedPoses.call(held, [], owned.base, poses), 'InvalidStateError', 'borrowed popup/opener method preserves inactive frame check');
            untouched(radii, () => borrowedRadii.call(held, [], radii), 'InvalidStateError', 'borrowed popup/opener radius method preserves inactive frame check');
          }
        } finally { try { if (child) await child.close(); } finally { await parent.close(); } }
      }
      return {mode, handheld, assertions: passed.length, passed, skipped: []};
    }, {popupWindow: handle, mode, handheld});
  } finally { await popup.close(); await handle.dispose(); }
}

/** COOP/COEP page exposes shared buffers that the ordinary smoke page cannot. */
export async function runSharedBulkFrame(page: Page) {
  await page.evaluate('globalThis.__name = value => value');
  return page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const passed: string[] = [], skipped: string[] = [];
    function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed.push(label); }
    check(crossOriginIsolated, 'shared-buffer fixture is cross-origin isolated');
    if (typeof SharedArrayBuffer === 'undefined') return {passed, skipped: ['SharedArrayBuffer unavailable even with cross-origin isolation']};
    const session = await w.navigator.xr.requestSession('inline');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const realm = document.createElement('iframe'); document.body.append(realm);
    try {
      session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!)});
      const base = await session.requestReferenceSpace('viewer');
      const other = realm.contentWindow as unknown as {SharedArrayBuffer: typeof SharedArrayBuffer; Float32Array: typeof Float32Array};
      const growable = new (SharedArrayBuffer as unknown as new (length: number, options: {maxByteLength: number}) => SharedArrayBuffer & {growable: boolean})(256, {maxByteLength: 512});
      const outputs = [new Float32Array(new SharedArrayBuffer(256)), new other.Float32Array(new other.SharedArrayBuffer(256))];
      if (growable.growable) outputs.push(new Float32Array(growable), new Float32Array(growable, 8, 16));
      else skipped.push('Growable SharedArrayBuffer unavailable');
      let held!: Runtime.XRFrame;
      function rejected(frame: Runtime.XRFrame, output: Float32Array, label: string) {
        for (const action of [() => frame.fillPoses([], base, output), () => frame.fillPoses([base], base, output), () => frame.fillJointRadii([], output)]) {
          output.fill(12345);
          let error: unknown; try { action(); } catch (caught) { error = caught; }
          check(error instanceof TypeError, `${label}: shared backing rejected during conversion`);
          check(output.every(value => value === 12345), `${label}: shared output unchanged`);
        }
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Shared buffer frame timeout')), 5000);
        session.requestAnimationFrame((_time, frame) => {
          clearTimeout(timeout);
          try { held = frame; outputs.forEach((output, index) => rejected(frame, output, `active variant ${index}`)); resolve(); }
          catch (error) { reject(error); }
        });
      });
      outputs.forEach((output, index) => rejected(held, output, `inactive variant ${index}`));
    } finally { await session.end(); canvas.remove(); realm.remove(); }
    return {assertions: passed.length, passed, skipped};
  });
}
