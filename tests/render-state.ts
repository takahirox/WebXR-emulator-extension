import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Geometry from '../src/polyfill/api/geometry';
import type * as Layers from '../src/polyfill/api/layers';

type XRWindow = typeof Runtime & typeof Geometry & typeof Layers & {navigator: {xr: Runtime.XRSystem}};

/** Numeric render-state conversion and application through the installed extension. */
export async function runRenderState(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate('globalThis.__name = value => value');
  return page.evaluate(async ({mode, handheld}) => {
    const xr = window as unknown as XRWindow;
    const passed: string[] = [];
    let context = '';
    function check(value: unknown, label: string) {
      if (!value) throw new Error(`${context}: ${label}`);
      passed.push(`${context}: ${label}`);
    }
    function throws(action: () => unknown, name: string, label: string) {
      let error: unknown; try { action(); } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, `${label} (${name}; got ${String(error)})`);
    }
    const documentFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    for (const sessionMode of ['inline', mode] as const) for (const path of ['webgl', 'webgl2'] as const) {
      context = `${sessionMode}/${path}`;
      const session = await xr.navigator.xr.requestSession(sessionMode);
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
      try {
        check(!session.enabledFeatures.includes('layers'), 'numeric updates require no feature descriptor');
        const initial = session.renderState;
        function emptyUpdates() {
          session.updateRenderState();
          for (const input of [undefined, null, {}, {depthNear: undefined, depthFar: undefined, inlineVerticalFieldOfView: undefined}, () => {}]) session.updateRenderState(input);
        }
        emptyUpdates(); await documentFrames();
        check(session.renderState === initial, 'empty inputs do not enqueue an update');
        session.updateRenderState({depthNear: '0.2'});
        session.updateRenderState({depthFar: '80'});
        emptyUpdates();
        check(session.renderState === initial, 'updates before presentation remain pending until activation');
        await documentFrames();
        check(session.renderState.depthNear === 0.2 && session.renderState.depthFar === 80 && session.renderState.baseLayer === null, 'partial updates survive empty calls and activate before presentation setup');

        for (const input of [false, true, 0, 1, '', '1', Symbol('dictionary'), BigInt(1)]) throws(() => session.updateRenderState(input), 'TypeError', 'primitive dictionary rejected');
        for (const key of ['depthFar', 'depthNear', 'inlineVerticalFieldOfView']) {
          for (const value of [NaN, Infinity, -Infinity, 'Infinity', 'not a number', Symbol('double'), BigInt(1), Object(BigInt(1)), {valueOf: () => NaN}]) {
            throws(() => session.updateRenderState({depthFar: 900, depthNear: 4, [key]: value}), 'TypeError', `${key} invalid double rejected before algorithms`);
          }
        }
        const sentinel = new Error('getter sentinel');
        for (const key of ['baseLayer', 'depthFar', 'depthNear', 'inlineVerticalFieldOfView', 'layers']) {
          let caught: unknown;
          try { session.updateRenderState({depthFar: 901, depthNear: 5, get [key]() { throw sentinel; }}); } catch (error) { caught = error; }
          check(caught === sentinel, `${key} getter exception propagates unchanged`);
        }
        let conversionError: unknown;
        try { session.updateRenderState({depthFar: 902, depthNear: {valueOf() { throw sentinel; }}}); } catch (error) { conversionError = error; }
        check(conversionError === sentinel, 'numeric conversion exception propagates unchanged');
        await documentFrames();
        check(session.renderState.depthNear === 0.2 && session.renderState.depthFar === 80, 'rejected updates never commit earlier numeric members');

        const trace: string[] = [];
        session.updateRenderState(new Proxy({}, {
          get(_target, key) {
            trace.push(String(key));
            if (key === 'depthFar') return {valueOf() { trace.push('convert far'); return 70; }};
            if (key === 'depthNear') return '0.25';
            return undefined;
          },
          ownKeys() { throw new Error('dictionary must not enumerate caller properties'); },
        }));
        check(trace.join(',') === 'baseLayer,depthFar,convert far,depthNear,inlineVerticalFieldOfView,layers', 'recognized members read once and converted in dictionary order, without unknown reads');
        const inherited = Object.create(null);
        Object.defineProperty(inherited, 'depthNear', {value: {valueOf: () => 0.3}});
        let farReads = 0;
        Object.defineProperty(inherited, 'depthFar', {get() { return ++farReads === 1 ? '75' : '999'; }});
        session.updateRenderState(Object.create(inherited));
        await documentFrames();
        check(session.renderState.depthNear === 0.3 && session.renderState.depthFar === 75 && farReads === 1, 'inherited nonenumerable numeric members are snapshotted');
        session.updateRenderState({depthNear: null, depthFar: null}); await documentFrames();
        check(session.renderState.depthNear === 0.01 && session.renderState.depthFar === 0, 'numeric null converts to zero with only the near minimum applied');
        session.updateRenderState({depthNear: -1, depthFar: 50}); await documentFrames();
        check(session.renderState.depthNear === 0.01 && session.renderState.depthFar === 50, 'negative near clamps with a valid positive far');
        session.updateRenderState({depthNear: 2, depthFar: -3}); await documentFrames();
        check(session.renderState.depthNear === 2 && session.renderState.depthFar === -3, 'negative far is retained without an ordering restriction');
        session.updateRenderState({depthNear: 20, depthFar: 10}); await documentFrames();
        check(session.renderState.depthNear === 20 && session.renderState.depthFar === 10, 'positive far below near is accepted');
        session.updateRenderState({depthNear: 0.25, depthFar: 1e100}); await documentFrames();
        check(session.renderState.depthFar === 10000, 'far distance clamps to emulator maximum');
        if (sessionMode === 'inline') {
          for (const [input, expected] of [[null, 0.01], [-10, 0.01], [10, 3.13], ['1.2', 1.2], [{valueOf: () => 1.1}, 1.1]] as const) {
            session.updateRenderState({inlineVerticalFieldOfView: input}); await documentFrames();
            check(session.renderState.inlineVerticalFieldOfView === expected, `inline FOV converts and clamps ${String(input)}`);
          }
        } else {
          for (const input of [null, 0, '1', {valueOf: () => 1}]) throws(() => session.updateRenderState({depthNear: 8, inlineVerticalFieldOfView: input, baseLayer: null, layers: []}), 'InvalidStateError', 'converted immersive FOV precedes layers conflict');
          await documentFrames();
          check(session.renderState.depthNear === 0.25 && session.renderState.inlineVerticalFieldOfView === null, 'immersive FOV rejection leaves numeric state unchanged');
        }
        session.updateRenderState({depthNear: 0.25, depthFar: 70, ...(sessionMode === 'inline' ? {inlineVerticalFieldOfView: 1.2} : {})});

        const gl = canvas.getContext(path, {preserveDrawingBuffer: true}) as WebGLRenderingContext | WebGL2RenderingContext | null;
        check(gl, 'application WebGL context created');
        if (!gl) throw new Error('Application WebGL unavailable');
        await gl.makeXRCompatible();
        const legacy = new xr.XRWebGLLayer(session, gl, {antialias: false});
        let binding: Layers.XRWebGLBinding | undefined, projection: Layers.XRProjectionLayer | undefined;
        const framebuffer = gl.createFramebuffer();
        if (path === 'webgl2' && sessionMode !== 'inline') {
          binding = new xr.XRWebGLBinding(session, gl);
          projection = binding.createProjectionLayer({depthFormat: 0});
          const selected = [projection]; session.updateRenderState({layers: selected}); selected.length = 0;
        } else session.updateRenderState({baseLayer: legacy});
        emptyUpdates();
        const space = await session.requestReferenceSpace('viewer');
        async function frame<T>(action: (frame: Runtime.XRFrame) => T) {
          return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`${context}: XR frame timed out`)), 10000);
            session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(action(frame)); } catch (error) { reject(error); } });
          });
        }
        const vertex = gl.createShader(gl.VERTEX_SHADER)!, fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(vertex, 'attribute vec3 position; uniform mat4 projection; void main(){ gl_Position = projection * vec4(position, 1.0); }');
        gl.shaderSource(fragment, 'precision mediump float; void main(){ gl_FragColor = vec4(1.0,0.0,0.0,1.0); }');
        gl.compileShader(vertex); gl.compileShader(fragment);
        const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        check(gl.getProgramParameter(program, gl.LINK_STATUS), 'projection pixel shader linked');
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5,-0.5,-2, 0.5,-0.5,-2, 0,0.5,-2]), gl.STATIC_DRAW);
        const attribute = gl.getAttribLocation(program, 'position');
        function draw(frame: Runtime.XRFrame) {
          const views = frame.getViewerPose(space)!.views;
          check(views.length === (sessionMode === 'inline' || handheld ? 1 : 2), 'expected mono/stereo views');
          for (const view of views) {
            let viewport: {x: number; y: number; width: number; height: number};
            if (projection) {
              const image = binding!.getViewSubImage(projection, view); viewport = image.viewport;
              gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
              gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, image.colorTexture, 0);
            } else { gl!.bindFramebuffer(gl!.FRAMEBUFFER, legacy.framebuffer); viewport = legacy.getViewport(view); }
            if (viewport.width === 0) {
              check(view.eye === 'right', 'existing stereo-disabled legacy output suppresses only right-eye pixels');
              continue;
            }
            gl!.enable(gl!.SCISSOR_TEST); gl!.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
            gl!.disable(gl!.DEPTH_TEST); gl!.clearColor(0, 0, 0, 1); gl!.clear(gl!.COLOR_BUFFER_BIT); gl!.disable(gl!.SCISSOR_TEST);
            gl!.viewport(viewport.x, viewport.y, viewport.width, viewport.height); gl!.useProgram(program);
            gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer); gl!.enableVertexAttribArray(attribute); gl!.vertexAttribPointer(attribute, 3, gl!.FLOAT, false, 0, 0);
            gl!.uniformMatrix4fv(gl!.getUniformLocation(program, 'projection'), false, view.projectionMatrix); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
            const pixel = new Uint8Array(4);
            gl!.readPixels(viewport.x + Math.floor(viewport.width / 2), viewport.y + Math.floor(viewport.height / 2), 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixel);
            check(pixel[0] > 240 && pixel[1] < 10 && pixel[2] < 10, `${view.eye} application triangle uses the frame projection`);
          }
          return views.map(view => Array.from(view.projectionMatrix));
        }
        function presentationPixels() {
          gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
          const output = legacy._presentationCanvas;
          const pixels = sessionMode !== 'inline' && !projection && output instanceof HTMLCanvasElement
            ? output.getContext('2d')!.getImageData(0, 0, output.width, output.height).data
            : new Uint8Array(gl!.drawingBufferWidth * gl!.drawingBufferHeight * 4);
          if (sessionMode === 'inline' || projection) gl!.readPixels(0, 0, gl!.drawingBufferWidth, gl!.drawingBufferHeight, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels);
          check(pixels.some((value, i) => i % 4 === 0 && value > 240 && pixels[i + 1] < 10 && pixels[i + 2] < 10), 'application triangle reaches presentation canvas');
          check(gl!.getError() === gl!.NO_ERROR, 'render-state updates produce no GL errors');
        }
        const before = await frame(frame => {
          const matrices = draw(frame), state = session.renderState;
          session.updateRenderState({depthNear: '0.4'}); session.updateRenderState({depthFar: {valueOf: () => 120}});
          if (sessionMode === 'inline') session.updateRenderState({inlineVerticalFieldOfView: '0.9'});
          emptyUpdates();
          throws(() => session.updateRenderState({depthFar: 999, depthNear: 9, inlineVerticalFieldOfView: Infinity}), 'TypeError', 'conversion failure preserves earlier pending numeric values');
          if (sessionMode !== 'inline') throws(() => session.updateRenderState({depthFar: 998, depthNear: 8, inlineVerticalFieldOfView: null}), 'InvalidStateError', 'algorithm failure preserves earlier pending numeric values');
          check(session.renderState === state && state.depthNear === 0.25 && state.depthFar === 70, 'updates in a callback preserve active values for the whole frame');
          check(frame.getViewerPose(space)!.views.every((view, i) => view.projectionMatrix.every((value, j) => value === matrices[i][j])), 'same-frame views retain the active projection');
          return matrices;
        });
        presentationPixels();
        const after = await frame(frame => {
          check(session.renderState.depthNear === 0.4 && session.renderState.depthFar === 120, 'next rendered frame merges successive numeric updates');
          check(projection ? session.renderState.layers?.[0] === projection && session.renderState.baseLayer === null : session.renderState.baseLayer === legacy && session.renderState.layers === null, 'numeric-only changes retain selected layers');
          return draw(frame);
        });
        presentationPixels();
        check(after.every((matrix, i) => Math.abs(matrix[14] - before[i][14]) > 0.1), 'clip distances change every rendered view projection');
        if (sessionMode === 'inline') check(Math.abs(after[0][5] - before[0][5]) > 0.1, 'inline FOV changes the rendered projection');
        await frame(frame => {
          const state = session.renderState;
          session.updateRenderState({depthNear: -5, depthFar: 1e100, ...(sessionMode === 'inline' ? {inlineVerticalFieldOfView: -5} : {})});
          check(session.renderState === state, 'out-of-range values remain pending within the current frame');
          void frame;
        });
        await frame(frame => {
          check(session.renderState.depthNear === 0.01 && session.renderState.depthFar === 10000, 'pending numeric limits activate before rendering');
          for (const view of frame.getViewerPose(space)!.views) {
            check(view.projectionMatrix.every(Number.isFinite) && Math.abs(view.projectionMatrix[14] + 0.02000002) < 1e-6, 'projection is constructed from clamped near/far values');
            if (sessionMode === 'inline') check(session.renderState.inlineVerticalFieldOfView === 0.01 && Math.abs(view.projectionMatrix[5] - 1 / Math.tan(0.01 / 2)) < 1e-4, 'inline projection is constructed from the activated FOV clamp');
          }
        });
        const peer = await xr.navigator.xr.requestSession('inline');
        try {
          const foreign = new xr.XRWebGLLayer(peer, gl);
          throws(() => session.updateRenderState({baseLayer: foreign, depthNear: 'invalid'}), 'TypeError', 'numeric argument conversion precedes foreign ownership');
          throws(() => session.updateRenderState({baseLayer: foreign, depthNear: 7}), 'InvalidStateError', 'foreign-session baseLayer remains rejected');
        } finally { await peer.end(); }
        await session.end();
        for (const input of [undefined, null, {}, {depthNear: undefined}]) throws(() => session.updateRenderState(input), 'InvalidStateError', 'ended session rejects converted empty input');
        throws(() => session.updateRenderState(), 'InvalidStateError', 'ended session rejects omitted input');
        throws(() => session.updateRenderState(false), 'TypeError', 'dictionary conversion precedes ended check');
        throws(() => session.updateRenderState({depthNear: Infinity}), 'TypeError', 'numeric conversion precedes ended check');
        let endedGetter: unknown;
        try { session.updateRenderState({get depthFar() { throw sentinel; }}); } catch (error) { endedGetter = error; }
        check(endedGetter === sentinel, 'getter exception precedes ended check');
        gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteFramebuffer(framebuffer);
      } finally { if (!session.ended) await session.end(); canvas.remove(); }
    }
    return {mode, handheld, assertions: passed.length, passed};
  }, {mode, handheld});
}
