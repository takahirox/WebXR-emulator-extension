import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';
import type * as Geometry from '../src/polyfill/api/geometry';
type XRWindow = typeof Runtime & typeof Layers & typeof Geometry & {navigator: {xr: Runtime.XRSystem}};

/** Pinned Device/WPT assertions adapted to real extension sessions, plus pixels. */
export async function runWebGLLayer(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate('globalThis.__name = value => value');
  return page.evaluate(async ({mode, handheld}) => {
    const xr = window as unknown as XRWindow;
    const passed: string[] = [], observations: unknown[] = [];
    let label = '';
    function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`${label}: ${message}`); passed.push(`${label}: ${message}`); }
    function throws(action: () => unknown, name: string) {
      let error: unknown; try { action(); } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, `throws ${name}, got ${String(error)}`);
    }
    for (const path of ['webgl', 'webgl2'] as const) for (const inline of [false, true]) {
      label = `${mode}/${handheld ? 'phone' : 'headset'}/${path}/${inline ? 'inline' : 'immersive'}`;
      const session = await xr.navigator.xr.requestSession(inline ? 'inline' : mode);
      const canvas = document.createElement('canvas'); canvas.width = 63; canvas.height = 45;
      const gl = canvas.getContext(path, {alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: true}) as WebGLRenderingContext | WebGL2RenderingContext;
      if (!inline) throws(() => new xr.XRWebGLLayer(session, gl), 'InvalidStateError');
      else check(new xr.XRWebGLLayer(session, gl).framebuffer === null, 'inline accepts incompatible context');
      await gl.makeXRCompatible();
      const recommendation = session._device.getRecommendedFramebufferSize;
      // Deterministic odd recommendations exercise allocation independently of display size.
      session._device.getRecommendedFramebufferSize = () => ({width: 321, height: 123});
      const space = await session.requestReferenceSpace('viewer');
      const next = <T>(action: (frame: Runtime.XRFrame) => T) => new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${label}: frame timeout`)), 15000);
        session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(action(frame)); } catch (error) { reject(error); } });
      });
      try {
        check(!session.enabledFeatures.includes('layers'), 'Device layers require no feature');
        const keys = ['alpha', 'antialias', 'depth', 'framebufferScaleFactor', 'ignoreDepthValues', 'stencil'];
        let allocations = 0; const originalCreate = gl.createFramebuffer;
        gl.createFramebuffer = function() { allocations++; return originalCreate.call(this); };
        for (const dictionary of [1, true, '', Symbol(), {framebufferScaleFactor: Infinity}, {framebufferScaleFactor: NaN}, {framebufferScaleFactor: BigInt(1)}, {framebufferScaleFactor: Symbol()}]) throws(() => new xr.XRWebGLLayer(session, gl, dictionary), 'TypeError');
        const sentinel = new Error('conversion sentinel');
        for (const key of keys) {
          let error: unknown; try { new xr.XRWebGLLayer(session, gl, Object.defineProperty({}, key, {get() { throw sentinel; }})); } catch (caught) { error = caught; }
          check(error === sentinel, 'conversion exception identity propagates');
        }
        let conversionError: unknown; try { new xr.XRWebGLLayer(session, gl, {framebufferScaleFactor: {valueOf() { throw sentinel; }}}); } catch (caught) { conversionError = caught; }
        check(conversionError === sentinel, 'finite-double conversion exception propagates unchanged');
        check(allocations === 0, 'dictionary failures allocate nothing');
        const trace: string[] = [];
        const inherited = Object.create(null);
        for (const key of keys) Object.defineProperty(inherited, key, {get() { trace.push(key); return key === 'framebufferScaleFactor' ? {valueOf() { trace.push('number'); return '0.5'; }} : key === 'stencil' ? {} : key === 'antialias' ? 0 : undefined; }});
        const scaled = new xr.XRWebGLLayer(session, gl, Object.create(inherited));
        check(trace.join() === 'alpha,antialias,depth,framebufferScaleFactor,number,ignoreDepthValues,stencil', 'inherited ordered getters converted exactly once');
        const layer = new xr.XRWebGLLayer(session, gl, {antialias: false, stencil: true});
        const omitted = new xr.XRWebGLLayer(session, gl), nullDictionary = new xr.XRWebGLLayer(session, gl, null);
        gl.createFramebuffer = originalCreate;
        check(layer instanceof xr.XRLayer && layer instanceof EventTarget, 'XRLayer inheritance');
        const identity = layer.framebuffer;
        check(!Reflect.set(layer, 'framebuffer', null) && !Reflect.set(layer, 'framebufferWidth', 1) && !Reflect.set(layer, 'framebufferHeight', 1) && identity === layer.framebuffer, 'readonly identity and dimensions');
        check(layer.ignoreDepthValues, 'compositor ignores application depth');
        if (inline) {
          check(identity === null && scaled.framebuffer === null && !layer.antialias, 'inline uses actual default buffer properties');
          canvas.width = 91; check(layer.framebufferWidth === 91, 'inline follows default buffer resize');
        } else {
          check(identity !== null && gl.isFramebuffer(identity) && identity !== scaled.framebuffer && omitted.framebuffer !== nullDictionary.framebuffer, 'distinct stable supplied-context framebuffers');
          check(layer.framebufferWidth === 321 && layer.framebufferHeight === 123 && scaled.framebufferWidth === 160 && scaled.framebufferHeight === 61, 'scales 1 and 0.5 allocate rounded owned storage');
          for (const scale of [-Number.MAX_VALUE, -1, 0, Number.MIN_VALUE, Number.MAX_VALUE]) {
            const bounded = new xr.XRWebGLLayer(session, gl, {framebufferScaleFactor: scale, antialias: false});
            check(bounded.framebufferWidth >= (handheld ? 1 : 2) && bounded.framebufferWidth <= 4096 && bounded.framebufferWidth * bounded.framebufferHeight <= 4194304, `bounded finite scale ${scale}`);
          }
          const renderbuffer = gl.createRenderbuffer, created: WebGLFramebuffer[] = [], deleted: WebGLFramebuffer[] = [];
          const deleteFramebuffer = gl.deleteFramebuffer;
          gl.createFramebuffer = function() { const value = originalCreate.call(this); if (value) created.push(value); return value; };
          gl.deleteFramebuffer = function(value) { if (value) deleted.push(value); deleteFramebuffer.call(this, value); };
          gl.createRenderbuffer = () => null as unknown as WebGLRenderbuffer;
          throws(() => new xr.XRWebGLLayer(session, gl, {antialias: false}), 'OperationError');
          gl.createRenderbuffer = renderbuffer; gl.createFramebuffer = originalCreate; gl.deleteFramebuffer = deleteFramebuffer;
          check(created.length > 0 && created.every(value => deleted.includes(value) && !gl.isFramebuffer(value)), 'partial allocation rollback');
          gl.bindFramebuffer(gl.FRAMEBUFFER, identity);
          check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_UNSUPPORTED, 'unavailable outside owning callback');
          gl.deleteFramebuffer(identity); check(gl.getError() === gl.INVALID_OPERATION && gl.getParameter(gl.FRAMEBUFFER_BINDING) === identity, 'opaque deletion rejects and preserves binding');
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); check(gl.getError() === gl.INVALID_OPERATION, 'attachment mutation rejects');
          check(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === null && gl.getError() === gl.INVALID_OPERATION, 'attachment inspection rejects');
          if (path === 'webgl') {
            const frame = document.createElement('iframe'); document.body.append(frame);
            const pristine = (frame.contentWindow as unknown as typeof window).WebGLRenderingContext.prototype.getFramebufferAttachmentParameter;
            const nativeAttachment = pristine.call(gl, gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
            observations.push({label, sameOriginPristineRealmBypass: nativeAttachment instanceof WebGLTexture, error: gl.getError()});
            frame.remove();
          }
          gl.clear(gl.COLOR_BUFFER_BIT); check(gl.getError() === gl.INVALID_FRAMEBUFFER_OPERATION, 'outside clear rejects');
          const instanced = gl.getExtension('ANGLE_instanced_arrays');
          if (instanced) { instanced.drawArraysInstancedANGLE(gl.TRIANGLES,0,3,1); check(gl.getError() === gl.INVALID_FRAMEBUFFER_OPERATION, 'extension drawing outside callback rejects'); }
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,null); check(gl.getError() === gl.INVALID_OPERATION, 'renderbuffer attachment mutation rejects');
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); check(gl.getError() === gl.INVALID_FRAMEBUFFER_OPERATION, 'outside read rejects');
        }
        session.updateRenderState({baseLayer: layer});
        let stale: Geometry.XRView | undefined;
        const vertex = gl.createShader(gl.VERTEX_SHADER)!, fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(vertex, 'attribute vec2 p; uniform float z; void main(){gl_Position=vec4(p,z,1.0);}');
        gl.shaderSource(fragment, 'precision mediump float; uniform vec4 color; void main(){gl_FragColor=color;}');
        gl.compileShader(vertex); gl.compileShader(fragment); const program = gl.createProgram()!;
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); check(gl.getProgramParameter(program, gl.LINK_STATUS), 'pixel shaders link');
        gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const attribute = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
        const draw = (z: number, color: number[]) => { gl.uniform1f(gl.getUniformLocation(program, 'z'), z); gl.uniform4fv(gl.getUniformLocation(program, 'color'), color); gl.drawArrays(gl.TRIANGLES, 0, 3); };
        const pixel = () => { const value = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value); return Array.from(value); };
        await next(frame => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
          check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'available inside callback');
          if (!inline) check(pixel().every(value => value === 0), 'owned color initially cleared including alpha');
          const views = frame.getViewerPose(space)!.views; stale = views[0];
          const ports = views.map(view => layer.getViewport(view));
          check(ports.length === (inline || handheld ? 1 : 2) && ports.every(p => Number.isInteger(p.x) && Number.isInteger(p.width) && p.width > 0 && p.height > 0 && p.x + p.width <= layer.framebufferWidth), 'positive bounded integer viewports');
          if (ports.length === 2) check(ports[0].x + ports[0].width <= ports[1].x && ports[1].width === 161, 'odd-width stereo regions do not overlap');
          gl.viewport(0, 0, layer.framebufferWidth, layer.framebufferHeight);
          if (!inline) {
            gl.enable(gl.DEPTH_TEST); draw(-0.5, [1,0,0,1]); draw(0.5, [0,1,0,1]);
            check(pixel()[0] === 255 && pixel()[1] === 0, 'requested depth works without default-context depth'); gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 1, 0xff); draw(0, [0,1,0,1]); check(pixel()[0] === 255, 'stencil initially zero rejects reference one');
            gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); draw(0, [1,0,0,1]);
            gl.stencilFunc(gl.EQUAL, 1, 0xff); draw(0, [0,1,0,1]); check(pixel()[1] === 255, 'requested stencil writes and tests independently of default attachments'); gl.disable(gl.STENCIL_TEST);
          }
          gl.enable(gl.SCISSOR_TEST);
          for (let i = 0; i < ports.length; i++) { const p = ports[i]; gl.scissor(p.x, 0, p.width, p.height); gl.clearColor(i ? 0 : 0.25, i ? 0.5 : 0, 0, 0.5); gl.clear(gl.COLOR_BUFFER_BIT); }
          gl.disable(gl.SCISSOR_TEST);
        });
        if (!inline) {
          const output = layer._presentationCanvas as HTMLCanvasElement;
          const actual = Array.from(output.getContext('2d')!.getImageData(2, 2, 1, 1).data);
          check(Math.abs(actual[0] - 128) <= 2 && Math.abs(actual[3] - 128) <= 1, `presentation unpremultiplies encoded colors without extra gamma (${actual})`);
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.drawArrays(gl.TRIANGLES, 0, 3); check(gl.getError() === gl.INVALID_FRAMEBUFFER_OPERATION, 'drawing unavailable after callback');
          gl.drawElements(gl.TRIANGLES,3,gl.UNSIGNED_SHORT,0); check(gl.getError() === gl.INVALID_FRAMEBUFFER_OPERATION, 'indexed drawing unavailable after callback');
          await next(frame => {
            throws(() => layer.getViewport(stale!), 'InvalidStateError');
            gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); check(pixel().every(value => value === 0), 'owned storage cleared on next frame despite preserveDrawingBuffer');
          });
          check(Array.from(output.getContext('2d')!.getImageData(2,2,1,1).data).join() === actual.join(), 'display retains completed rendering when next callback does not draw');
          if (!handheld) {
            const originalStereo = session._device.stereoEffectEnabled;
            for (const enabled of [true, false]) {
              window.dispatchEvent(new CustomEvent('webxr-stereo-effect', {detail:{enabled}}));
              await next(frame => {
                gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.enable(gl.SCISSOR_TEST);
                const views = frame.getViewerPose(space)!.views;
                for (let i = 0; i < views.length; i++) {
                  const p = layer.getViewport(views[i]);
                  check(p.width === (i ? 161 : 160) && p.x === (i ? 160 : 0), `usable exposed eyes with stereo preview ${enabled}`);
                  check(Math.abs(views[i].projectionMatrix[0] - 123 / p.width) < 1e-5, 'eye projection follows allocated odd-width region');
                  gl.scissor(p.x,0,p.width,p.height); gl.clearColor(i ? 0 : 1, i ? 1 : 0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
                }
                gl.disable(gl.SCISSOR_TEST);
                const source = new Uint8Array(4); gl.readPixels(300,2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,source);
                check(source[1] === 255, 'right-eye application pixels remain usable in both preview settings');
              });
              const preview = output.getContext('2d')!.getImageData(300,2,1,1).data;
              check(preview[enabled ? 1 : 0] === 255 && preview[enabled ? 0 : 1] === 0, `preview ${enabled} presents stereo or selected left eye`);
            }
            window.dispatchEvent(new CustomEvent('webxr-stereo-effect', {detail:{enabled:originalStereo}}));
          }
          session._device.getRecommendedFramebufferSize = () => ({width:377,height:137});
          const current = new xr.XRWebGLLayer(session,gl,{antialias:false});
          check(current.framebufferWidth === 377 && current.framebufferHeight === 137 && layer.framebufferWidth === 321, 'new layers use current recommendations while existing storage stays fixed');
          session._device.getRecommendedFramebufferSize = () => ({width:321,height:123});
          const savedDraw = gl.createFramebuffer(), savedRead = gl.createFramebuffer();
          const savedRB = gl.createRenderbuffer(), savedTexture = gl.createTexture();
          gl.bindFramebuffer(gl.FRAMEBUFFER, savedDraw); gl.bindRenderbuffer(gl.RENDERBUFFER, savedRB);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, savedTexture);
          gl.colorMask(false,true,false,true); gl.depthMask(false); gl.stencilMaskSeparate(gl.FRONT, 0x12); gl.stencilMaskSeparate(gl.BACK, 0x34);
          gl.clearColor(0.2,0.3,0.4,0.5); gl.clearDepth(0.25); gl.clearStencil(7); gl.enable(gl.SCISSOR_TEST); gl.scissor(1,2,3,4);
          let pack: WebGLBuffer | null = null, unpack: WebGLBuffer | null = null;
          if (gl instanceof WebGL2RenderingContext) {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, savedRead); gl.enable(gl.RASTERIZER_DISCARD);
            pack = gl.createBuffer(); unpack = gl.createBuffer();
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpack);
            gl.pixelStorei(gl.PACK_ROW_LENGTH, 7); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 2); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 9);
          }
          gl.enable(0xdead); // A pending unrelated error must survive compositor work.
          await next(() => {
            const allocated = new xr.XRWebGLLayer(session,gl,{antialias:false});
            check(allocated.framebuffer !== null, 'allocation succeeds with unrelated pack/unpack buffers and discard state');
            check(gl.getParameter(gl.FRAMEBUFFER_BINDING) === savedDraw, 'implicit clearing preserves draw binding');
            if (gl instanceof WebGL2RenderingContext) check(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === savedRead, 'implicit clearing preserves distinct read binding');
          });
          check(gl.getError() === gl.INVALID_ENUM && gl.getError() === gl.NO_ERROR, 'existing GL error preserved without extra errors');
          check(gl.getParameter(gl.FRAMEBUFFER_BINDING) === savedDraw && gl.getParameter(gl.RENDERBUFFER_BINDING) === savedRB && gl.getParameter(gl.TEXTURE_BINDING_2D) === savedTexture && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE1, 'presentation preserves framebuffer renderbuffer texture and active unit');
          check(gl.getParameter(gl.COLOR_WRITEMASK).join() === 'false,true,false,true' && !gl.getParameter(gl.DEPTH_WRITEMASK) && gl.getParameter(gl.STENCIL_WRITEMASK) === 0x12 && gl.getParameter(gl.STENCIL_BACK_WRITEMASK) === 0x34 && gl.getParameter(gl.STENCIL_CLEAR_VALUE) === 7 && gl.getParameter(gl.DEPTH_CLEAR_VALUE) === 0.25 && gl.isEnabled(gl.SCISSOR_TEST), 'clear preserves masks clear values and scissor');
          if (gl instanceof WebGL2RenderingContext) {
            check(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === savedRead && gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === pack && gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) === unpack && gl.getParameter(gl.PACK_ROW_LENGTH) === 7 && gl.getParameter(gl.UNPACK_ROW_LENGTH) === 9 && gl.isEnabled(gl.RASTERIZER_DISCARD), 'presentation preserves WebGL2 read pack unpack and discard state');
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); gl.pixelStorei(gl.PACK_ROW_LENGTH,0); gl.pixelStorei(gl.PACK_SKIP_PIXELS,0); gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0); gl.disable(gl.RASTERIZER_DISCARD);
            gl.deleteBuffer(pack); gl.deleteBuffer(unpack);
          }
          gl.disable(gl.SCISSOR_TEST); gl.colorMask(true,true,true,true); gl.depthMask(true); gl.stencilMask(0xff); gl.clearStencil(0); gl.clearDepth(1);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
          gl.deleteFramebuffer(savedDraw); gl.deleteFramebuffer(savedRead); gl.deleteRenderbuffer(savedRB); gl.deleteTexture(savedTexture);
          const foreignSession = await xr.navigator.xr.requestSession('inline');
          const foreignLayer = new xr.XRWebGLLayer(foreignSession, gl);
          await next(frame => {
            throws(() => foreignLayer.getViewport(frame.getViewerPose(space)!.views[0]), 'InvalidStateError');
            const during = new xr.XRWebGLLayer(session, gl, {antialias:false});
            gl.bindFramebuffer(gl.FRAMEBUFFER, during.framebuffer);
            check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'new and never-submitted layers available in owning callback');
          });
          await foreignSession.end();
          const opaque = new xr.XRWebGLLayer(session, gl, {alpha: false, depth: false, antialias: false});
          session.updateRenderState({baseLayer: opaque});
          await next(() => { gl.bindFramebuffer(gl.FRAMEBUFFER, opaque.framebuffer); gl.clearColor(0.25,0.5,0.75,0); gl.clear(gl.COLOR_BUFFER_BIT); check(pixel()[3] === 255, 'RGB storage has no alpha'); });
          check((opaque._presentationCanvas as HTMLCanvasElement).getContext('2d')!.getImageData(2,2,1,1).data[3] === 255, 'alpha false presents opaque');
          const aa = new xr.XRWebGLLayer(session, gl, {alpha: false, antialias: true, depth: false}); session.updateRenderState({baseLayer: aa});
          await next(() => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, aa.framebuffer); gl.viewport(0,0,aa.framebufferWidth,aa.framebufferHeight);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9,-0.9, 0.83,-0.77, -0.71,0.87]), gl.STATIC_DRAW); draw(0,[1,0,0,1]);
            if (gl instanceof WebGL2RenderingContext) gl.readBuffer(gl.NONE);
          });
          const aaPixels = (aa._presentationCanvas as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,aa.framebufferWidth,aa.framebufferHeight).data;
          check(!aa.antialias || aaPixels.some((v,i) => i % 4 === 0 && v > 0 && v < 255), 'reported antialias produces resolved edge coverage');
          if (gl instanceof WebGL2RenderingContext) check(gl.getParameter(gl.READ_BUFFER) === gl.NONE, 'resolve restores application source read-buffer selection');
          check(path !== 'webgl' || !aa.antialias, 'WebGL1 honestly reports no multisampling');
          observations.push({label, antialias: aa.antialias, size: [layer.framebufferWidth, layer.framebufferHeight], scaled: [scaled.framebufferWidth, scaled.framebufferHeight]});
          // Storage identity survives base-layer replacement and application resize.
          canvas.width = 109; canvas.height = 71; session.updateRenderState({baseLayer: layer});
          await next(() => { check(layer.framebuffer === identity && layer.framebufferWidth === 321 && layer.framebufferHeight === 123, 'replacement reuses fixed storage after canvas resize'); });
          const offscreen = new OffscreenCanvas(32, 32), offgl = offscreen.getContext(path) as WebGLRenderingContext | WebGL2RenderingContext; await offgl.makeXRCompatible();
          const offlayer = new xr.XRWebGLLayer(session, offgl, {antialias: false}); session.updateRenderState({baseLayer: offlayer});
          await next(() => { offgl.bindFramebuffer(offgl.FRAMEBUFFER, offlayer.framebuffer); offgl.clearColor(0,0,1,1); offgl.clear(offgl.COLOR_BUFFER_BIT); });
          check((offlayer._presentationCanvas as HTMLCanvasElement).getContext('2d')!.getImageData(2,2,1,1).data[2] === 255, 'main-thread OffscreenCanvas rendering presents');
          const lostCanvas = document.createElement('canvas'), lostGL = lostCanvas.getContext(path) as WebGLRenderingContext | WebGL2RenderingContext; await lostGL.makeXRCompatible();
          const lostLayer = new xr.XRWebGLLayer(session, lostGL), lost = lostGL.getExtension('WEBGL_lose_context')!;
          lost.loseContext(); await new Promise(resolve => setTimeout(resolve, 50));
          throws(() => new xr.XRWebGLLayer(session, lostGL), 'InvalidStateError');
          check(!session._webglLayers.has(lostLayer), 'context loss releases never-submitted allocation');
          const offOutput = offlayer._presentationCanvas as HTMLCanvasElement;
          await next(() => {
            offgl.getExtension('WEBGL_lose_context')!.loseContext();
            session.updateRenderState({baseLayer:layer});
          });
          check(offgl.isContextLost() && (offOutput.width === 1 || offOutput.getContext('2d')!.getImageData(2,2,1,1).data[2] === 255), 'context loss inside callback skips later presentation');
          await new Promise(resolve => setTimeout(resolve,50));
          check(!session._webglLayers.has(offlayer), 'lost active context resources released while replacement remains reusable');
          const all = [...session._webglLayers].filter(l => l.context === gl).map(l => l.framebuffer);
          await next(() => { void session.end(); });
          check(session.ended && session._webglLayers.size === 0 && all.every(f => !gl.isFramebuffer(f)), 'end inside callback releases all session allocations including never submitted');
          throws(() => new xr.XRWebGLLayer(session, gl), 'InvalidStateError');
          throws(() => new xr.XRWebGLLayer(session, gl, {framebufferScaleFactor: Infinity}), 'TypeError');
        }
        check(gl.getError() === gl.NO_ERROR, 'resource rendering leaves no unexpected GL errors');
        gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteBuffer(buffer);
      } finally { session._device.getRecommendedFramebufferSize = recommendation; if (!session.ended) await session.end(); canvas.remove(); }
    }
    return {mode, handheld, passed, observations};
  }, {mode, handheld});
}
