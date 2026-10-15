import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Geometry from '../src/polyfill/api/geometry';
import type * as Sensing from '../src/polyfill/api/sensing';
import type * as Layers from '../src/polyfill/api/layers';
import type XRRay from '../src/polyfill/api/XRRay';

type TestWindow = typeof Runtime & typeof Geometry & typeof Sensing & typeof Layers & {
  navigator: {xr: Runtime.XRSystem}; XRRay: typeof XRRay;
};

/** Focused spec assertions against the actual unpacked extension, not a mocked device. */
export async function runConformance(page: Page, mode: SessionMode, handheld: boolean) {
  // tsx preserves nested function names via this helper; Playwright serializes
  // the callback without its Node module scope. It is a harness-only identity.
  await page.evaluate('globalThis.__name = value => value');
  return page.evaluate(async ({mode, handheld}) => {
    const xr = window as unknown as TestWindow;
    const passed: string[] = [];
    function check(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); passed.push(label); }
    async function rejects(operation: () => unknown, name: string, label: string) {
      let error: unknown;
      try { const promise = operation(); check(promise instanceof Promise, `${label}: returns a promise`); await promise; } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, `${label}: ${name} (got ${String(error)})`);
    }
    function throws(operation: () => unknown, name: string, label: string) {
      let error: unknown; try { operation(); } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, `${label}: ${name} (got ${String(error)})`);
    }
    check(['XRSystem', 'XRSession', 'XRFrame', 'XRSpace', 'XRReferenceSpace', 'XRRigidTransform', 'XRWebGLLayer', 'XRWebGLBinding', 'XRAnchor', 'XRHand', 'XRJointPose', 'XRCPUDepthInformation', 'XRLightProbe'].every(name => typeof (window as unknown as Record<string, unknown>)[name] === 'function'), 'public constructors installed');
    await rejects(() => xr.navigator.xr.isSessionSupported('invalid' as SessionMode), 'TypeError', 'invalid support mode');
    await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['unbounded']}), 'NotSupportedError', 'unimplemented reference space required');
    await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['not-a-real-feature']}), 'NotSupportedError', 'unknown required feature');
    if (handheld) await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['hand-tracking']}), 'NotSupportedError', 'phone hand tracking required');
    if (mode === 'immersive-vr') await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['hit-test']}), 'NotSupportedError', 'VR hit test required');
    if (mode === 'immersive-ar') {
      await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['dom-overlay']}), 'NotSupportedError', 'required overlay missing root');
      await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['depth-sensing'], depthSensing: {usagePreference: ['gpu-optimized'], dataFormatPreference: ['float32']}}), 'NotSupportedError', 'GPU depth required');
      await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['depth-sensing'], depthSensing: {usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha']}}), 'NotSupportedError', 'unsupported depth format required');
    }
    await rejects(() => xr.navigator.xr.requestSession(mode, {requiredFeatures: ['dom-overlay'], domOverlay: {root: document.body}}), 'NotSupportedError', 'DOM overlay compositor unavailable');
    const inline = await xr.navigator.xr.requestSession('inline', {optionalFeatures: ['anchors', 'layers', 'hand-tracking', 'hit-test', 'dom-overlay']});
    const inlineSpace = await inline.requestReferenceSpace('viewer');
    check(inline.enabledFeatures.join(',') === 'viewer', 'inline excludes immersive features');
    await rejects(() => inline.requestHitTestSource({space: inlineSpace}), 'NotSupportedError', 'hit source without feature');
    const overlay = document.createElement('div'); const overlayButton = document.createElement('button'); overlayButton.textContent = 'Conformance overlay'; Object.assign(overlayButton.style, {width: '100%', height: '100%', backgroundColor: 'transparent'}); overlay.append(overlayButton); document.body.append(overlay);
    const features = ['layers', ...(!handheld ? ['hand-tracking'] : []), ...(mode === 'immersive-ar' ? ['anchors', 'hit-test', 'depth-sensing', 'light-estimation'] : [])];
    const session = await xr.navigator.xr.requestSession(mode, {requiredFeatures: features, optionalFeatures: ['not-a-real-feature', 'bounded-floor', 'unbounded', 'dom-overlay'], domOverlay: {root: overlay}, depthSensing: {usagePreference: ['cpu-optimized'], dataFormatPreference: ['float32']}});
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
    try {
      check(Object.isFrozen(session.enabledFeatures) && features.every(feature => session.enabledFeatures.includes(feature)) && !session.enabledFeatures.includes('not-a-real-feature'), 'enabledFeatures reflects negotiated capabilities');
      check(session.environmentBlendMode === (mode === 'immersive-ar' ? 'alpha-blend' : 'opaque'), 'AR/VR environment blend mode');
      check(inline.visibilityState === 'hidden', 'inline hidden during immersive presentation');
      const newInline = await xr.navigator.xr.requestSession('inline');
      check(newInline.visibilityState === 'hidden', 'new inline session hidden during immersive presentation'); await newInline.end();
      await rejects(() => xr.navigator.xr.requestSession(mode), 'InvalidStateError', 'duplicate immersive session');
      await rejects(() => session.requestReferenceSpace('local-floor'), 'NotSupportedError', 'unrequested reference space');
      await rejects(() => session.requestReferenceSpace('invalid'), 'TypeError', 'invalid reference space enum');
      const reference = await session.requestReferenceSpace('local');
      const viewer = await session.requestReferenceSpace('viewer');
      const offset = reference.getOffsetReferenceSpace(new xr.XRRigidTransform({x: 1}));
      const nested = offset.getOffsetReferenceSpace(new xr.XRRigidTransform({z: 1}));
      throws(() => new xr.XRRigidTransform({w: 0}), 'TypeError', 'non-point translation');
      throws(() => new xr.XRRigidTransform({}, {x: 0, y: 0, z: 0, w: 0}), 'InvalidStateError', 'zero quaternion');
      const normalized = new xr.XRRigidTransform({}, {y: 2, w: 2});
      check(Math.abs(Math.hypot(normalized.orientation.y, normalized.orientation.w) - 1) < 1e-6 && normalized.inverse.inverse === normalized, 'normalized quaternion and inverse identity');
      throws(() => new xr.XRRay({}, {z: 0}), 'TypeError', 'zero ray');
      const ray = new xr.XRRay({}, {x: 1, y: 0, z: 0});
      check(Math.abs(-ray.matrix[8] - 1) < 1e-6, 'ray matrix rotates negative Z to direction');
      const gl = canvas.getContext('webgl2', {alpha: true, preserveDrawingBuffer: true, xrCompatible: true} as WebGLContextAttributes)!;
      check(!!gl, 'WebGL2 available');
      check(new xr.XRWebGLLayer(session, gl) instanceof xr.XRWebGLLayer, 'xrCompatible context creation flag');
      await gl.makeXRCompatible();
      const legacy = new xr.XRWebGLLayer(session, gl); session.updateRenderState({baseLayer: legacy});
      function nextFrame<T>(callback: (frame: Runtime.XRFrame) => T): Promise<T> { return new Promise((resolve, reject) => session.requestAnimationFrame((_time, frame) => { try { resolve(callback(frame)); } catch (error) { reject(error); } })); }
      let savedFrame!: Runtime.XRFrame;
      const sequence: number[] = [];
      const cancelled = session.requestAnimationFrame(() => sequence.push(99)); session.cancelAnimationFrame(cancelled);
      session.requestAnimationFrame(() => sequence.push(1)); session.requestAnimationFrame(() => sequence.push(2));
      await nextFrame(frame => {
        savedFrame = frame;
        check(sequence.join(',') === '1,2', 'RAF registration ordering and cancellation');
        check(Number.isFinite(frame.predictedDisplayTime), 'finite predicted display time');
        throws(() => frame.getPose(viewer, inlineSpace), 'InvalidStateError', 'cross-session base space');
        const pose = frame.getViewerPose(reference)!;
        check(pose.views.length === (handheld ? 1 : 2) && pose.views[0].eye === (handheld ? 'none' : 'left'), 'profile view count and eye');
        check(frame.getPose(viewer, offset)!.transform.position.x === pose.transform.position.x - 1, 'offset viewer pose');
        const relative = frame.getPose(nested, reference)!.transform.position;
        check(relative.x === 1 && relative.z === 1, 'nested offsets compose for arbitrary spaces');
        check(pose.views.some(view => legacy.getViewport(view).width > 0), 'legacy viewports');
        if (!handheld) {
          check(session.inputSources.length === 2, 'Quest two persistent input sources');
          const input = session.inputSources[0] as Runtime.XRInputSource;
          check(input.hand instanceof xr.XRHand && input.hand.size === 25 && [...input.hand].length === 25, 'Quest articulated hand collection');
          const joint = input.hand.get('index-finger-tip'); const jointPose = frame.getJointPose(joint, reference)!;
          check(jointPose instanceof xr.XRJointPose && jointPose.radius > 0, 'joint pose and radius');
          const radii = new Float32Array(25); const poses = new Float32Array(400);
          check(frame.fillJointRadii(input.hand.values(), radii) && frame.fillPoses(input.hand.values(), reference, poses) && radii.every(value => value > 0), 'bulk hand poses and radii');
          throws(() => frame.fillPoses(input.hand!.values(), reference, new Float32Array(1)), 'TypeError', 'short pose buffer');
        }
        return frame;
      });
      if (!handheld) {
        const order: string[] = [];
        for (const type of ['selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend']) {
          session.addEventListener(type, event => {
            const input = event as Runtime.XRInputSourceEvent;
            order.push(type);
            check(!!input.frame.getPose(input.inputSource.targetRaySpace, reference), `${type} event has an active input pose`);
            throws(() => input.frame.getViewerPose(reference), 'InvalidStateError', `${type} event is not an animation frame`);
          });
        }
        const press = (pressed: boolean, buttonIndex: number) => window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex, pressed}}));
        press(true, 0); press(true, 1);
        await nextFrame(() => check(order.join(',') === 'selectstart,squeezestart', 'select/squeeze start ordering'));
        press(false, 0); press(false, 1);
        await nextFrame(() => check(order.join(',') === 'selectstart,squeezestart,select,selectend,squeeze,squeezeend', 'frame-by-frame select/squeeze release ordering'));
      }
      throws(() => savedFrame.getViewerPose(reference), 'InvalidStateError', 'inactive frame viewer pose');
      throws(() => savedFrame.getPose(viewer, reference), 'InvalidStateError', 'inactive frame pose');
      if (mode === 'immersive-ar') {
        check(session.domOverlayState === null && !session.enabledFeatures.includes('dom-overlay'), 'unimplemented overlay is not advertised');
        check(session.depthUsage === 'cpu-optimized' && session.depthDataFormat === 'float32', 'CPU depth format negotiation');
        await rejects(() => session.requestHitTestSource({space: inlineSpace}), 'InvalidStateError', 'foreign hit test space');
        await rejects(() => session.requestHitTestSource({space: viewer, entityTypes: ['point']}), 'NotSupportedError', 'point-cloud entity unsupported');
        await rejects(() => session.requestHitTestSource({space: viewer, entityTypes: ['wrong']}), 'TypeError', 'invalid hit entity');
        const hit = await session.requestHitTestSource({space: viewer, entityTypes: ['plane', 'mesh']});
        const transient = await session.requestHitTestSourceForTransientInput({profile: 'not-touch'});
        const probe = await session.requestLightProbe();
        await rejects(() => session.requestLightProbe({reflectionFormat: 'rgba16f'}), 'NotSupportedError', 'unsupported reflection format');
        let anchor: Sensing.XRAnchor | undefined;
        let hitResult: import('../src/polyfill/api/XRHitTestResult').default | undefined;
        let depth: Sensing.XRCPUDepthInformation | null = null;
        // The packaged virtual room arrives over the isolated bridge asynchronously.
        for (let count = 0; count < 300 && (!hitResult || !depth); count++) {
          await nextFrame(frame => {
            const results = frame.getHitTestResults(hit); hitResult = results[0];
            check(frame.getHitTestResultsForTransientInput(transient).length === 0, 'transient profile must match exactly');
            if (hitResult) {
              const matrix = hitResult.getPose(reference)!.transform.matrix;
              check(Math.abs(Math.hypot(matrix[4], matrix[5], matrix[6]) - 1) < 1e-5 && Math.abs(matrix[5]) < 0.99, 'wall hit orientation carries its horizontal surface normal');
            }
            const view = frame.getViewerPose(reference)!.views[0]; depth = frame.getDepthInformation(view);
            if (depth) check(depth.data.byteLength === depth.width * depth.height * 4 && Number.isFinite(depth.getDepthInMeters(0.5, 0.5)), 'depth buffer float32 meters');
          });
        }
        check(!!hitResult && !!depth, 'room hit and depth available');
        throws(() => hitResult!.getPose(reference), 'InvalidStateError', 'inactive hit result pose');
        throws(() => depth!.getDepthInMeters(0.5, 0.5), 'InvalidStateError', 'inactive depth access');
        await nextFrame(frame => {
          const estimate = frame.getLightEstimate(probe)!;
          check(estimate.sphericalHarmonicsCoefficients.length === 27 && Math.abs(Math.hypot(estimate.primaryLightDirection.x, estimate.primaryLightDirection.y, estimate.primaryLightDirection.z) - 1) < 1e-6, 'virtual lighting estimate');
          const view = frame.getViewerPose(reference)!.views[0]; const info = frame.getDepthInformation(view)!;
          throws(() => info.getDepthInMeters(-0.1, 0.5), 'RangeError', 'out-of-range depth coordinate');
          void frame.createAnchor(new xr.XRRigidTransform({x: 0.4, z: -1}), reference).then(created => { anchor = created; });
        });
        await nextFrame(frame => { check(!!anchor && frame.trackedAnchors.has(anchor), 'anchor tracked across frames'); check(Math.abs(frame.getPose(anchor!.anchorSpace, reference)!.transform.position.x - 0.4) < 1e-5, 'anchor reference-space transform'); });
        const originalViewer = await nextFrame(frame => frame.getPose(viewer, reference)!.transform.position);
        if (!handheld) {
          window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [originalViewer.x + 0.3, originalViewer.y + 1.6, originalViewer.z], quaternion: [0, 0, 0, 1]}}));
          await nextFrame(frame => check(Math.abs(frame.getPose(anchor!.anchorSpace, reference)!.transform.position.x - 0.4) < 1e-5, 'anchor remains world-stable when viewer moves'));
          window.dispatchEvent(new CustomEvent('webxr-pose', {detail: {position: [originalViewer.x, originalViewer.y + 1.6, originalViewer.z], quaternion: [0, 0, 0, 1]}}));
        }
        const anchorSpace = anchor!.anchorSpace; anchor!.delete(); anchor!.delete();
        throws(() => anchor!.anchorSpace, 'InvalidStateError', 'deleted anchor space getter');
        await nextFrame(frame => check(frame.getPose(anchorSpace, reference) === null && !frame.trackedAnchors.has(anchor!), 'deleted anchor untracked'));
        hit.cancel(); transient.cancel();
        throws(() => hit.cancel(), 'InvalidStateError', 'repeated hit cancellation');
        await nextFrame(frame => throws(() => frame.getHitTestResults(hit), 'InvalidStateError', 'cancelled hit source on later frame'));
        session.pauseDepthSensing(); await nextFrame(frame => check(frame.getDepthInformation(frame.getViewerPose(reference)!.views[0]) === null, 'paused depth sensing')); session.resumeDepthSensing();
      }
      // Exercise real texture allocation, subimages and the compositor, then return to legacy.
      const binding = new xr.XRWebGLBinding(session, gl);
      const projection = binding.createProjectionLayer({depthFormat: gl.DEPTH_COMPONENT24});
      const quad = binding.createQuadLayer({space: reference, transform: new xr.XRRigidTransform({z: -1}), viewPixelWidth: 64, viewPixelHeight: 64, width: 1, height: 1, depthFormat: 0});
      throws(() => binding.createProjectionLayer({textureType: 'texture-array'}), 'NotSupportedError', 'unsupported layer texture array');
      session.updateRenderState({baseLayer: null, layers: [projection, quad]});
      const fbo = gl.createFramebuffer();
      await nextFrame(frame => {
        const views = frame.getViewerPose(reference)!.views;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        for (const view of views) {
          const image = binding.getViewSubImage(projection, view);
          check(gl.isTexture(image.colorTexture) && image.viewport.width > 0, 'projection subimage texture and viewport');
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
          gl.viewport(image.viewport.x, image.viewport.y, image.viewport.width, image.viewport.height);
          gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        const image = binding.getSubImage(quad, frame);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      });
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(pixels.some((value, index) => index % 4 === 2 && value > 200), 'projection layer is actually composited into the output');
      check(pixels.some((value, index) => index % 4 === 0 && value > 200), 'quad layer is actually composited into the output');
      await nextFrame(frame => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); const pixel = new Uint8Array(4);
        // Device clears the default framebuffer at start; render a layer in this frame
        // and inspect after the callback below instead.
        check(gl.getError() === gl.NO_ERROR, 'layers produce no WebGL errors');
        throws(() => binding.getViewSubImage(projection, savedFrame.getViewerPose(reference)!.views[0]), 'InvalidStateError', 'stale layer view');
        check(frame.getViewerPose(reference)!.views.length === (handheld ? 1 : 2), 'layers preserve view configuration');
        void pixel;
      });
      projection.destroy();
      await nextFrame(frame => throws(() => binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]), 'InvalidStateError', 'destroyed layer access'));
      session.updateRenderState({layers: null, baseLayer: legacy});
      await nextFrame(() => check(true, 'legacy rendering resumes after layers'));
      gl.deleteFramebuffer(fbo);
    } finally { if (!session.ended) await session.end(); if (!inline.ended) await inline.end(); canvas.remove(); overlay.remove(); }
    check(!overlay.hasAttribute('style') && session.domOverlayState === null, 'unsupported overlay leaves DOM unchanged');
    await rejects(() => session.requestReferenceSpace('viewer'), 'InvalidStateError', 'ended reference space request');
    await rejects(() => session.end(), 'InvalidStateError', 'repeated session end');
    check(session.inputSources.length === 0 && session.requestAnimationFrame(() => {}) === 0, 'ended input and animation lifecycle');
    if (!handheld) {
      const controllers = await xr.navigator.xr.requestSession(mode);
      const controllerCanvas = document.createElement('canvas'); document.body.append(controllerCanvas);
      const context = controllerCanvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!;
      try {
        controllers.updateRenderState({baseLayer: new xr.XRWebGLLayer(controllers, context)});
        const next = <T>(callback: () => T): Promise<T> => new Promise((resolve, reject) => controllers.requestAnimationFrame(() => { try { resolve(callback()); } catch (error) { reject(error); } }));
        const input = await next(() => controllers.inputSources[0]); const gamepad = input.gamepad!;
        check(input.hand === null && gamepad.mapping === 'xr-standard' && gamepad.axes.length === 4 && gamepad.axes[0] === 0 && gamepad.axes[1] === 0 && !gamepad.buttons[2].pressed, 'Quest controller mapping, placeholder axes/buttons and absent hand');
        check(input.profiles[0] === 'meta-quest-touch-plus', 'Quest Touch Plus profile');
        window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: true}}));
        await next(() => check(input.gamepad === gamepad && gamepad.buttons[0].pressed && gamepad.buttons[0].value === 1, 'gamepad identity and trigger press state across frames'));
        window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: false}}));
        await next(() => check(!gamepad.buttons[0].pressed && gamepad.buttons[0].value === 0, 'gamepad trigger release state across frames'));
      } finally { if (!controllers.ended) await controllers.end(); controllerCanvas.remove(); }
    }
    return {mode, handheld, assertions: new Set(passed).size, passed: [...new Set(passed)]};
  }, {mode, handheld});
}
