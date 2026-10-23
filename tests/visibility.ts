import type {SessionMode} from '../src/types/contracts';

/** Real extension page cases. Native tab switches are owned by the runner.
 * WPT hide/restore adaptation and deterministic tick instrumentation are
 * disclosed in docs/webxr-inline-visibility.md. */
export async function visibilityCases(mode: SessionMode) {
  const w = window as any;
  const passed: string[] = [], observations: any[] = [];
  const owned: any[] = [];
  const attached = new Set<EventListenerOrEventListenerObject>();
  const add = document.addEventListener, remove = document.removeEventListener;
  document.addEventListener = function(this: Document, type: string, listener: any, options?: any) {
    if (type === 'visibilitychange') attached.add(listener);
    return add.call(this, type, listener, options);
  } as typeof add;
  document.removeEventListener = function(this: Document, type: string, listener: any, options?: any) {
    if (type === 'visibilitychange') attached.delete(listener);
    return remove.call(this, type, listener, options);
  } as typeof remove;
  function check(value: unknown, label: string) {
    if (!value) throw new Error(`${mode}: ${label}`);
    passed.push(label);
  }
  async function waitFor(read: () => boolean, label: string) {
    const deadline = performance.now() + 15000;
    while (!read()) {
      if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  let gate = 0;
  async function nativeVisibility(state: DocumentVisibilityState) {
    const control = {id: ++gate, state, ready: false};
    w.visibilityGate = control;
    await waitFor(() => control.ready, `native ${state}`);
    check(document.visibilityState === state && document.hidden === (state === 'hidden'), `native document ${state}`);
  }
  function start(sessionMode: string) {
    return new Promise<any>((resolve, reject) => {
      const button = document.createElement('button');
      button.id = 'visibility-session'; button.textContent = 'Start visibility case';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      button.onclick = () => { button.remove(); w.navigator.xr.requestSession(sessionMode).then(resolve, reject); };
      document.body.append(button);
    });
  }
  async function create(sessionMode: string, name: string, color: number[]) {
    const session = sessionMode === 'inline' ? await w.navigator.xr.requestSession('inline') : await start(sessionMode);
    owned.push(session);
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; document.body.append(canvas);
    const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true})!;
    await (gl as any).makeXRCompatible();
    const layer = new w.XRWebGLLayer(session, gl);
    session.updateRenderState({baseLayer: layer});
    const record = {session, canvas, gl, layer, name, color, events: [] as string[], properties: [] as string[], calls: [] as number[], pixels: [] as number[][]};
    const observe = (target: string[]) => (event: any) => {
      check(event instanceof w.XRSessionEvent && event.session === session && event.target === session, `${name} owning XRSessionEvent`);
      target.push(session.visibilityState);
    };
    session.addEventListener('visibilitychange', observe(record.events));
    session.onvisibilitychange = observe(record.properties);
    check(session.visibilityState === document.visibilityState, `${name} initial document visibility`);
    if (sessionMode === 'inline') check(session.enabledFeatures.join(',') === 'viewer', `${name} viewer-only inline negotiation`);
    return record;
  }
  function draw(record: Awaited<ReturnType<typeof create>>, id: number) {
    const {session, gl, layer, color, calls, pixels} = record;
    session.requestAnimationFrame((_time: number, frame: any) => {
      check(session.visibilityState === document.visibilityState, `${record.name} stable visibility in callback`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(color[0], color[1], color[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      check(Array.from(pixel).every((v, i) => v === [...color.map(v => v * 255), 255][i]), `${record.name} own canvas pixel`);
      check(frame.session === session, `${record.name} frame owner`);
      pixels.push(Array.from(pixel)); calls.push(id);
    });
  }
  function pump(session: any) {
    // Exercise the real scheduling guard even when native RAF is throttled.
    // Cancel only the extra schedule made by this invocation, retaining its
    // original native handle so normal resumption still runs through RAF.
    const handle = session.frameHandle;
    try { session.tick(performance.now()); }
    finally { session._device.cancelAnimationFrame(session.frameHandle); session.frameHandle = handle; }
  }
  function snapshot(records: Awaited<ReturnType<typeof create>>[], label: string) {
    for (const r of records) {
      check(r.session.visibilityState === document.visibilityState, `${label}: ${r.name} mirrors document`);
      const events = r.events.length;
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      check(r.events.length === events && r.properties.length === events, `${label}: ${r.name} no duplicate unchanged events`);
      pump(r.session);
      check(r.session.visibilityState === document.visibilityState && r.events.length === events, `${label}: ${r.name} stable across frame processing`);
    }
    observations.push({label, document: document.visibilityState, sessions: records.map(r => ({name: r.name, state: r.session.visibilityState, events: [...r.events], properties: [...r.properties], callbacks: [...r.calls], pixels: [...r.pixels]}))});
  }
  try {
    check(document.visibilityState === 'visible', 'initial native document visible');
    for (const exit of mode === 'inline' ? ['inline'] : ['explicit', 'device']) {
      const before = await create('inline', `${exit}/before`, [1, 0, 0]);
      draw(before, 0); await waitFor(() => before.calls.length === 1, 'initial inline frame'); before.calls.length = 0;
      const immersive = mode === 'inline' ? null : await create(mode, `${exit}/immersive`, [0, 0, 1]);
      if (immersive) {
        draw(immersive, 0); await waitFor(() => immersive.calls.length === 1, 'immersive rendering');
        check(immersive.session.environmentBlendMode === (mode === 'immersive-ar' ? 'alpha-blend' : 'opaque'), 'immersive blend mode preserved');
        let error: any; try { await w.navigator.xr.requestSession(mode); } catch (e) { error = e; }
        check(error?.name === 'InvalidStateError', 'immersive concurrency InvalidStateError');
      }
      const during = await create('inline', `${exit}/during`, [0, 1, 0]);
      const ended = await create('inline', `${exit}/ended`, [1, 1, 0]);
      const endedTick = ended.session.tick;
      ended.session.requestAnimationFrame(() => { throw new Error('Ended inline callback delivered'); });
      await ended.session.end();
      check(!attached.has(ended.session.visibilityListener) && ended.session.callbacks.size === 0, 'ended inline releases listener and queued callbacks');
      const records = [before, during];
      if (immersive) {
        draw(before, 1);
        const cancel = before.session.requestAnimationFrame(() => before.calls.push(99));
        draw(before, 2); before.session.cancelAnimationFrame(cancel);
        draw(during, 1); draw(during, 2);
        // Allow native XR RAF processing while the document is visible.
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        snapshot(records, `${exit}/immersive-visible`);
        check(records.every(r => r.events.length === 0 && r.calls.length === 0 && r.session.callbacks.size === 2), 'immersive entry emits no visibility and retains ordered callbacks');
      }
      await nativeVisibility('hidden');
      snapshot(records, `${exit}/hidden`);
      if (immersive) {
        check(records.every(r => r.calls.length === 0), 'hidden immersive retains callbacks');
        await nativeVisibility('visible'); snapshot(records, `${exit}/shown-during-immersive`);
        check(records.every(r => r.calls.length === 0), 'show during immersive keeps callbacks suspended');
        await nativeVisibility('hidden'); snapshot(records, `${exit}/hidden-again`);
      } else {
        draw(before, 1); const cancel = before.session.requestAnimationFrame(() => before.calls.push(99));
        draw(before, 2); before.session.cancelAnimationFrame(cancel); draw(during, 1); draw(during, 2);
      }
      // A new inline session must also initialize to the real hidden document.
      const hidden = await create('inline', `${exit}/created-hidden`, [1, 0, 1]); records.push(hidden);
      draw(hidden, 1); draw(hidden, 2); snapshot(records, `${exit}/created-hidden`);
      check(records.every(r => r.calls.length === 0), 'hidden sessions retain callbacks');
      if (immersive && exit === 'device') {
        // Real adapter shutdown emits the notification observed by _finish().
        immersive.session._device.endSession(immersive.session._id);
        await waitFor(() => immersive.session.ended, 'device shutdown');
        snapshot(records, 'device/end-while-hidden');
        check(records.every(r => r.calls.length === 0), 'immersive end while hidden retains callbacks');
      }
      await nativeVisibility('visible');
      if (immersive && exit === 'explicit') {
        snapshot(records, 'explicit/before-end');
        check(records.every(r => r.calls.length === 0), 'restoration before explicit end still suspended');
        const counts = records.map(r => r.events.length);
        await immersive.session.end();
        check(records.every((r, i) => r.events.length === counts[i]), 'explicit immersive exit emits no inline visibility event');
      }
      await waitFor(() => records.every(r => r.calls.length === 2), 'native resumed inline callbacks');
      snapshot(records, `${exit}/resumed`);
      for (const r of records) {
        check(r.calls.join(',') === '1,2', `${r.name} surviving callbacks resume once in registration order`);
        const expected = r === hidden || !immersive ? 'hidden,visible' : 'hidden,visible,hidden,visible';
        // The hidden-created session sees only the final visible transition.
        const sequence = r === hidden ? 'visible' : expected;
        check(r.events.join(',') === sequence && r.properties.join(',') === sequence, `${r.name} exact native hide/restore event sequence`);
        check(r.session.callbacks.size === 0, `${r.name} queue drained exactly once`);
      }
      endedTick(performance.now());
      check(ended.events.length === 0 && ended.properties.length === 0 && ended.calls.length === 0, 'ended inline ignores document transitions and stale tick');
      for (const r of records) { await r.session.end(); check(!attached.has(r.session.visibilityListener), `${r.name} document listener removed`); }
      for (const r of [...records, ended, ...(immersive ? [immersive] : [])]) r.canvas.remove();
    }
    check(attached.size === 0, 'all session document listeners released');
    return {mode, assertions: passed.length, passed, observations};
  } finally {
    for (const session of owned) if (!session.ended) await session.end();
    document.addEventListener = add; document.removeEventListener = remove;
    w.visibilityGate = null; document.querySelector('#visibility-session')?.remove();
  }
}
