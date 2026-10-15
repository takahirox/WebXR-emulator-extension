// Served as a classic script after TypeScript emission by browser-smoke.ts.
(() => {
  const appWindow = window as unknown as import('./browser-types').SmokeWindow;
  const state: import('./browser-types').SmokeState = {
    synchronousXR: !!appWindow.navigator.xr,
    synchronousGlobals: ['XRSystem', 'XRSession', 'XRFrame', 'XRRay', 'XRRigidTransform'].every(name => typeof (window as unknown as Record<string, unknown>)[name] === 'function'),
    overridesNativeXR: !!appWindow.navigator.xr && !/\[native code\]/.test(appWindow.navigator.xr.requestSession.toString()),
    frames: 0, viewerPosition: [], inputPositions: {}, events: {},
    hits: 0, hitPosition: null, transientHits: 0, ended: true, errors: [],
  };
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  let textureMode: 'default' | 'transparent' | 'pattern' = 'default';
  let session: Awaited<ReturnType<typeof appWindow.navigator.xr.requestSession>> | undefined;
  let hitSource: {cancel(): void} | undefined;
  let transientSource: {cancel(): void} | undefined;
  appWindow.smoke = {
    state,
    setTextureMode(mode) { textureMode = mode; },
    async start(mode) {
      session = await appWindow.navigator.xr.requestSession(mode, {requiredFeatures: mode === 'immersive-ar' ? ['hit-test'] : []});
      state.ended = false;
      state.hits = 0;
      state.transientHits = 0;
      const activeSession = session;
      document.body.appendChild(canvas);
      const gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: false});
      if (!gl) throw new Error('WebGL unavailable');
      await gl.makeXRCompatible();
      session.updateRenderState({baseLayer: new appWindow.XRWebGLLayer(session, gl)});
      const reference = await session.requestReferenceSpace('local');
      if (mode === 'immersive-ar') {
        hitSource = await session.requestHitTestSource({space: await session.requestReferenceSpace('viewer')});
        transientSource = await session.requestHitTestSourceForTransientInput({profile: 'generic-touchscreen'});
      }
      for (const type of ['selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend']) {
        session.addEventListener(type, () => { state.events[type] = (state.events[type] || 0) + 1; });
      }
      session.addEventListener('end', () => { state.ended = true; });
      const frame: Parameters<typeof activeSession.requestAnimationFrame>[0] = (time, xrFrame) => {
        try {
          state.frames++;
          const pose = xrFrame.getViewerPose(reference);
          if (pose) state.viewerPosition = Array.from(pose.transform.matrix).slice(12, 15);
          state.inputPositions = {};
          for (const input of activeSession.inputSources) {
            const inputPose = xrFrame.getPose(input.gripSpace || input.targetRaySpace, reference);
            if (inputPose) state.inputPositions[input.handedness] = Array.from(inputPose.transform.matrix).slice(12, 15);
          }
          if (hitSource) {
            const results = xrFrame.getHitTestResults(hitSource);
            state.hits = results.length;
            const pose = results[0]?.getPose(reference);
            state.hitPosition = pose ? Array.from(pose.transform.matrix).slice(12, 15) : null;
          }
          if (transientSource) state.transientHits = xrFrame.getHitTestResultsForTransientInput(transientSource).reduce((count, result) => count + result.results.length, 0);
          gl.disable(gl.SCISSOR_TEST);
          if (textureMode === 'default') gl.clearColor(0.3, 0.6, 0.9, 0.5);
          else gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          if (textureMode === 'pattern') {
            gl.enable(gl.SCISSOR_TEST);
            // Asymmetric sRGB patches detect vertical flips and double encoding.
            const halfWidth = Math.floor(gl.drawingBufferWidth / 2);
            const halfHeight = Math.floor(gl.drawingBufferHeight / 2);
            gl.scissor(0, halfHeight, halfWidth, halfHeight);
            gl.clearColor(0.25, 0.5, 0.75, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.scissor(0, 0, halfWidth, halfHeight);
            gl.clearColor(0.75, 0.25, 0.125, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.scissor(halfWidth, halfHeight, halfWidth, halfHeight);
            gl.clearColor(0.2, 0.6, 0.8, 0.5);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.SCISSOR_TEST);
          }
        } catch (error) { state.errors.push(String(error)); }
        if (!state.ended) activeSession.requestAnimationFrame(frame);
      };
      activeSession.requestAnimationFrame(frame);
    },
    async stop() { await session?.end(); hitSource = undefined; transientSource = undefined; },
    cancelHitTests() { hitSource?.cancel(); transientSource?.cancel(); },
  };
})();
