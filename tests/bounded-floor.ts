import {writeFile} from 'node:fs/promises';
import type {Page} from 'playwright';
import type {SessionOptions} from '../src/types/polyfill';
import type {SessionMode} from '../src/types/contracts';
import type * as Geometry from '../src/polyfill/api/geometry';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';

type XRWindow = typeof Geometry & typeof Runtime & typeof Layers & {navigator: {xr: Runtime.XRSystem}};

/** Public API and real rendered bounds in each unpacked-extension profile/mode. */
export async function runBoundedFloor(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate('globalThis.__name = value => value');
  const result = await page.evaluate(async ({mode, handheld}) => {
    const xr = window as unknown as XRWindow;
    const passed: string[] = [];
    function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed.push(label); }
    async function rejects(action: () => unknown, name: string, label: string) {
      let error: unknown; try { await action(); } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, label);
    }
    function throws(action: () => unknown, name: string, label: string) {
      let error: unknown; try { action(); } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, label);
    }
    async function start(options: SessionOptions = {}) {
      // Each session asks the real panel to synchronize all poses asynchronously.
      // Wait for that bridge round trip before issuing deterministic movement.
      const seen = new Set<string>();
      let listener: (event: Event) => void;
      let timeout: ReturnType<typeof setTimeout>;
      const ready = new Promise<void>((resolve, reject) => {
        listener = event => {
          seen.add(event.type === 'webxr-pose' ? 'head' : (event as CustomEvent).detail.objectName);
          if (seen.size === 3) resolve();
        };
        window.addEventListener('webxr-pose', listener);
        window.addEventListener('webxr-input-pose', listener);
        timeout = setTimeout(() => reject(new Error('Panel pose synchronization timed out')), 5000);
      });
      try { const session = await xr.navigator.xr.requestSession(mode, options); await ready; return session; }
      finally { clearTimeout(timeout!); window.removeEventListener('webxr-pose', listener!); window.removeEventListener('webxr-input-pose', listener!); }
    }
    const coordinates = (space: Geometry.XRBoundedReferenceSpace) => space.boundsGeometry.map(p => [p.x, p.y, p.z, p.w]);
    const expected = [[-1, 0, -1, 1], [1, 0, -1, 1], [1, 0, 1, 1], [-1, 0, 1, 1]];
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
    const matches = (a: number[][], b: number[][]) => a.length === b.length && a.every((p, i) => p.every((v, j) => near(v, b[i][j])));
    await rejects(() => xr.navigator.xr.requestSession('inline', {requiredFeatures: ['bounded-floor']}), 'NotSupportedError', 'inline required bounded-floor rejects');
    const inline = await xr.navigator.xr.requestSession('inline', {optionalFeatures: ['bounded-floor']});
    check(!inline.enabledFeatures.includes('bounded-floor'), 'inline optional bounded-floor omitted');
    await rejects(() => inline.requestReferenceSpace('bounded-floor'), 'NotSupportedError', 'inline cannot obtain bounded space');
    await inline.end();
    const unrequested = await start();
    await rejects(() => unrequested.requestReferenceSpace('bounded-floor'), 'NotSupportedError', 'bounded-floor requires explicit negotiation');
    await unrequested.end();
    for (const requirement of ['requiredFeatures', 'optionalFeatures'] as const) {
      const minimal = await start({[requirement]: ['bounded-floor']});
      try {
        check(await minimal.requestReferenceSpace('bounded-floor') instanceof xr.XRBoundedReferenceSpace && !minimal.enabledFeatures.includes('local-floor'), `${requirement}: bounded-floor works without requesting local-floor`);
      } finally { await minimal.end(); }
    }
    let previous: Geometry.XRBoundedReferenceSpace | undefined;
    for (const requirement of ['requiredFeatures', 'optionalFeatures'] as const) {
      const session = await start({[requirement]: ['bounded-floor', 'local-floor', 'unbounded']});
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
      const source = handheld ? session._device.gamepads[1].pose : {position: session._device.position, orientation: session._device.quaternion};
      const originalPosition = Array.from(source.position), originalOrientation = Array.from(source.orientation);
      const move = (position: number[], quaternion = [0, 0, 0, 1]) => window.dispatchEvent(new CustomEvent(handheld ? 'webxr-input-pose' : 'webxr-pose', {detail: {objectName: 'leftController', position, quaternion}}));
      try {
        check(session.enabledFeatures.includes('bounded-floor'), `${requirement}: bounded-floor enabled`);
        const space = await session.requestReferenceSpace('bounded-floor');
        check(space instanceof xr.XRBoundedReferenceSpace && space instanceof xr.XRReferenceSpace, 'bounded subclass and public constructor');
        const bounds = space.boundsGeometry;
        check(bounds === space.boundsGeometry && matches(coordinates(space), expected), 'stable native bounds identity and meter coordinates');
        check(Object.isFrozen(bounds) && bounds.every(p => p instanceof DOMPointReadOnly && Object.isFrozen(p)), 'frozen array and immutable DOMPointReadOnly vertices');
        check(!Reflect.set(bounds, '0', new DOMPointReadOnly()) && !Reflect.set(bounds[0], 'x', 999) && !Reflect.set(space, 'boundsGeometry', []), 'application mutation cannot change bounds');
        check(bounds.reduce((sum, a, i) => { const b = bounds[(i + 1) % 4]; return sum + a.x * b.z - b.x * a.z; }, 0) > 0, 'clockwise from above');
        const independent = await session.requestReferenceSpace('bounded-floor');
        check(independent instanceof xr.XRBoundedReferenceSpace && independent !== space && matches(coordinates(independent), expected), 'independent request has same authored region');
        const translation = new xr.XRRigidTransform({x: 0.5, y: 0.25, z: -0.5});
        const yaw = new xr.XRRigidTransform({}, {y: Math.SQRT1_2, w: Math.SQRT1_2});
        const translated = space.getOffsetReferenceSpace(translation);
        const rotated = space.getOffsetReferenceSpace(yaw);
        const nested = translated.getOffsetReferenceSpace(yaw).getOffsetReferenceSpace(new xr.XRRigidTransform({z: 0.5}));
        check([translated, rotated, nested].every(s => s instanceof xr.XRBoundedReferenceSpace && s !== space), 'all offset operations retain bounded subclass');
        check(matches(coordinates(translated), expected.map(([x, y, z, w]) => [x - 0.5, y - 0.25, z + 0.5, w])), 'translation uses inverse origin');
        check(matches(coordinates(rotated), expected.map(([x, y, z, w]) => [-z, y, x, w])), 'yaw uses inverse origin');
        const borrowed = xr.XRReferenceSpace.prototype.getOffsetReferenceSpace.call(space, translation);
        check(borrowed instanceof xr.XRBoundedReferenceSpace && matches(coordinates(borrowed), coordinates(translated)), 'borrowed base offset method preserves bounded subclass and geometry');
        const expectedNested = expected.map(([x, y, z, w]) => [-(z + 0.5), y - 0.25, x - 1, w]);
        check(matches(coordinates(nested), expectedNested), 'successive offsets use inverse cumulative origin once');
        // Include pitch: only native bounds must have y=0, effective bounds may tilt.
        const pitch = new xr.XRRigidTransform({}, {x: Math.SQRT1_2, w: Math.SQRT1_2});
        check(matches(coordinates(space.getOffsetReferenceSpace(pitch)), expected.map(([x, y, z, w]) => [x, z, -y, w])), 'tilted offset transforms effective floor points');
        await rejects(() => space.getOffsetReferenceSpace({} as Geometry.XRRigidTransform), 'TypeError', 'invalid bounded offset rejects');
        check(matches(coordinates(space), expected) && bounds === space.boundsGeometry, 'offset creation preserves original geometry');
        const floor = await session.requestReferenceSpace('local-floor'), local = await session.requestReferenceSpace('local'), unbounded = await session.requestReferenceSpace('unbounded');
        const viewer = await session.requestReferenceSpace('viewer');
        const gl = canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!;
        await gl.makeXRCompatible(); session.updateRenderState({baseLayer: new xr.XRWebGLLayer(session, gl)});
        function next<T>(callback: (frame: Runtime.XRFrame) => T) { return new Promise<T>((resolve, reject) => session.requestAnimationFrame((_time, frame) => { try { resolve(callback(frame)); } catch (error) { reject(error); } })); }
        await next(() => {}); // Apply pending presentation before movement.
        for (const position of [[0, 1.6, 0], [4, 2, -3]]) {
          let observed = false;
          // Panel/profile startup can still deliver a queued pose. Drive the
          // requested movement until the corresponding XR frame observes it.
          for (let attempt = 0; attempt < 20 && !observed; attempt++) {
            move(position);
            observed = await next(frame => {
              const pose = frame.getViewerPose(space)!;
              if (!near(pose.transform.position.x, position[0]) || !near(pose.transform.position.y, position[1]) || !near(pose.transform.position.z, position[2])) return false;
              check(true, 'viewer moves freely inside and outside bounds');
              check(frame.getViewerPose(floor)!.transform.matrix.every((v, i) => near(v, pose.transform.matrix[i])), 'bounded viewer agrees with local-floor');
              check(near(frame.getViewerPose(local)!.transform.position.y + 1.6, pose.transform.position.y) && near(frame.getViewerPose(unbounded)!.transform.position.y + 1.6, pose.transform.position.y), 'local and unbounded retain eye-height origin');
              check(frame.getPose(viewer, nested)!.transform.matrix.every((v, i) => near(v, frame.getViewerPose(nested)!.transform.matrix[i])), 'getPose and getViewerPose agree for nested bounded space');
              const toFloor = frame.getPose(nested, floor)!.transform;
              const fromFloor = frame.getPose(floor, nested)!.transform;
              for (let i = 0; i < 4; i++) {
                const effective = toFloor.matrix;
                const p = nested.boundsGeometry[i];
                const world = new DOMPoint(p.x, p.y, p.z, p.w).matrixTransform(DOMMatrix.fromFloat32Array(new Float32Array(effective)));
                const relative = new DOMPoint(...expected[i]).matrixTransform(DOMMatrix.fromFloat32Array(new Float32Array(fromFloor.matrix)));
                check(matches([[world.x, world.y, world.z, world.w]], [expected[i]]) && matches([[relative.x, relative.y, relative.z, relative.w]], [expectedNested[i]]), 'bounds and bidirectional pose transforms describe the same world border');
              }
              check(bounds === space.boundsGeometry && matches(coordinates(space), expected), 'viewer motion preserves native boundary');
              return true;
            });
          }
          check(observed, 'movement reaches the requested world pose');
        }
        const foreign = await xr.navigator.xr.requestSession('inline');
        const foreignSpace = await foreign.requestReferenceSpace('viewer');
        try {
          await next(frame => {
            throws(() => frame.getPose(foreignSpace, space), 'InvalidStateError', 'foreign source space rejected');
            throws(() => frame.getPose(space, foreignSpace), 'InvalidStateError', 'foreign base space rejected');
            if (previous) throws(() => frame.getViewerPose(previous!), 'InvalidStateError', 'old bounded space rejected in new session');
          });
        }
        finally { await foreign.end(); }
        // Keep a frame to verify shutdown checks before active-state checks.
        const retainedFrame = await next(frame => frame);
        previous = space;
        const pending = session.requestReferenceSpace('bounded-floor');
        const ending = session.end();
        check(await pending instanceof xr.XRBoundedReferenceSpace, 'session ended during bounded request still allocates');
        await ending;
        check(await session.requestReferenceSpace('bounded-floor') instanceof xr.XRBoundedReferenceSpace, 'ended session can request granted bounded space');
        await rejects(() => retainedFrame.getViewerPose(space), 'InvalidStateError', 'ended frame rejects bounded viewer pose');
        check(bounds === space.boundsGeometry && matches(coordinates(space), expected), 'ended space retains immutable bounds snapshot');
      } finally { move(originalPosition, originalOrientation); if (!session.ended) await session.end(); canvas.remove(); }
    }
    const device = unrequested._device, features = device.features;
    try {
      device.features = features.filter(feature => feature !== 'bounded-floor');
      await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['bounded-floor']}), 'NotSupportedError', 'configuration without authored boundary rejects required feature');
      const optional = await start({optionalFeatures: ['bounded-floor']});
      try {
        check(!optional.enabledFeatures.includes('bounded-floor'), 'configuration without boundary omits optional feature');
        await rejects(() => optional.requestReferenceSpace('bounded-floor'), 'NotSupportedError', 'unsupported configuration cannot produce empty bounded space');
      } finally { await optional.end(); }
    } finally { device.features = features; }
    return {mode, assertions: new Set(passed).size, passed: [...new Set(passed)]};
  }, {mode, handheld});
  console.log(`Bounded-floor API passed (${mode}, handheld=${handheld}); rendering outline`);
  type DemoState = {session: Runtime.XRSession; rendered: Promise<{frames: number; greenPixels: number; bounds: number[][]; vertices: number[]}>; restore: () => void; getState: () => unknown; capture: () => string};
  type DemoWindow = Window & {boundedDemo?: DemoState};
  try {
    const visual = await page.evaluate(async ({mode, handheld}) => {
      const url = '/examples/bounded-floor.js';
      const {startBoundedFloor} = await import(url) as {startBoundedFloor: (mode: SessionMode) => Promise<DemoState>};
      const seen = new Set<string>();
      let receive!: (event: Event) => void;
      const ready = new Promise<void>(resolve => {
        receive = event => {
          seen.add(event.type === 'webxr-pose' ? 'head' : (event as CustomEvent).detail.objectName);
          if (seen.size === 3) resolve();
        };
        window.addEventListener('webxr-pose', receive);
        window.addEventListener('webxr-input-pose', receive);
      });
      const demo = await startBoundedFloor(mode);
      (window as DemoWindow).boundedDemo = demo;
      await Promise.race([ready, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Demo panel pose synchronization timed out')), 5000))]);
      window.removeEventListener('webxr-pose', receive); window.removeEventListener('webxr-input-pose', receive);
      await new Promise<void>(resolve => demo.session.requestAnimationFrame(() => resolve()));
      const device = demo.session._device;
      const source = handheld ? device.gamepads[1].pose : {position: device.position, orientation: device.quaternion};
      const position = Array.from(source.position), quaternion = Array.from(source.orientation);
      const event = handheld ? 'webxr-input-pose' : 'webxr-pose';
      const externalPosition = Array.from(device.position), externalQuaternion = Array.from(device.quaternion);
      demo.restore = () => {
        window.dispatchEvent(new CustomEvent(event, {detail: {objectName: 'leftController', position, quaternion}}));
        if (handheld) window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: externalPosition, quaternion: externalQuaternion}}));
      };
      // Put the exterior camera behind the virtual phone so its outline is
      // visible in the screenshot as well as in the application's framebuffer.
      if (handheld) window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [0, 2.1, 2.8], quaternion: [-Math.sin(0.25), 0, 0, Math.cos(0.25)]}}));
      window.dispatchEvent(new CustomEvent(event, {detail: {objectName: 'leftController', position: [0, 1.6, 2], quaternion: [-Math.sin(0.2), 0, 0, Math.cos(0.2)]}}));
      const visual = await Promise.race([demo.rendered, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Demo render timed out: ' + JSON.stringify(demo.getState()))), 10000))]);
      if (JSON.stringify(visual.vertices) !== JSON.stringify(visual.bounds.flatMap(p => p.slice(0, 3)))) throw new Error('Outline vertices must come from runtime bounds');
      return visual;
    }, {mode, handheld});
    console.log('Bounded-floor outline pixels: ' + JSON.stringify(visual));
    await page.screenshot({path: `test-results/bounded-floor-${handheld ? 'phone' : 'quest'}-${mode}.png`});
    const applicationImage = await page.evaluate(() => (window as DemoWindow).boundedDemo!.capture());
    await writeFile(`test-results/bounded-floor-${handheld ? 'phone' : 'quest'}-${mode}-application.png`, Buffer.from(applicationImage.split(',')[1], 'base64'));
    if (!visual.greenPixels) throw new Error('Actual floor outline must render green pixels: ' + JSON.stringify(visual));
    return {...result, visual};
  } finally {
    await page.evaluate(async () => {
      const demo = (window as DemoWindow).boundedDemo;
      if (demo) { demo.restore?.(); if (!demo.session.ended) await demo.session.end(); delete (window as DemoWindow).boundedDemo; }
    });
  }
}
