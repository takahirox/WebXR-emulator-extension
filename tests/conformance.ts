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
    // Exercise the installed Three.js client, including its projection-layer path
    // for sessions that did not request the layers feature.
    const threeUrl = '/three.module.js'; const three = await import(threeUrl) as typeof import('three');
    for (const withLayers of [false, true]) {
      const client = await xr.navigator.xr.requestSession(mode, {requiredFeatures: ['local-floor', ...(withLayers ? ['layers'] : [])]});
      const renderer = new three.WebGLRenderer({antialias: false, preserveDrawingBuffer: true});
      renderer.setSize(640, 480); renderer.xr.enabled = true; document.body.append(renderer.domElement);
      const geometry = new three.BoxGeometry(0.5, 0.5, 0.5); const material = new three.MeshBasicMaterial({color: 0xff0000});
      const mesh = new three.Mesh(geometry, material); const scene = new three.Scene(); scene.add(mesh); scene.background = new three.Color(0x0000ff);
      try {
        await renderer.xr.setSession(client as unknown as XRSession);
        const layer = renderer.xr.getBaseLayer() as unknown as Layers.XRProjectionLayer;
        const size = renderer.getDrawingBufferSize(new three.Vector2());
        check(layer instanceof xr.XRProjectionLayer && layer.textureWidth > 0 && layer.textureHeight > 0 && size.x === layer.textureWidth && size.y === layer.textureHeight, `Three.js initializes usable projection dimensions (layers=${withLayers})`);
        if (!withLayers) {
          check(!client.enabledFeatures.includes('layers'), 'projection rendering does not implicitly enable layers');
          const binding = renderer.xr.getBinding() as unknown as Layers.XRWebGLBinding;
          const space = await client.requestReferenceSpace('local-floor');
          throws(() => binding.createQuadLayer({space, viewPixelWidth: 32, viewPixelHeight: 32}), 'NotSupportedError', 'quad creation still requires layers');
          const second = binding.createProjectionLayer();
          throws(() => client.updateRenderState({layers: [layer, second]}), 'NotSupportedError', 'multiple projections still require layers'); second.destroy();
        }
        await new Promise<void>((resolve, reject) => {
          let frames = 0;
          const timeout = setTimeout(() => { renderer.setAnimationLoop(null); reject(new Error('Three.js XR frames did not complete')); }, 15000);
          renderer.setAnimationLoop((_time, frame) => {
            if (!frame) return;
            try {
              const pose = frame.getViewerPose(renderer.xr.getReferenceSpace()!)!;
              mesh.position.set(0, 0, -2).applyMatrix4(new three.Matrix4().fromArray(pose.transform.matrix));
              renderer.render(scene, new three.PerspectiveCamera());
              const target = renderer.getRenderTarget()!;
              check(target.width > 0 && target.height > 0, `Three.js render target remains usable (layers=${withLayers})`);
              const gl = renderer.getContext();
              check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, `Three.js color and depth attachments have matching dimensions (layers=${withLayers})`);
              if (++frames === 3) { renderer.setAnimationLoop(null); clearTimeout(timeout); resolve(); }
            } catch (error) { renderer.setAnimationLoop(null); clearTimeout(timeout); reject(error); }
          });
        });
        const gl = renderer.getContext(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const red = pixels.filter((v, i) => i % 4 === 0 && v > 200).length; const blue = pixels.filter((v, i) => i % 4 === 2 && v > 200).length;
        // Three.js deliberately clears the background to transparent for AR.
        check(red > 0 && (mode === 'immersive-ar' || blue > 0), `Three.js mesh reaches the presentation canvas with the mode's background (layers=${withLayers})`);
        check(gl.getError() === gl.NO_ERROR, `Three.js projection rendering has no GL errors (layers=${withLayers})`);
      } finally { renderer.setAnimationLoop(null); if (!client.ended) await client.end(); renderer.dispose(); geometry.dispose(); material.dispose(); renderer.domElement.remove(); }
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
      for (const requirement of ['requiredFeatures', 'optionalFeatures'] as const) {
        for (const depthSensing of [
          {usagePreference: [], dataFormatPreference: []},
          {usagePreference: ['cpu-optimized'], dataFormatPreference: []},
          {usagePreference: [], dataFormatPreference: ['float32']},
        ]) {
          const depthSession = await xr.navigator.xr.requestSession(mode, {[requirement]: ['depth-sensing'], depthSensing});
          try {
            check(depthSession.enabledFeatures.includes('depth-sensing') && depthSession.depthUsage === 'cpu-optimized' && depthSession.depthDataFormat === 'float32', `${requirement}: empty depth preferences select supported defaults (${JSON.stringify(depthSensing)})`);
          } finally { await depthSession.end(); }
        }
        if (requirement === 'optionalFeatures') {
          const incompatible = await xr.navigator.xr.requestSession(mode, {optionalFeatures: ['depth-sensing'], depthSensing: {usagePreference: ['gpu-optimized'], dataFormatPreference: []}});
          try { check(!incompatible.enabledFeatures.includes('depth-sensing'), 'optional incompatible depth is omitted with an empty format preference'); } finally { await incompatible.end(); }
        }
      }
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
      const inlineCanvas = document.createElement('canvas');
      inline.updateRenderState({baseLayer: new xr.XRWebGLLayer(inline, inlineCanvas.getContext('webgl')!)});
      let inlineRendered = false;
      inline.requestAnimationFrame(() => { inlineRendered = true; });
      const inlineVisibility: string[] = [];
      inline.addEventListener('visibilitychange', () => inlineVisibility.push(inline.visibilityState));
      const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
      const setDocumentHidden = (hidden: boolean) => {
        Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
        document.dispatchEvent(new Event('visibilitychange'));
      };
      try {
        for (const hidden of [true, false, true, false]) {
          setDocumentHidden(hidden);
          check(inline.visibilityState === 'hidden', 'document visibility cannot reveal a suppressed inline session');
          check(session.visibilityState === (hidden ? 'hidden' : 'visible'), 'immersive session follows document visibility');
        }
        await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        check(!inlineRendered && inlineVisibility.length === 0, 'suppressed inline session retains queued frames without spurious visibility events');
      } finally {
        if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor); else Reflect.deleteProperty(document, 'hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      }
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
      const gl = canvas.getContext('webgl2', {alpha: true, stencil: true, preserveDrawingBuffer: true, xrCompatible: true} as WebGLContextAttributes)!;
      check(!!gl, 'WebGL2 available');
      check(new xr.XRWebGLLayer(session, gl) instanceof xr.XRWebGLLayer, 'xrCompatible context creation flag');
      await gl.makeXRCompatible();
      const legacy = new xr.XRWebGLLayer(session, gl); session.updateRenderState({baseLayer: legacy});
      function nextFrame<T>(callback: (frame: Runtime.XRFrame) => T): Promise<T> { return new Promise((resolve, reject) => session.requestAnimationFrame((_time, frame) => { try { resolve(callback(frame)); } catch (error) { reject(error); } })); }
      const depthEnabled = session.enabledFeatures.includes('depth-sensing');
      if (!depthEnabled) for (const property of ['depthUsage', 'depthDataFormat', 'depthType', 'depthActive'] as const) throws(() => session[property], 'InvalidStateError', `unconfigured ${property}`);
      for (const method of ['pauseDepthSensing', 'resumeDepthSensing'] as const) {
        throws(() => session[method](), 'InvalidStateError', `${method} outside animation frame`);
        await nextFrame(() => {
          if (depthEnabled) { session[method](); session[method](); check(session.depthActive === (method === 'resumeDepthSensing'), `${method} is effective and idempotent in a frame`); }
          else throws(() => session[method](), 'NotSupportedError', `${method} without feature in active frame`);
        });
        throws(() => session[method](), 'InvalidStateError', `${method} after animation frame`);
      }
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
        await nextFrame(() => session.pauseDepthSensing());
        await nextFrame(frame => { check(frame.getDepthInformation(frame.getViewerPose(reference)!.views[0]) === null, 'paused depth sensing persists across frames'); session.resumeDepthSensing(); });
        await nextFrame(frame => check(frame.getDepthInformation(frame.getViewerPose(reference)!.views[0]) !== null, 'resumed depth sensing returns data'));
      }
      // Exercise real texture allocation, subimages and the compositor, then return to legacy.
      const binding = new xr.XRWebGLBinding(session, gl);
      const unpackBuffer = gl.createBuffer(); const applicationTexture = gl.createTexture();
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBuffer); gl.bufferData(gl.PIXEL_UNPACK_BUFFER, 16, gl.STATIC_DRAW);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, applicationTexture);
      const projection = binding.createProjectionLayer({depthFormat: gl.DEPTH_COMPONENT24});
      const quad = binding.createQuadLayer({space: reference, transform: new xr.XRRigidTransform({z: -1}), viewPixelWidth: 64, viewPixelHeight: 64, width: 1, height: 1, depthFormat: 0});
      check(projection.textureWidth > 0 && projection.textureHeight > 0 && quad.textureWidth === 64 && quad.textureHeight === 64, 'layer dimensions initialized before the first frame');
      check(gl.getError() === gl.NO_ERROR && gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) === unpackBuffer && gl.getParameter(gl.TEXTURE_BINDING_2D) === applicationTexture && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE1, 'initial allocation preserves application unpack buffer and texture state');
      throws(() => binding.createProjectionLayer({textureType: 'texture-array'}), 'NotSupportedError', 'unsupported layer texture array');
      throws(() => session.updateRenderState({baseLayer: legacy, layers: [projection]}), 'NotSupportedError', 'one update cannot supply both layer properties');
      session.updateRenderState({layers: [projection, quad]});
      check(session.renderState.baseLayer === legacy, 'layer transition is pending until the next frame');
      const fbo = gl.createFramebuffer();
      await nextFrame(frame => {
        check(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) === unpackBuffer && gl.getParameter(gl.TEXTURE_BINDING_2D) === applicationTexture && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE1, 'frame allocation preserves application unpack buffer and texture state');
        check(session.renderState.baseLayer === null && session.renderState.layers?.[0] === projection, 'composition layers clear the active legacy base layer');
        const views = frame.getViewerPose(reference)!.views;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        for (const view of views) {
          const image = binding.getViewSubImage(projection, view);
          check(gl.isTexture(image.colorTexture) && image.viewport.width > 0, 'projection subimage texture and viewport');
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, image.depthStencilTexture, 0);
          check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR, 'resized layer color and depth attachments are complete with an application unpack buffer');
          gl.viewport(image.viewport.x, image.viewport.y, image.viewport.width, image.viewport.height);
          gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        const image = binding.getSubImage(quad, frame);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      });
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(pixels.some((value, index) => index % 4 === 2 && value > 200), 'projection layer is actually composited into the output');
      check(pixels.some((value, index) => index % 4 === 0 && value > 200), 'quad layer is actually composited into the output');
      await nextFrame(frame => {
        // Resize during the callback so MR's frame-start sizing cannot undo it
        // before getViewSubImage exercises reallocation.
        const width = projection.textureWidth; canvas.width += 2;
        const image = binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]);
        check(projection.textureWidth !== width && image.colorTextureWidth === gl.drawingBufferWidth, 'projection resources resize with the drawing buffer');
        check(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) === unpackBuffer && gl.getParameter(gl.TEXTURE_BINDING_2D) === applicationTexture && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE1, 'resize preserves application unpack buffer and texture state');
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, image.depthStencilTexture, 0);
        check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR, 'resizing with an application unpack buffer allocates complete color and depth attachments');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      });
      canvas.width -= 2;
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); gl.deleteBuffer(unpackBuffer); gl.bindTexture(gl.TEXTURE_2D, null); gl.deleteTexture(applicationTexture); gl.activeTexture(gl.TEXTURE0);
      session.updateRenderState({layers: [projection]});
      const sampler = gl.createSampler()!;
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      for (const cap of [gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) {
        await nextFrame(frame => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          const image = binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
          gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.stencilFunc(gl.NEVER, 0, 0xff); gl.sampleCoverage(0, false);
          gl.bindSampler(0, sampler); gl.activeTexture(gl.TEXTURE1); gl.enable(cap);
        });
        const pixel = new Uint8Array(4);
        gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        check(pixel.join(',') === '0,0,255,255', `compositor draws blue despite application capability ${cap}`);
        check(gl.isEnabled(cap) && gl.getParameter(gl.STENCIL_FUNC) === gl.NEVER && gl.getParameter(gl.SAMPLE_COVERAGE_VALUE) === 0 && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE1, `compositor restores application capability and parameters ${cap}`);
        gl.activeTexture(gl.TEXTURE0);
        check(gl.getParameter(gl.SAMPLER_BINDING) === sampler, 'compositor restores texture-unit-zero sampler');
        gl.disable(cap); gl.bindSampler(0, null);
      }
      gl.deleteSampler(sampler);
      for (const leaveFramebufferBound of [false, true]) {
        await nextFrame(frame => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          const image = binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
          gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.drawBuffers([gl.NONE]);
          if (leaveFramebufferBound) gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
        });
        check(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === (leaveFramebufferBound ? fbo : null), `composition restores draw framebuffer (${leaveFramebufferBound})`);
        if (leaveFramebufferBound) check(gl.getParameter(gl.DRAW_BUFFER0) === gl.COLOR_ATTACHMENT0, 'composition preserves application framebuffer draw buffer');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const pixel = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        check(pixel.join(',') === '0,0,255,255', `composition draws blue with default draw buffer NONE (${leaveFramebufferBound})`);
        check(gl.getParameter(gl.DRAW_BUFFER0) === gl.NONE && gl.getError() === gl.NO_ERROR, `composition restores default draw buffer without GL errors (${leaveFramebufferBound})`);
        gl.drawBuffers([gl.BACK]);
      }
      await nextFrame(frame => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        const image = binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
        gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.RASTERIZER_DISCARD);
      });
      for (let count = 0; count < 2; count++) {
        await nextFrame(frame => {
          check(gl.isEnabled(gl.RASTERIZER_DISCARD), `preparation restores rasterizer discard in consecutive frame ${count}`);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          const image = binding.getViewSubImage(projection, frame.getViewerPose(reference)!.views[0]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
          const pixel = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          check(pixel.join(',') === '0,0,0,0' && gl.getError() === gl.NO_ERROR, `layer clears stale blue with persistent rasterizer discard in frame ${count}`);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        });
      }
      gl.disable(gl.RASTERIZER_DISCARD);
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
      session.updateRenderState({baseLayer: legacy});
      session.updateRenderState({depthNear: 0.2});
      await nextFrame(() => check(session.renderState.baseLayer === legacy && session.renderState.layers === null && session.renderState.depthNear === 0.2, 'legacy rendering resumes after layers and retains other pending state'));
      // Repeated transitions before a frame must also use the latest pending state.
      session.updateRenderState({layers: [quad]}); session.updateRenderState({baseLayer: legacy}); session.updateRenderState({layers: [quad]});
      await nextFrame(() => check(session.renderState.baseLayer === null && session.renderState.layers?.[0] === quad, 'pending render-state transitions clear the alternate layer property'));
      session.updateRenderState({baseLayer: legacy});
      await nextFrame(() => check(session.renderState.layers === null, 'pending transition returns to legacy rendering'));
      gl.deleteFramebuffer(fbo);
      await session.end();
      check(String(inline.visibilityState) === 'visible' && inlineVisibility.join(',') === 'visible', 'ending immersive presentation restores inline visibility');
      await new Promise<void>(resolve => inline.requestAnimationFrame(() => resolve()));
      check(inlineRendered, 'queued inline frames resume after immersive presentation ends');
    } finally { if (!session.ended) await session.end(); if (!inline.ended) await inline.end(); canvas.remove(); overlay.remove(); }
    check(!overlay.hasAttribute('style') && session.domOverlayState === null, 'unsupported overlay leaves DOM unchanged');
    await rejects(() => session.requestReferenceSpace('viewer'), 'InvalidStateError', 'ended reference space request');
    await rejects(() => session.end(), 'InvalidStateError', 'repeated session end');
    for (const method of ['pauseDepthSensing', 'resumeDepthSensing'] as const) throws(() => session[method](), 'InvalidStateError', `${method} after session end`);
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
        const handlerError = new Error('Expected throwing XR onselectstart regression');
        let starts = 0; let reported = 0;
        const receiveError = (event: ErrorEvent) => { if (event.error === handlerError) { reported++; event.preventDefault(); } };
        window.addEventListener('error', receiveError);
        controllers.onselectstart = () => {
          for (const method of ['pauseDepthSensing', 'resumeDepthSensing'] as const) throws(() => controllers[method](), 'InvalidStateError', `${method} rejects input event frames`);
          starts++; throw handlerError;
        };
        try {
          window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: true}}));
          await Promise.race([
            (async () => { for (let count = 0; count < 3; count++) await next(() => check(gamepad.buttons[0].pressed, 'animation continues after throwing input handler')); })(),
            new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Throwing handler stopped XR rendering')), 3000)),
          ]);
          check(starts === 1 && reported === 1, 'throwing event property reports its error and commits held input state once');
          window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: false}}));
          await next(() => check(!gamepad.buttons[0].pressed, 'input release continues after throwing event property'));
        } finally { controllers.onselectstart = null; window.removeEventListener('error', receiveError); }
        window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: true}}));
        await next(() => check(input.gamepad === gamepad && gamepad.buttons[0].pressed && gamepad.buttons[0].value === 1, 'gamepad identity and trigger press state across frames'));
        window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex: 0, pressed: false}}));
        await next(() => check(!gamepad.buttons[0].pressed && gamepad.buttons[0].value === 0, 'gamepad trigger release state across frames'));
      } finally { if (!controllers.ended) await controllers.end(); controllerCanvas.remove(); }
    }
    // Exercise shutdown through real controller signals and the phone's screen
    // touch handlers. No private source maps or device callbacks are mocked.
    const shutdownHandlers = ['added', 'selectstart', 'select', 'selectend', ...(handheld ? ['removed'] : ['squeezestart', 'squeeze', 'squeezeend'])];
    for (const shutdownHandler of shutdownHandlers) {
      const inputSession = await xr.navigator.xr.requestSession(mode);
      const inputCanvas = document.createElement('canvas'); document.body.append(inputCanvas);
      const context = inputCanvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!;
      const order: string[] = [];
      const inputs: (Runtime.XRInputSource | undefined)[] = [];
      let shutdownIndex = -1; let endPromise: Promise<void> | undefined; let microtaskRan = false; let endWasQueued = false; let resolvedBeforeEnd = false; let framesAfterShutdown = 0;
      let resolveEnded!: () => void;
      const ended = new Promise<void>(resolve => { resolveEnded = resolve; });
      let resolveStarted!: () => void;
      const started = new Promise<void>(resolve => { resolveStarted = resolve; });
      const record = (type: string) => {
        order.push(type);
        if (type === shutdownHandler && shutdownIndex < 0) {
          shutdownIndex = order.length - 1;
          endPromise = inputSession.end().then(() => { resolvedBeforeEnd = !order.includes('end'); });
          queueMicrotask(() => { microtaskRan = true; });
        }
      };
      inputSession.addEventListener('inputsourceschange', event => {
        const change = event as Runtime.XRInputSourcesChangeEvent;
        record(change.added.length ? 'added' : 'removed');
      });
      for (const type of ['selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend']) {
        inputSession.addEventListener(type, event => {
          inputs.push((event as Runtime.XRInputSourceEvent).inputSource);
          record(type);
          if (type.endsWith('start')) resolveStarted();
        });
      }
      inputSession.addEventListener('end', () => { endWasQueued = microtaskRan; order.push('end'); resolveEnded(); });
      const render = () => {
        if (shutdownIndex >= 0) framesAfterShutdown++;
        inputSession.requestAnimationFrame(render);
      };
      const buttonIndex = shutdownHandler.startsWith('squeeze') ? 1 : 0;
      const press = (pressed: boolean) => {
        if (handheld) {
          const screen = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)!;
          const rect = screen.getBoundingClientRect();
          screen.dispatchEvent(new MouseEvent(pressed ? 'mousedown' : 'mouseup', {button: 2, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2}));
        } else window.dispatchEvent(new CustomEvent('webxr-input-button', {detail: {objectName: 'rightController', buttonIndex, pressed}}));
      };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out ending session from ${shutdownHandler}`)), 5000); });
      try {
        inputSession.updateRenderState({baseLayer: new xr.XRWebGLLayer(inputSession, context)});
        inputSession.requestAnimationFrame(render);
        if (shutdownHandler !== 'added' || handheld) {
          await new Promise<void>(resolve => inputSession.requestAnimationFrame(() => resolve()));
          press(true);
          if (shutdownHandler !== 'added') {
            await Promise.race([started, deadline]);
            if (!inputSession.ended) press(false);
          }
        }
        await Promise.race([ended, deadline]);
        await endPromise;
        const pairedEnd = shutdownHandler === 'select' ? ['selectend'] : shutdownHandler === 'squeeze' ? ['squeezeend'] : [];
        check(order.slice(shutdownIndex).join(',') === [shutdownHandler, ...pairedEnd, 'end'].join(','), `shutdown from ${shutdownHandler} finishes only the current action before end`);
        check(endWasQueued && !resolvedBeforeEnd && inputSession.ended && inputSession.inputSources.length === 0 && framesAfterShutdown === 0, `shutdown from ${shutdownHandler} queues end, resolves afterward and stops frame processing`);
        check(inputs.every(input => input instanceof xr.XRInputSource && input === inputs[0]), `shutdown from ${shutdownHandler} preserves valid input identity`);
      } finally {
        clearTimeout(timeout);
        if (!inputSession.ended) await inputSession.end();
        inputCanvas.remove();
      }
    }
    return {mode, handheld, assertions: new Set(passed).size, passed: [...new Set(passed)]};
  }, {mode, handheld});
}
