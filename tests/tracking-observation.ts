/** Test-only observation. Original calls retain their receiver, arguments,
 * result and thrown exception; no XR requests, events or application state change. */
export function observeTracking() {
  const w = window as any;
  if (!w.XRSession?.prototype._assertLive) { setTimeout(observeTracking, 0); return; }
  if (w.tracking) return;
  const state = w.tracking = {sessions: [] as any[], failures: [] as string[]};
  w.trackingLive = [];
  const request = w.navigator.xr.requestSession;
  w.navigator.xr.requestSession = function (...args: any[]) {
    const result: any = Reflect.apply(request, this, args);
    void result.then((session: any) => {
      const record: any = {mode: args[0], options: args[1] ?? {}, enabled: [...session.enabledFeatures], frames: 0, ends: 0, events: [], poses: {}, identityChecks: 0, views: []};
      const live: any = {session, record, sources: null, frame: null, reference: null};
      state.sessions.push(record); w.trackingLive.push(live);
      if (args[0] !== 'inline') w.firefoxSession = session;
      session.addEventListener('end', () => {
        record.ends++;
        const layer = session.renderState.baseLayer ?? session.renderState.layers?.[0]?._binding._presentation;
        live.finalCanvas = layer?._presentationCanvas;
        live.finalPads = (live.sources ?? []).map((v: any) => v.source.gamepad ? JSON.stringify([v.source.gamepad.axes, v.source.gamepad.buttons, v.source.gamepad.timestamp]) : null);
      });
      for (const type of ['selectstart', 'select', 'selectend']) session.addEventListener(type, (event: any) => {
        const source = event.inputSource;
        const entry: any = {type, hand: source.handedness, sameSource: [...session.inputSources].includes(source), pose: null};
        try { entry.pose = Array.from(event.frame.getPose(source.targetRaySpace, live.reference).transform.matrix); }
        catch (error) {state.failures.push(String(error));}
        record.events.push(entry); live.eventFrame = event.frame;
      });
    }, () => {});
    return result;
  };
  const raf = w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame = function (callback: any) {
    const session = this;
    return Reflect.apply(raf, this, [function (this: any, ...args: any[]) {
      const live = w.trackingLive.find((v: any) => v.session === session);
      if (!live) return Reflect.apply(callback, this, args);
      const r = live.record; r.frames++; live.frame = args[1];
      if (!(args[1] instanceof w.XRFrame)) state.failures.push('callback frame is not XRFrame');
      const sources = [...session.inputSources];
      if (!live.sources && sources.length) live.sources = sources.map((source: any) => ({source, ray: source.targetRaySpace, grip: source.gripSpace, profiles: source.profiles}));
      for (const saved of live.sources ?? []) {
        if (!sources.includes(saved.source) || saved.source.targetRaySpace !== saved.ray || saved.source.gripSpace !== saved.grip || saved.source.profiles !== saved.profiles) state.failures.push('SameObject identity changed');
        r.identityChecks++;
      }
      return Reflect.apply(callback, this, args);
    }]);
  };
  for (const method of ['getViewerPose', 'getPose']) {
    const original = w.XRFrame.prototype[method];
    w.XRFrame.prototype[method] = function (...args: any[]) {
      const result: any = Reflect.apply(original, this, args);
      const live = w.trackingLive.find((v: any) => v.session === this.session);
      if (live && result && args[method === 'getPose' ? 1 : 0]?._type !== 'viewer') {
        if (method === 'getViewerPose') {
          live.reference = args[0]; live.record.viewer = Array.from(result.transform.matrix);
          live.record.views = result.views.map((view: any) => ({eye: view.eye, width: 0, height: 0}));
        } else for (const source of this.session.inputSources) {
          const kind = source.targetRaySpace === args[0] ? 'ray' : source.gripSpace === args[0] ? 'grip' : null;
          if (kind) live.record.poses[source.handedness + '-' + kind] = Array.from(result.transform.matrix);
        }
      }
      return result;
    };
  }
  for (const [ctor, method, index] of [[w.XRWebGLLayer, 'getViewport', 0], [w.XRWebGLBinding, 'getViewSubImage', 1]] as any[]) {
    const original = ctor.prototype[method];
    ctor.prototype[method] = function (...args: any[]) {
      const result: any = Reflect.apply(original, this, args);
      for (const live of w.trackingLive) {
        const view = live.record.views.find((v: any) => v.eye === args[index].eye);
        if (view) Object.assign(view, {width: (result.viewport ?? result).width, height: (result.viewport ?? result).height});
      }
      return result;
    };
  }
}

/** Run in the application's module realm to share its exact InputRenderer. */
export async function observeSample() {
  const w = window as any;
  const moduleURL = new URL('/samples/js/render/nodes/input-renderer.js', location.href).href;
  const {InputRenderer} = await import(moduleURL);
  const {Scene} = await import(new URL('/samples/js/render/scenes/scene.js', location.href).href);
  const hitTest = Scene.prototype.hitTest;
  Scene.prototype.hitTest = function (...args: any[]) {
    const result: any = Reflect.apply(hitTest, this, args);
    w.sampleHit = result ? Array.from(result.intersection) : null;
    return result;
  };
  w.sampleConsumed = {};
  for (const method of ['addLaserPointer', 'addCursor', 'addController']) {
    const original = InputRenderer.prototype[method];
    InputRenderer.prototype[method] = function (...args: any[]) {
      const result: any = Reflect.apply(original, this, args);
      const live = w.trackingLive.find((v: any) => v.session === w.firefoxSession);
      if (live && !live.session.ended) {
        const hand = method === 'addController' ? args[1] : [...live.session.inputSources][(method === 'addCursor' ? this._activeCursors : this._activeLasers) - 1]?.handedness;
        const matrix = Array.from(args[0].matrix ?? args[0]);
        const controller = method === 'addController' ? this._controllers?.[args[2] + '_' + hand] : null;
        const node = method === 'addController' ? controller?.nodes[(controller.activeCount + this._maxInputElements - 1) % this._maxInputElements] : (method === 'addCursor' ? this._cursors[this._activeCursors - 1] : this._lasers[this._activeLasers - 1]);
        const primitives = (n: any): number => !n?.visible ? 0 : (n._renderPrimitives?.length ?? 0) + n.children.reduce((sum: number,c: any)=>sum+primitives(c),0);
        const primitiveCount = primitives(node);
        w.sampleConsumed[hand + '-' + method] = {matrix, finite: matrix.every(Number.isFinite), rendered: !!node?.visible && primitiveCount > 0, nodeMatrix: node ? Array.from(node.matrix) : null, primitiveCount, hit: method === 'addCursor' ? w.sampleHit : undefined, registeredMeshes: method === 'addController' ? Object.keys(this._controllers) : undefined, requestedProfile: args[2]};
      }
      return result;
    };
  }
}

export function trackingPixels() {
  const s = (window as any).firefoxSession;
  const layer = s.renderState.baseLayer ?? s.renderState.layers[0]._binding._presentation;
  const canvas = layer._presentationCanvas, rect = canvas.getBoundingClientRect();
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const previous = (window as any).trackingPreviousPixels;
  (window as any).trackingPreviousPixels = {data, width:canvas.width, height:canvas.height};
  const regions = [0, 1].map(eye => {
    let foreground = 0, hash = 2166136261, changedOutsideStats = 0;
    const colors = new Set<number>();
    for (let y = 0; y < canvas.height; y++) for (let x = Math.floor(eye * canvas.width / 2); x < Math.floor((eye + 1) * canvas.width / 2); x++) {
      const i = (y * canvas.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      colors.add((r << 16) + (g << 8) + b);
      // Colored room/controllers/objects, excluding uniform gray background.
      if (Math.max(r, g, b) - Math.min(r, g, b) > 20) foreground++;
      const eyeX = x - Math.floor(eye * canvas.width / 2);
      // Omit the middle third containing animated stats.
      if (previous?.width === canvas.width && previous.height === canvas.height && y > canvas.height / 2 && (eyeX < canvas.width / 6 || eyeX > canvas.width / 3) && Math.max(Math.abs(r-previous.data[i]),Math.abs(g-previous.data[i+1]),Math.abs(b-previous.data[i+2])) > 8) changedOutsideStats++;
      hash = Math.imul(hash ^ ((r << 16) + (g << 8) + b), 16777619) >>> 0;
    }
    return {foreground, colors: colors.size, hash, changedOutsideStats};
  });
  return {layer: s.renderState.baseLayer ? 'base' : 'projection', width: canvas.width, height: canvas.height, presented: canvas.isConnected && rect.width > 0 && rect.height > 0, regions};
}

/** Adapt the two pinned WPT assertion bodies; fake device setup is replaced by
 * the application's real extension session/panel input. This is not full WPT. */
export async function trackingLifetime() {
  const w = window as any, live = w.trackingLive.find((v: any) => v.session === w.firefoxSession);
  const errors: string[] = [];
  for (const action of [() => live.frame.getViewerPose(live.reference), () => live.frame.getPose(live.session.inputSources[0].targetRaySpace, live.reference), ...(live.eventFrame ? [() => live.eventFrame.getPose(live.session.inputSources[0].targetRaySpace, live.reference)] : [])]) {
    try { action(); errors.push('NO ERROR'); } catch (error) { errors.push((error as DOMException).name); }
  }
  const foreign = await w.navigator.xr.requestSession('inline'), space = await foreign.requestReferenceSpace('viewer');
  const ownership = await new Promise(resolve => live.session.requestAnimationFrame((_t: number, frame: any) => {
    const names=[];for(const args of [[space,live.reference],[live.session.inputSources[0].targetRaySpace,space]]) {try {frame.getPose(...args); names.push('NO ERROR');} catch (error) {names.push((error as DOMException).name);}}resolve(names);
  }));
  await foreign.end();
  return {inactive: errors, foreignSpace: ownership, identityChecks: live.record.identityChecks};
}
