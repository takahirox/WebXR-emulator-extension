import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';
type API = typeof Runtime & typeof Layers & {navigator: {xr: Runtime.XRSystem}};

/** Original binding/lifetime cases derived from pinned Device, Layers and WebIDL. */
export async function runFixedFoveation(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'foveation-realm'; frame.src = '/frame'; document.body.append(frame);
  });
  await page.frameLocator('#foveation-realm').locator('body').waitFor();
  try {
    return await page.evaluate(async (options) => {
      'use strict';
      const {mode, handheld} = options;
      const api = window as unknown as API, passed: string[] = [];
      function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed.push(label); }
      function throws(action: () => unknown, label: string) {
        let error: unknown; try { action(); } catch (caught) { error = caught; }
        check(!!error && (error as Error).name === 'TypeError', `${label}: TypeError (${String(error)})`);
      }
      type Layer = Layers.XRWebGLLayer | Layers.XRProjectionLayer;
      function descriptor(C: {prototype: object}) { return Object.getOwnPropertyDescriptor(C.prototype, 'fixedFoveation')!; }
      function contract(layer: Layer, C: {prototype: object}, label: string, other?: Layer) {
        const d = descriptor(C);
        check(typeof d.get === 'function' && typeof d.set === 'function' && d.enumerable && d.configurable && !('value' in d), `${label}: writable enumerable configurable prototype accessor`);
        check(!Object.prototype.hasOwnProperty.call(layer, 'fixedFoveation') && layer.fixedFoveation === null, `${label}: initial null without own shadow`);
        const valid: unknown[] = [null, undefined, 0, -0, 0.5, 1, -3, 4, '0.75', '', true, false, Number.MIN_VALUE, 3.4028234663852886e38, -3.4028234663852886e38, 3.4028235e38, -3.4028235e38];
        for (const [index, value] of valid.entries()) {
          layer.fixedFoveation = value;
          check(layer.fixedFoveation === null && !Object.prototype.hasOwnProperty.call(layer, 'fixedFoveation'), `${label}: strict converted no-op ${index}`);
        }
        let calls = 0;
        layer.fixedFoveation = {[Symbol.toPrimitive](hint: string) { calls++; check(hint === 'number', `${label}: ToNumber hint`); return '0.25'; }};
        check(calls === 1 && layer.fixedFoveation === null, `${label}: conversion exactly once`);
        const trace: string[] = [];
        layer.fixedFoveation = {valueOf() { trace.push('valueOf'); return {}; }, toString() { trace.push('toString'); return '2'; }};
        check(trace.join() === 'valueOf,toString', `${label}: ordinary primitive conversion order`);
        for (const [index, value] of [NaN, Infinity, -Infinity, 3.5e38, -3.5e38, 3.4028235677973366e38, -3.4028235677973366e38, Number.MAX_VALUE, Symbol(), BigInt(1), Object(BigInt(1)), {valueOf() { return Infinity; }}, {valueOf() { return Symbol(); }}].entries()) {
          throws(() => { layer.fixedFoveation = value; }, `${label}: invalid conversion ${index}`);
          check(layer.fixedFoveation === null, `${label}: failed conversion keeps null ${index}`);
        }
        const sentinel = new Error('coercion sentinel');
        for (const value of [{[Symbol.toPrimitive]() { throw sentinel; }}, {valueOf() { throw sentinel; }}, {valueOf() { return {}; }, toString() { throw sentinel; }}]) {
          let error: unknown; try { layer.fixedFoveation = value; } catch (caught) { error = caught; }
          check(error === sentinel, `${label}: coercion exception identity`);
        }
        // Public constructors expose their allocation ancestry. Neither calling
        // those bases directly nor supplying Object/the matching public
        // constructor as newTarget may manufacture a matching layer brand.
        const allocations = [
          [Object.getPrototypeOf(api.XRWebGLLayer), []],
          [Object.getPrototypeOf(api.XRCompositionLayer), [true]],
        ] as const;
        const allocatedForgeries = allocations.flatMap(([base, args]) => [
          Reflect.construct(base, args), Reflect.construct(base, args, Object), Reflect.construct(base, args, C as Function),
        ]);
        for (const [index, fake] of [undefined, null, 1, {}, C.prototype, Object.create(C.prototype), new Proxy(layer, {}), ...(other ? [other] : []), ...allocatedForgeries].entries()) {
          throws(() => d.get!.call(fake), `${label}: getter receiver ${index}`);
          let reads = 0;
          throws(() => d.set!.call(fake, {[Symbol.toPrimitive]() { reads++; throw sentinel; }}), `${label}: setter receiver before conversion ${index}`);
          check(reads === 0, `${label}: invalid receiver does not coerce ${index}`);
        }
      }
      // Any GL call from the attributes is a failure, including allocation,
      // mutation and resource queries. Existing resource checks run outside here.
      function noGL(gl: WebGLRenderingContext | WebGL2RenderingContext, action: () => void, label: string) {
        const target = gl as unknown as Record<string, unknown>, saved = new Map<string, PropertyDescriptor | undefined>();
        for (let p = Object.getPrototypeOf(gl); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
          for (const key of Object.getOwnPropertyNames(p)) {
            if (key === 'constructor' || saved.has(key) || typeof Object.getOwnPropertyDescriptor(p, key)?.value !== 'function') continue;
            saved.set(key, Object.getOwnPropertyDescriptor(gl, key));
            Object.defineProperty(gl, key, {configurable: true, value: () => { throw new Error(`${label}: unexpected GL call ${key}`); }});
          }
        }
        try { action(); check(true, `${label}: no GL access`); }
        finally { for (const [key, d] of saved) { if (d) Object.defineProperty(gl, key, d); else delete target[key]; } }
      }
      function retained(layer: Layer, label: string) {
        layer.fixedFoveation = 0.9; layer.fixedFoveation = null;
        check(layer.fixedFoveation === null, `${label}: retained null/no-op`);
        throws(() => { layer.fixedFoveation = 3.5e38; }, `${label}: retained invalid conversion`);
      }
      for (const path of ['webgl', 'webgl2'] as const) for (const inline of [false, true]) {
        const label = `${path}/${inline ? 'inline' : mode}`;
        const session = await api.navigator.xr.requestSession(inline ? 'inline' : mode);
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
        const gl = canvas.getContext(path, {antialias: false, preserveDrawingBuffer: true}) as WebGLRenderingContext | WebGL2RenderingContext;
        await gl.makeXRCompatible();
        const base = new api.XRWebGLLayer(session, gl, {antialias: false});
        const binding = !inline && path === 'webgl2' ? new api.XRWebGLBinding(session, gl) : null;
        const projection = binding?.createProjectionLayer({clearOnAccess: false});
        const space = await session.requestReferenceSpace('viewer');
        const next = (action: (frame: Runtime.XRFrame) => void) => new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`${label}: frame timeout`)), 10000);
          session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { action(frame); resolve(); } catch (error) { reject(error); } });
        });
        try {
          const features = session.enabledFeatures.join();
          noGL(gl, () => {
            contract(base, api.XRWebGLLayer, `${label}/base`, projection);
            if (projection) contract(projection, api.XRProjectionLayer, `${label}/projection`, base);
          }, `${label}/outside callback`);
          session.updateRenderState({baseLayer: base});
          await next(() => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, base.framebuffer);
            gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT);
            const pixel = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            const before = pixel.join(), identity = base.framebuffer, width = base.framebufferWidth, height = base.framebufferHeight;
            noGL(gl, () => retained(base, `${label}/during callback`), label);
            gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            check(pixel.join() === before && pixel[2] > 180 && base.framebuffer === identity && base.framebufferWidth === width && base.framebufferHeight === height, `${label}: base pixels identity dimensions unchanged`);
          });
          if (projection && binding) {
            session.updateRenderState({layers: [projection]});
            await next(frame => {
              const image = binding.getViewSubImage(projection, frame.getViewerPose(space)!.views[0]);
              const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.colorTexture, 0);
              gl.clearColor(0.75, 0.25, 0.5, 1); gl.clear(gl.COLOR_BUFFER_BIT);
              const pixel = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); const before = pixel.join();
              noGL(gl, () => retained(projection, `${label}/projection callback`), label);
              const after = binding.getViewSubImage(projection, frame.getViewerPose(space)!.views[0]);
              gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              check(pixel.join() === before && pixel[0] > 180 && after.colorTexture === image.colorTexture && after.depthStencilTexture === image.depthStencilTexture && after.colorTextureWidth === image.colorTextureWidth && after.colorTextureHeight === image.colorTextureHeight, `${label}: projection pixels textures dimensions unchanged`);
              gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
            });
            projection.destroy();
            check(!gl.isTexture(projection._color), `${label}: projection texture deleted`);
            noGL(gl, () => retained(projection, `${label}/destroyed`), label);
            check(!gl.isTexture(projection._color), `${label}: destroyed texture stays deleted`);
          }
          check(session.enabledFeatures.join() === features && !session.enabledFeatures.includes('layers'), `${label}: feature negotiation unchanged`);
          const lostProjection = binding?.createProjectionLayer();
          gl.getExtension('WEBGL_lose_context')!.loseContext();
          await new Promise(resolve => setTimeout(resolve, 50));
          noGL(gl, () => { retained(base, `${label}/lost`); if (projection) retained(projection, `${label}/lost destroyed projection`); if (lostProjection) retained(lostProjection, `${label}/lost live projection`); }, label);
          await session.end();
          noGL(gl, () => { retained(base, `${label}/ended`); if (projection) retained(projection, `${label}/ended projection`); if (lostProjection) retained(lostProjection, `${label}/ended lost projection`); }, label);
          check(session._webglLayers.size === 0, `${label}: no allocations resurrected`);
        } finally { if (!session.ended) await session.end(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      }
      const foreign = document.querySelector<HTMLIFrameElement>('#foveation-realm')!.contentWindow!;
      const foreignAPI = foreign as unknown as API;
      async function allocate(realm: Window, w: API) {
        const session = await w.navigator.xr.requestSession(mode, {requiredFeatures: ['layers']});
        const gl = realm.document.createElement('canvas').getContext('webgl2')!; await gl.makeXRCompatible();
        const base = new w.XRWebGLLayer(session, gl);
        const projection = new w.XRWebGLBinding(session, gl).createProjectionLayer();
        return {session, gl, base, projection};
      }
      const local = await allocate(window, api);
      try {
        // Even a newly allocated quad with a forged projection prototype must
        // retain its actual interface brand. Restore exposure before cleanup.
        const quadPrototype = Object.getPrototypeOf(api.XRQuadLayer.prototype);
        const binding = new api.XRWebGLBinding(local.session, local.gl);
        const space = await local.session.requestReferenceSpace('viewer');
        let quad: Layers.XRQuadLayer;
        try {
          Object.setPrototypeOf(api.XRQuadLayer.prototype, api.XRProjectionLayer.prototype);
          quad = binding.createQuadLayer({space, viewPixelWidth: 32, viewPixelHeight: 32});
          noGL(local.gl, () => {
            const d = descriptor(api.XRProjectionLayer);
            throws(() => d.get!.call(quad), 'allocated quad with forged prototype: getter');
            let reads = 0;
            throws(() => d.set!.call(quad, {valueOf() { reads++; return 1; }}), 'allocated quad with forged prototype: setter');
            check(reads === 0, 'allocated quad with forged prototype: receiver before conversion');
          }, 'allocated quad with forged prototype');
        } finally { Object.setPrototypeOf(api.XRQuadLayer.prototype, quadPrototype); }
        quad.destroy();
        const remote = await allocate(foreign, foreignAPI);
        try {
          check(!(remote.base instanceof api.XRWebGLLayer) && !(remote.projection instanceof api.XRProjectionLayer), 'genuine layers have distinct injected realm prototypes');
          for (const [owner, borrower, name] of [[local, foreignAPI, 'local'], [remote, api, 'foreign']] as const) {
            for (const [layer, C, other] of [[owner.base, borrower.XRWebGLLayer, owner.projection], [owner.projection, borrower.XRProjectionLayer, owner.base]] as const) {
              noGL(owner.gl, () => contract(layer, C, `${name}/${C.name}/borrowed`, other), name);
            }
          }
          await local.session.end(); await remote.session.end();
          document.querySelector('#foveation-realm')!.remove();
          for (const [owner, borrower] of [[local, foreignAPI], [remote, api]] as const) {
            noGL(owner.gl, () => {
              for (const [layer, C] of [[owner.base, borrower.XRWebGLLayer], [owner.projection, borrower.XRProjectionLayer]] as const) {
                const d = descriptor(C); d.set!.call(layer, '0.8');
                check(d.get!.call(layer) === null, 'cross-realm retained accessor after end');
                throws(() => d.set!.call(layer, Infinity), 'cross-realm retained invalid conversion');
              }
            }, 'cross-realm ended');
          }
        } finally { if (!remote.session.ended) await remote.session.end(); remote.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      } finally { if (!local.session.ended) await local.session.end(); local.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      return {mode, handheld, assertions: passed.length, passed};
    }, {mode, handheld});
  } finally { await page.evaluate(() => document.querySelector('#foveation-realm')?.remove()); }
}
