import type {SessionMode} from '../src/types/contracts';

/** Identical page code in the real Chromium/Firefox extension drivers. */
export async function rigidTransformCases(mode: SessionMode) {
  const w = window as any, passed: string[] = [];
  function check(value: unknown, label: string) { if (!value) throw new Error(`${mode}: ${label}`); passed.push(label); w.rigidTransformProgress = label; }
  function near(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string) {
    check(actual.length === expected.length && Array.from(actual).every((n, i) => Math.abs(n - expected[i]) < 0.0001), label);
  }
  function throws(action: () => unknown, expected: string, label: string) {
    let caught: any; try { action(); } catch (e) { caught = e; }
    check(caught?.name === expected, label);
  }
  function exactThrow(action: () => unknown, expected: unknown, label: string) {
    let caught = false, reason: unknown; try { action(); } catch (e) { caught = true; reason = e; }
    check(caught && reason === expected, label);
  }
  function point(p: DOMPointReadOnly) { return [p.x, p.y, p.z, p.w]; }
  const T = w.XRRigidTransform;
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  // Open during the driver's activation; all documents receive real injections.
  const popup = window.open('/frame', 'rigid-transform-realm') as any;
  check(popup, 'popup opened');
  const iframe = document.createElement('iframe'); iframe.src = '/frame';
  const ready = new Promise<void>(resolve => { iframe.onload = () => resolve(); }); document.body.append(iframe);
  let session: any, peer: any, canvas: HTMLCanvasElement | undefined;
  try {
    w.rigidTransformProgress = 'waiting for iframe';
    await ready;
    const deadline = Date.now() + 10000;
    while (!popup.XRRigidTransform) { check(Date.now() < deadline, 'popup injection deadline'); await new Promise(resolve => setTimeout(resolve, 10)); }
    const child = iframe.contentWindow as any, realms = [w, child, popup];
    // Classic external script supplies a sloppy assignment under restrictive CSP.
    const script = document.createElement('script'); script.src = '/transform-sloppy.js';
    await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = reject; document.head.append(script); });
    for (const args of [[], [null], [undefined], [null, null], [undefined, undefined], [{x: undefined}, {w: undefined}]]) {
      const t = Reflect.construct(T, args); near(t.matrix, identity, 'null/undefined dictionaries and member defaults');
    }
    const converted = new T({x: '2.5', y: null, z: false, w: '1'}, {x: null, y: '0', z: false, w: '2'});
    near(point(converted.position), [2.5,0,0,1], 'ToNumber position'); near(point(converted.orientation), [0,0,0,1], 'ToNumber normalized orientation');
    const inherited = new T(Object.create({x: '3', w: '1'}), Object.create({y: '2', w: 0}));
    near(point(inherited.position), [3,0,0,1], 'inherited dictionary position'); near(point(inherited.orientation), [0,1,0,0], 'inherited dictionary orientation');
    const all = document.all as any;
    Object.defineProperty(all, 'x', {configurable: true, value: '5'});
    try { check(new T(all).position.x === 5, 'document.all is an object dictionary'); } finally { delete all.x; }
    const callable = () => {}; (callable as any).x = '4';
    check(new T(callable).position.x === 4, 'callable dictionary accepted');
    for (const primitive of [0, 1, true, false, '', '1', Symbol('dictionary'), BigInt(1)]) {
      throws(() => new T(primitive), 'TypeError', 'primitive position dictionary');
      throws(() => new T({}, primitive), 'TypeError', 'primitive orientation dictionary');
    }
    const order: string[] = [];
    function watched(name: string, bad = false) {
      return new Proxy({}, {get(_target, key) {
        order.push(`${name}.${String(key)}`);
        return { [Symbol.toPrimitive](hint: string) { check(hint === 'number', 'numeric hint'); order.push(`${name}.${String(key)} number`); return key === 'w' ? (bad ? 0 : 1) : 0; } };
      }});
    }
    new T(watched('p'), watched('q'));
    const expected = ['p','q'].flatMap(n => ['w','x','y','z'].flatMap(k => [`${n}.${k}`, `${n}.${k} number`]));
    check(order.join('|') === expected.join('|'), 'one ordered read/conversion per member of both dictionaries');
    order.length = 0;
    throws(() => new T(watched('p', true), watched('q')), 'TypeError', 'invalid position after both conversions');
    check(order.join('|') === expected.join('|'), 'validation follows complete argument conversion');
    for (const sentinel of [undefined, null, Symbol('sentinel'), {sentinel: true}, new Error('sentinel')]) {
      exactThrow(() => new T({w: 0}, {get z() { throw sentinel; }}), sentinel, 'orientation getter exception precedes position validation');
      exactThrow(() => new T({x: {[Symbol.toPrimitive]() { throw sentinel; }}}), sentinel, 'conversion exception preserved');
    }
    for (const value of [Symbol('component'), BigInt(1), Object(BigInt(1)), Object(Symbol('component'))]) {
      throws(() => new T({x: value}), 'TypeError', 'non-number component conversion');
      throws(() => new T({}, {w: value}), 'TypeError', 'orientation non-number component conversion');
    }
    for (const value of [NaN, Infinity, -Infinity, 'NaN', 'Infinity']) {
      throws(() => new T({x: value}), 'TypeError', 'nonfinite position');
      throws(() => new T({}, {y: value}), 'TypeError', 'nonfinite orientation');
    }
    throws(() => new T({w: null}), 'TypeError', 'null position w converts to zero');
    for (const q of [{w: null}, {x: 0, y: 0, z: 0, w: 0}, {x: Number.MIN_VALUE, w: 0}, {x: Number.MAX_VALUE}]) {
      throws(() => new T({}, q), 'InvalidStateError', 'non-normalizable quaternion');
    }
    const rotation = new T({x: 1, y: 2, z: 3}, {y: Math.SQRT1_2, w: Math.SQRT1_2});
    const matrix = Array.from(rotation.matrix) as number[];
    near([matrix[0]+matrix[12],matrix[1]+matrix[13],matrix[2]+matrix[14]], [1,2,2], 'rotation before translation in metres');
    function lifetime(t: any, label: string) {
      const original = Array.from(t.matrix) as number[], p = point(t.position), q = point(t.orientation);
      const first = t.matrix; check(first === t.matrix, `${label}: attached array reused`);
      first.fill(73); check(t.matrix === first && t.matrix[12] === 73, `${label}: elements remain mutable`);
      near(point(t.position), p, `${label}: writes preserve position`); near(point(t.orientation), q, `${label}: writes preserve orientation`);
      const detached = structuredClone(first.buffer, {transfer: [first.buffer]});
      check(first.length === 0 && detached.byteLength === 64, `${label}: transfer detaches actual buffer`);
      const fresh = t.matrix; check(fresh !== first && fresh.length === 16 && fresh === t.matrix, `${label}: fresh stable 16-element array`);
      near(fresh, original, `${label}: regeneration uses geometry`);
      const inverse = t.inverse; check(inverse === t.inverse && inverse.inverse === t, `${label}: reciprocal inverse SameObject`);
      const inv = inverse.matrix;
      // Matrix multiplication uses the saved unmodified matrix, not exported writes.
      const product = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) product[c*4+r] += original[k*4+r]*inv[c*4+k];
      near(product, identity, `${label}: inverse cancels geometry`);
      structuredClone(fresh.buffer, {transfer: [fresh.buffer]}); near(t.matrix, original, `${label}: detach after inverse`);
      const savedInverse = Array.from(inv) as number[]; inv.fill(91); structuredClone(inv.buffer, {transfer: [inv.buffer]});
      near(inverse.matrix, savedInverse, `${label}: inverse regenerates independently`);
      return {transform: t, original};
    }
    lifetime(rotation, 'authored');
    const beforeInverse = new T({x: -4}, {z: 1, w: 1});
    beforeInverse.matrix.fill(88); const inverseBeforeDetach = beforeInverse.inverse;
    near(point(inverseBeforeDetach.position), [0,-4,0,1], 'inverse ignores mutation before its first allocation');
    structuredClone(beforeInverse.matrix.buffer, {transfer: [beforeInverse.matrix.buffer]});
    lifetime(beforeInverse, 'inverse already allocated');
    const descriptors = ['position','orientation','matrix','inverse'];
    for (const realm of realms) {
      const t = new realm.XRRigidTransform({x: 3}, {z: 1, w: 1});
      for (const name of descriptors) {
        const d = Object.getOwnPropertyDescriptor(realm.XRRigidTransform.prototype, name)!;
        check(!!d.get && d.set === undefined && d.enumerable && d.configurable && !('value' in d), `${name}: WebIDL getter descriptor`);
        check(!Object.prototype.hasOwnProperty.call(t, name), `${name}: no own attribute`);
        function strictAssign() { 'use strict'; t[name] = 0; }
        throws(strictAssign, 'TypeError', `${name}: strict assignment`);
        const value = t[name]; w.assignTransformSloppy(t, name, 0); check(t[name] === value, `${name}: sloppy assignment ignored`);
        for (const lender of realms) {
          const get = Object.getOwnPropertyDescriptor(lender.XRRigidTransform.prototype, name)!.get!;
          check(get.call(t) === value, `${name}: borrowed SameObject getter`);
          let traps = 0;
          const watched = new Proxy({}, {get() { traps++; throw new Error('unexpected property access'); }});
          for (const bad of [undefined, null, {}, realm.XRRigidTransform.prototype, Object.create(realm.XRRigidTransform.prototype), new Proxy(t, {}), watched]) {
            throws(() => get.call(bad), 'TypeError', `${name}: reject forged/proxy receiver`);
          }
          check(traps === 0, `${name}: receiver check has no property access`);
        }
      }
      // First lazy allocations occur through foreign getters.
      const cold = new realm.XRRigidTransform({z: 2});
      const getter = (name: string) => Object.getOwnPropertyDescriptor(w.XRRigidTransform.prototype, name)!.get!.call(cold);
      check(Object.getPrototypeOf(getter('matrix')) === realm.Float32Array.prototype, 'borrowed matrix allocated in owner realm');
      check(Object.getPrototypeOf(getter('inverse')) === realm.XRRigidTransform.prototype, 'borrowed inverse allocated in owner realm');
      for (const name of ['position','orientation']) check(Object.getPrototypeOf(getter(name)) === realm.DOMPointReadOnly.prototype, 'point belongs to owner realm');
      const old = cold.matrix; structuredClone(old.buffer, {transfer: [old.buffer]});
      check(Object.getPrototypeOf(getter('matrix')) === realm.Float32Array.prototype && cold.matrix !== old, 'regenerated foreign array belongs to owner realm');
    }
    function start(): Promise<any> {
      return new Promise((resolve, reject) => {
        const button = document.createElement('button'); button.id = 'reference-space-session'; button.textContent = 'Start transform navigation';
        button.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
        button.onclick = () => { button.remove(); w.navigator.xr.requestSession(mode, mode === 'inline' ? {} : {requiredFeatures: ['local-floor','bounded-floor']}).then(resolve, reject); };
        document.body.append(button);
      });
    }
    w.rigidTransformProgress = 'waiting for session activation';
    session = await start();
    const base = await session.requestReferenceSpace('viewer');
    const op = w.XRReferenceSpace.prototype.getOffsetReferenceSpace;
    const d = Object.getOwnPropertyDescriptor(w.XRReferenceSpace.prototype, 'getOffsetReferenceSpace')!;
    check(d.enumerable && d.configurable && d.writable && op.length === 1, 'offset operation descriptor and arity');
    for (const receiver of [undefined,null,{},w.XRReferenceSpace.prototype,Object.create(w.XRReferenceSpace.prototype),new Proxy(base,{})]) {
      throws(() => op.call(receiver, new T()), 'TypeError', 'offset invalid receiver');
    }
    let argumentTraps = 0;
    const untrusted = new Proxy({}, {get() { argumentTraps++; throw new Error('argument inspected'); }});
    throws(() => op.call({}, untrusted), 'TypeError', 'offset receiver precedes argument');
    throws(() => op.call(base, untrusted), 'TypeError', 'offset uses transform brand');
    check(argumentTraps === 0, 'offset brands do not read argument properties');
    for (const args of [[],[null],[undefined],[{}],[T.prototype],[Object.create(T.prototype)],[new Proxy(new T(),{})]]) {
      throws(() => Reflect.apply(op, base, args), 'TypeError', 'offset missing/forged/proxy argument');
    }
    for (const realm of realms) {
      w.rigidTransformProgress = 'waiting for realm inline session';
      const realmSession = await realm.navigator.xr.requestSession('inline');
      try {
        const realmBase = await realmSession.requestReferenceSpace('viewer');
        for (const lender of realms) {
          const argument = new lender.XRRigidTransform({x: 1}); argument.matrix.fill(92);
          structuredClone(argument.matrix.buffer, {transfer: [argument.matrix.buffer]});
          const offset = lender.XRReferenceSpace.prototype.getOffsetReferenceSpace.call(realmBase, argument);
          check(offset !== realmBase && Object.getPrototypeOf(offset) === realm.XRReferenceSpace.prototype, 'fresh offset allocated in base realm with foreign transform/operation');
          check(offset._session === realmSession, 'offset retains session ownership');
        }
      } finally { await realmSession.end(); }
    }
    // Retain foreign values and operations, then close their documents before
    // frame rendering so the inspected document stays visible in Firefox.
    const ChildTransform = child.XRRigidTransform, PopupTransform = popup.XRRigidTransform;
    const borrowedOffset = popup.XRReferenceSpace.prototype.getOffsetReferenceSpace;
    popup.close(); iframe.remove(); window.focus();
    const first = new ChildTransform({x: 1}, {y: Math.SQRT1_2, w: Math.SQRT1_2});
    first.matrix.fill(66); // Never detach before the initial offset calculation.
    const offsetA = borrowedOffset.call(base, first);
    structuredClone(first.matrix.buffer, {transfer: [first.matrix.buffer]});
    const offsetB = offsetA.getOffsetReferenceSpace(new PopupTransform({z: 2}));
    const expectedNested = [0,0,-1,0, 0,1,0,0, 1,0,0,0, 3,0,0,1];
    const bounded = mode === 'inline' ? null : await session.requestReferenceSpace('bounded-floor');
    const boundedOffset = bounded?.getOffsetReferenceSpace(first).getOffsetReferenceSpace(new T({z: 2}));
    if (bounded) {
      check(Object.getPrototypeOf(boundedOffset) === w.XRBoundedReferenceSpace.prototype && boundedOffset !== bounded, 'bounded subclass allocation');
      bounded.boundsGeometry.forEach((p: DOMPointReadOnly, i: number) => near(point(boundedOffset.boundsGeometry[i]), [-p.z,p.y,p.x-3,1], 'bounds inverse cumulative translation/rotation'));
    }
    peer = await w.navigator.xr.requestSession('inline'); const foreign = await peer.requestReferenceSpace('viewer');
    canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
    const gl = canvas.getContext('webgl', {alpha: true, preserveDrawingBuffer: true})!;
    check(gl, 'WebGL available'); await (gl as any).makeXRCompatible();
    const layer = new w.XRWebGLLayer(session, gl); session.updateRenderState({baseLayer: layer});
    function shader(type: number, source: string) {
      const result = gl.createShader(type)!; gl.shaderSource(result, source); gl.compileShader(result);
      check(gl.getShaderParameter(result, gl.COMPILE_STATUS), gl.getShaderInfoLog(result) || 'shader compiles'); return result;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec3 p;uniform mat4 projection;uniform mat4 view;void main(){gl_Position=projection*view*vec4(p,1.0);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;uniform vec4 color;void main(){gl_FragColor=color;}'));
    gl.linkProgram(program); check(gl.getProgramParameter(program, gl.LINK_STATUS), 'render program links'); gl.useProgram(program);
    const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.3,-.25,-2, .3,-.25,-2, 0,.35,-2]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
    const retained: {transform: any; original: number[]}[] = [], rendering: any[] = [];
    function next(action: (frame: any) => void): Promise<void> {
      return new Promise((resolve, reject) => session.requestAnimationFrame((_time: number, frame: any) => { try { action(frame); resolve(); } catch (e) { reject(e); } }));
    }
    await next(frame => {
      near(frame.getPose(offsetB, base).transform.matrix, expectedNested, 'active frame nested offset pose ignores mutated/detached arrays');
      near(point(frame.getViewerPose(offsetB).transform.position), [0,0,-3,1], 'application viewer pose reflects inverse offset');
      if (bounded) near(frame.getPose(boundedOffset, bounded).transform.matrix, expectedNested, 'active frame bounded offset pose');
      throws(() => frame.getPose(foreign, base), 'InvalidStateError', 'foreign-session source rejected');
      throws(() => frame.getPose(base, foreign), 'InvalidStateError', 'foreign-session base rejected');
      const pose = frame.getViewerPose(base);
      retained.push(lifetime(pose.transform, 'viewer pose'));
      for (const view of pose.views) retained.push(lifetime(view.transform, `${view.eye} view`));
      retained.push(lifetime(frame.getPose(offsetB, base).transform, 'relative pose'));
    });
    const navigation = base.getOffsetReferenceSpace(new T({x: 0.6}));
    for (const [label, reference] of [['before',base],['after',navigation]]) {
      await next(frame => {
        const pose = frame.getViewerPose(reference);
        near(point(pose.transform.position), label === 'before' ? [0,0,0,1] : [-.6,0,0,1], `${label}: navigation viewer position`);
        const stereo = mode !== 'inline' && session.interactionMode !== 'screen-space';
        check(pose.views.map((v: any) => v.eye).join(',') === (stereo ? 'left,right' : 'none'), `${label}: stereo/mono view contract`);
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        const views: any[] = [];
        for (const view of pose.views) {
          const viewport = layer.getViewport(view);
          check(viewport.width > 0 && viewport.height > 0, `${label}/${view.eye}: positive viewport`);
          gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
          gl.uniformMatrix4fv(gl.getUniformLocation(program,'projection'),false,view.projectionMatrix);
          gl.uniformMatrix4fv(gl.getUniformLocation(program,'view'),false,view.transform.inverse.matrix);
          const color = view.eye === 'left' ? [1,0,0,1] : view.eye === 'right' ? [0,1,0,1] : [1,1,0,1];
          gl.uniform4fv(gl.getUniformLocation(program,'color'),color); gl.drawArrays(gl.TRIANGLES,0,3);
          const pixels = new Uint8Array(viewport.width*viewport.height*4);
          gl.readPixels(viewport.x,viewport.y,viewport.width,viewport.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let count = 0, sum = 0;
          for (let y = 0; y < viewport.height; y++) for (let x = 0; x < viewport.width; x++) {
            const i = (y*viewport.width+x)*4;
            if (color.slice(0,3).every((n,j) => Math.abs(pixels[i+j]-n*255) < 3) && pixels[i+3] > 250) { count++; sum += x; }
          }
          check(count > 100, `${label}/${view.eye}: identifiable colored triangle pixels`);
          views.push({eye:view.eye,viewport:{x:viewport.x,y:viewport.y,width:viewport.width,height:viewport.height},pixels:count,centroidX:sum/count});
        }
        if (views.length === 2) check(views[0].viewport.x+views[0].viewport.width <= views[1].viewport.x, `${label}: stereo regions do not overlap`);
        check(gl.getError() === gl.NO_ERROR, `${label}: rendering without GL errors`);
        rendering.push({label,views});
      });
      // The await resumes after the real session compositor presents the frame.
      // Inspect its owned output canvas; no GL methods or rendering are replaced.
      const output = layer._presentationCanvas as HTMLCanvasElement;
      const render = rendering[rendering.length-1];
      if (mode !== 'inline') {
        const context = output.getContext('2d')!;
        const pixels = context.getImageData(0,0,output.width,output.height).data;
        for (const view of render.views) {
          const color = view.eye === 'left' ? [255,0,0] : view.eye === 'right' ? [0,255,0] : [255,255,0];
          let count = 0;
          for (let y = 0; y < output.height; y++) for (let x = view.viewport.x; x < view.viewport.x+view.viewport.width; x++) {
            const i = (y*output.width+x)*4;
            if (color.every((n,j) => Math.abs(pixels[i+j]-n) < 3) && pixels[i+3] > 250) count++;
          }
          check(count === view.pixels, `${label}/${view.eye}: presented pixels match rendered geometry`);
          view.presentedPixels = count;
        }
      }
      render.png = output.toDataURL('image/png');
    }
    for (let i = 0; i < rendering[0].views.length; i++) check(rendering[1].views[i].centroidX > rendering[0].views[i].centroidX + rendering[0].views[i].viewport.width*.05, 'navigation visibly moves geometry right in every eye');
    let ends = 0, lateFrames = 0; session.addEventListener('end', () => ends++);
    session.requestAnimationFrame(() => lateFrames++); await session.end();
    await new Promise(resolve => setTimeout(resolve,80));
    check(ends === 1 && lateFrames === 0 && session.callbacks.size === 0, 'clean shutdown emits one end and cancels queued frames');
    for (const {transform, original} of retained) {
      near(transform.matrix,original,'retained transform readable after frame/session completion');
      structuredClone(transform.matrix.buffer,{transfer:[transform.matrix.buffer]}); near(transform.matrix,original,'retained ended transform regenerates');
      check(transform.inverse.inverse === transform,'retained inverse identity after end');
    }
    gl.deleteBuffer(buffer); gl.deleteProgram(program);
    return {mode, assertions:passed.length, passed, tolerance:0.0001, rendering};
  } finally {
    if (session && !session.ended) await session.end(); if (peer && !peer.ended) await peer.end();
    popup?.close(); iframe.remove(); canvas?.remove(); document.querySelector('#reference-space-session')?.remove();
  }
}
