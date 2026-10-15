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
  let session: Awaited<ReturnType<typeof appWindow.navigator.xr.requestSession>> | undefined;
  let hitSource: {cancel(): void} | undefined;
  let transientSource: {cancel(): void} | undefined;
  appWindow.smoke = {
    state,
    async start(mode) {
      session = await appWindow.navigator.xr.requestSession(mode, {requiredFeatures: mode === 'immersive-ar' ? ['hit-test'] : []});
      state.ended = false;
      state.hits = 0;
      state.transientHits = 0;
      const activeSession = session;
      document.body.appendChild(canvas);
      const gl = canvas.getContext('webgl', {alpha: true});
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
          gl.clearColor(0.3, 0.6, 0.9, 0.5);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        } catch (error) { state.errors.push(String(error)); }
        if (!state.ended) activeSession.requestAnimationFrame(frame);
      };
      activeSession.requestAnimationFrame(frame);
    },
    async stop() { await session?.end(); hitSource = undefined; transientSource = undefined; },
    cancelHitTests() { hitSource?.cancel(); transientSource?.cancel(); },
  };
})();
