import type {XRSession, XRFrame} from './runtime';
import type {XRWebGLLayer, XRWebGLBinding, LayerInit} from './layers';
import type {XRFramebuffer} from '../xr-framebuffer';

/** Shared constructors allocate complete layer records; no public writer can
 * attach a brand to a caller-supplied object or register a membership predicate. */
export function createLayerAllocations(sessions: WeakSet<object>) {
  const webgl = new WeakSet<object>(), projection = new WeakSet<object>();
  const gl1Attributes = WebGLRenderingContext.prototype.getContextAttributes;
  const gl2Attributes = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype.getContextAttributes;
  class WebGLLayerAllocation extends EventTarget {
    readonly lost = () => (this as unknown as XRWebGLLayer)._dispose();
    constructor(readonly _session: XRSession, readonly context: WebGLRenderingContext | WebGL2RenderingContext, storage: XRFramebuffer | null) {
      super();
      if (!sessions.has(_session)) throw new TypeError('Expected XRSession.');
      // Native receiver checks also accept contexts from another injected realm.
      try { gl1Attributes.call(context); }
      catch {
        if (!gl2Attributes) throw new TypeError('Expected WebGL context.');
        gl2Attributes.call(context as WebGL2RenderingContext);
      }
      _session._assertLive();
      if (_session._mode !== 'inline') {
        if (!storage) throw new TypeError('Expected layer framebuffer storage.');
        storage.active = _session._inAnimationCallback;
        _session._webglLayers.add(this as unknown as XRWebGLLayer);
        context.canvas.addEventListener('webglcontextlost', this.lost);
      }
      webgl.add(this);
    }
  }
  class CompositionLayerAllocation extends EventTarget {
    readonly layout: string;
    blendTextureSourceAlpha = true;
    readonly chromaticAberrationCorrection = null;
    forceMonoPresentation = false;
    readonly mipLevels = 1;
    readonly quality = 'default';
    opacity = 1;
    readonly _color: WebGLTexture;
    readonly _depth: WebGLTexture | null;
    readonly _hasStencil: boolean;
    _width = 0; _height = 0; _destroyed = false;
    readonly _clearOnAccess: boolean;
    _needsClear = true;
    _lastClearFrame: XRFrame | null = null;
    _needsRedraw = true;
    constructor(readonly _binding: XRWebGLBinding, readonly _init: LayerInit) {
      super();
      this.layout = _init.layout ?? 'mono';
      this._clearOnAccess = _init.clearOnAccess === undefined || Boolean(_init.clearOnAccess);
      const gl = _binding._gl2(); this._color = gl.createTexture()!;
      this._depth = _init.depthFormat === 0 ? null : gl.createTexture();
      this._hasStencil = _init.depthFormat === gl.DEPTH_STENCIL || _init.depthFormat === gl.DEPTH24_STENCIL8;
    }
  }
  class ProjectionLayerAllocation extends CompositionLayerAllocation {
    readonly ignoreDepthValues = true;
    readonly deltaPose = null;
    constructor(binding: XRWebGLBinding, init: LayerInit) { super(binding, init); projection.add(this); }
  }
  for (const C of [WebGLLayerAllocation, CompositionLayerAllocation, ProjectionLayerAllocation]) {
    Object.freeze(C.prototype); Object.freeze(C);
  }
  return Object.freeze({WebGLLayerAllocation, CompositionLayerAllocation, ProjectionLayerAllocation,
    webgl: Object.freeze({has: (value: object) => webgl.has(value)}),
    projection: Object.freeze({has: (value: object) => projection.has(value)}),
  });
}
