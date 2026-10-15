import {mat4} from 'gl-matrix';
import {XRSpace, XRRigidTransform, XRView, XRViewport, sessionObjects, frameObjects, compatibleContexts, invalidState, unsupported} from './geometry';
import type {XRSession, XRFrame} from './runtime';
import type {BaseLayer} from '../../types/polyfill';
import type {XRLightProbe} from './sensing';

export class XRWebGLLayer implements BaseLayer {
  readonly antialias: boolean;
  readonly ignoreDepthValues = true;
  readonly framebuffer = null;
  readonly fixedFoveation = null;
  constructor(readonly _session: XRSession, readonly context: WebGLRenderingContext | WebGL2RenderingContext, init: {antialias?: boolean; framebufferScaleFactor?: number} = {}) {
    if (!sessionObjects.has(_session)) throw new TypeError('Expected XRSession.'); _session._assertLive();
    if (!(context instanceof WebGLRenderingContext) && !(typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext)) throw new TypeError('Expected WebGL context.');
    if (context.isContextLost() || (_session._mode !== 'inline' && !compatibleContexts.has(context) && !(context.getContextAttributes() as (WebGLContextAttributes & {xrCompatible?: boolean}) | null)?.xrCompatible)) invalidState('WebGL context is lost or not XR compatible.');
    this.antialias = context.getContextAttributes()?.antialias ?? init.antialias ?? false;
  }
  get framebufferWidth() { return this.context.drawingBufferWidth; }
  get framebufferHeight() { return this.context.drawingBufferHeight; }
  getViewport(view: XRView) {
    if (!(view instanceof XRView)) throw new TypeError('Expected XRView.');
    view._frame._assertActive(true); if (view._frame.session !== this._session) invalidState('View belongs to a different session.');
    const target = {x: 0, y: 0, width: 0, height: 0}; this._session._device.getViewport(this._session._id, view.eye, this, target);
    return new XRViewport(target.x, target.y, target.width, target.height);
  }
  static getNativeFramebufferScaleFactor(session: XRSession) { if (!sessionObjects.has(session)) throw new TypeError('Expected XRSession.'); return session.ended ? 0 : 1; }
}


type GL = WebGL2RenderingContext;
interface LayerInit {
  colorFormat?: number; depthFormat?: number | null; textureType?: string; scaleFactor?: number;
  space?: XRSpace; transform?: XRRigidTransform; width?: number; height?: number;
  viewPixelWidth?: number; viewPixelHeight?: number; layout?: string; isStatic?: boolean;
  mipLevels?: number; clearOnAccess?: boolean;
}
function validateLayerSpace(session: XRSession, space: XRSpace) {
  if (!(space instanceof XRSpace) || space._session !== session) throw new TypeError('Layer space must belong to the same session.');
  return space;
}
export class XRLayer extends EventTarget {}
export class XRCompositionLayer extends XRLayer {
  readonly layout: string;
  blendTextureSourceAlpha = true;
  readonly chromaticAberrationCorrection = null;
  forceMonoPresentation = false;
  readonly mipLevels = 1;
  readonly quality = 'default';
  opacity = 1;
  readonly _color: WebGLTexture;
  readonly _depth: WebGLTexture | null;
  _width = 0; _height = 0; _destroyed = false;
  readonly _clearOnAccess: boolean;
  _needsClear = true;
  _lastClearFrame: XRFrame | null = null;
  private redraw = true;
  constructor(readonly _binding: XRWebGLBinding, readonly _init: LayerInit) {
    super(); this.layout = _init.layout ?? 'mono';
    this._clearOnAccess = _init.clearOnAccess === undefined || Boolean(_init.clearOnAccess);
    const gl = _binding._gl2(); this._color = gl.createTexture()!;
    this._depth = _init.depthFormat === 0 ? null : gl.createTexture();
  }
  get needsRedraw() { return this.redraw; }
  get textureWidth() { return this._width; }
  get textureHeight() { return this._height; }
  get textureArrayLength() { return 1; }
  get textureType() { return 'texture'; }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const gl = this._binding._gl2(); gl.deleteTexture(this._color); gl.deleteTexture(this._depth);
    this._binding._session._removeLayer(this);
  }
  _allocate(width: number, height: number) {
    const gl = this._binding._gl2();
    if (width === this._width && height === this._height) return;
    this._width = width; this._height = height; this.redraw = true; this._needsClear = true;
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const unpackBuffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    try {
      gl.bindTexture(gl.TEXTURE_2D, this._color);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.LINEAR);
      for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
      if (this._depth) {
        gl.bindTexture(gl.TEXTURE_2D, this._depth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
      }
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBuffer);
    }
  }
}
export class XRProjectionLayer extends XRCompositionLayer {
  readonly fixedFoveation = null;
  readonly ignoreDepthValues = true;
  readonly deltaPose = null;
}
export class XRQuadLayer extends XRCompositionLayer {
  private spaceValue: XRSpace;
  get space() { return this.spaceValue; }
  set space(value: XRSpace) { this.spaceValue = validateLayerSpace(this._binding._session, value); }
  transform: XRRigidTransform;
  width: number; height: number;
  constructor(binding: XRWebGLBinding, init: LayerInit & {space: XRSpace}) {
    super(binding, init); this.spaceValue = validateLayerSpace(binding._session, init.space); this.transform = init.transform ?? new XRRigidTransform();
    this.width = init.width ?? 1; this.height = init.height ?? 1;
  }
}
export class XRSubImage { constructor(readonly viewport: XRViewport) {} }
export class XRWebGLSubImage extends XRSubImage {
  readonly imageIndex = 0;
  readonly motionVectorTexture = null;
  readonly depthStencilTextureWidth: number | null;
  readonly depthStencilTextureHeight: number | null;
  constructor(viewport: XRViewport, readonly colorTexture: WebGLTexture, readonly depthStencilTexture: WebGLTexture | null,
    readonly colorTextureWidth: number, readonly colorTextureHeight: number) {
    super(viewport);
    this.depthStencilTextureWidth = depthStencilTexture ? colorTextureWidth : null;
    this.depthStencilTextureHeight = depthStencilTexture ? colorTextureHeight : null;
  }
}

export class XRWebGLBinding {
  readonly nativeProjectionScaleFactor = 1;
  readonly _presentation: XRWebGLLayer;
  private layers = new Set<XRCompositionLayer>();
  private framebuffer: WebGLFramebuffer | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  constructor(readonly _session: XRSession, readonly _context: WebGLRenderingContext | GL) {
    if (!sessionObjects.has(_session)) throw new TypeError('Expected XRSession.');
    _session._assertLive(); if (_session._mode === 'inline') invalidState('XRWebGLBinding requires an immersive session.');
    this._presentation = new XRWebGLLayer(_session, _context);
    _session.addEventListener('end', () => {
      for (const layer of this.layers) layer.destroy();
      if (_context instanceof WebGL2RenderingContext) { _context.deleteFramebuffer(this.framebuffer); _context.deleteProgram(this.program); _context.deleteVertexArray(this.vao); }
      this.layers.clear();
    }, {once: true});
  }
  _gl2(): GL { if (!(this._context instanceof WebGL2RenderingContext)) unsupported('Simulated composition layers require WebGL2.'); return this._context as GL; }
  private assert() { this._session._assertLive(); if (this._context.isContextLost()) invalidState('WebGL context is lost.'); }
  private validate(init: LayerInit) {
    this.assert(); const gl = this._gl2();
    if (init.textureType && !['texture', 'texture-array'].includes(init.textureType)) throw new TypeError('Invalid XRTextureType.');
    if (init.textureType === 'texture-array') unsupported('Only 2D textures are implemented.');
    if (init.colorFormat !== undefined && !([gl.RGBA, gl.RGBA8] as number[]).includes(init.colorFormat)) unsupported('Only RGBA8 color textures are implemented.');
    if (init.depthFormat != null && ![0, gl.DEPTH_COMPONENT, gl.DEPTH_COMPONENT24].includes(init.depthFormat)) unsupported('Only DEPTH_COMPONENT24 depth textures are implemented.');
    if (init.mipLevels !== undefined && init.mipLevels !== 1) unsupported('Mipmapped layers are not implemented.');
    if (init.isStatic) unsupported('Static layers are not implemented.');
  }
  createProjectionLayer(init: LayerInit = {}) {
    // XRProjectionLayerInit defaults to DEPTH_COMPONENT; its non-nullable
    // GLenum converts an explicit null to zero (no depth), as Three.js uses.
    init = {...init, depthFormat: init.depthFormat === undefined ? 0x1902 : Number(init.depthFormat)};
    this.validate(init);
    if (init.scaleFactor !== undefined && (!Number.isFinite(init.scaleFactor) || init.scaleFactor <= 0)) throw new TypeError('scaleFactor must be positive.');
    const layer = new XRProjectionLayer(this, {...init, layout: this._session._device.handheld ? 'mono' : 'stereo-left-right'});
    this.initialize(layer); return layer;
  }
  createQuadLayer(init: LayerInit & {space: XRSpace}) {
    // XRLayerInit has a nullable depthFormat with no default depth texture.
    init = {...init, depthFormat: Number(init.depthFormat ?? 0)};
    this._session._require('layers'); this.validate(init); validateLayerSpace(this._session, init.space);
    if (init.layout && init.layout !== 'mono') unsupported('Only mono quad layers are implemented.');
    for (const value of [init.viewPixelWidth, init.viewPixelHeight]) if (value === undefined || !Number.isInteger(value) || value <= 0) throw new TypeError('Quad pixel dimensions must be positive integers.');
    if (init.transform && !(init.transform instanceof XRRigidTransform)) throw new TypeError('Expected XRRigidTransform.');
    if ((init.width ?? 1) <= 0 || (init.height ?? 1) <= 0) throw new TypeError('Quad physical dimensions must be positive.');
    const layer = new XRQuadLayer(this, init); this.initialize(layer); return layer;
  }
  private initialize(layer: XRCompositionLayer) {
    try { this.allocate(layer); this.layers.add(layer); }
    catch (error) { layer.destroy(); throw error; }
  }
  createCylinderLayer(): never { return unsupported('Cylinder layers are not implemented.'); }
  createEquirectLayer(): never { return unsupported('Equirectangular layers are not implemented.'); }
  createCubeLayer(): never { return unsupported('Cube layers are not implemented.'); }
  private check(layer: XRCompositionLayer, frame: XRFrame) {
    this.assert(); frame._assertActive(true);
    if (layer._binding._session !== this._session || layer._binding._context !== this._context || frame.session !== this._session || layer._destroyed) invalidState('Layer/frame is not usable with this binding.');
    if (!this._session.renderState.layers?.includes(layer)) invalidState('Layer is not in the active render state.');
    this.allocate(layer);
    if (layer._needsClear || (layer._clearOnAccess && layer._lastClearFrame !== frame)) {
      this.clear(layer); layer._needsClear = false; layer._lastClearFrame = frame;
    }
  }
  private allocate(layer: XRCompositionLayer) {
    const gl = this._gl2(); const scale = Math.min(1, layer._init.scaleFactor ?? 1);
    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Clients size their render targets immediately. Use the presentation size
    // before the device has resized the application's canvas on its first frame.
    const size = layer instanceof XRProjectionLayer && layer._width === 0 ? this._session._device.getRecommendedFramebufferSize(this._session._id) : {width: gl.drawingBufferWidth, height: gl.drawingBufferHeight};
    const width = layer instanceof XRProjectionLayer ? Math.max(2, Math.floor(size.width * scale)) : layer._init.viewPixelWidth!;
    const height = layer instanceof XRProjectionLayer ? Math.max(1, Math.floor(size.height * scale)) : layer._init.viewPixelHeight!;
    if (width > maximum || height > maximum) unsupported('Layer exceeds MAX_TEXTURE_SIZE.');
    layer._allocate(width, height);
  }
  getViewSubImage(layer: XRProjectionLayer, view: XRView) {
    if (!(layer instanceof XRProjectionLayer) || !(view instanceof XRView)) throw new TypeError('Expected projection layer and XRView.');
    this.check(layer, view._frame);
    const stereo = view.eye !== 'none'; const half = Math.floor(layer._width / 2);
    const viewport = new XRViewport(view.eye === 'right' ? half : 0, 0, stereo ? (view.eye === 'right' ? layer._width - half : half) : layer._width, layer._height);
    return new XRWebGLSubImage(viewport, layer._color, layer._depth, layer._width, layer._height);
  }
  getSubImage(layer: XRQuadLayer, frame: XRFrame, eye = 'none') {
    if (!(layer instanceof XRQuadLayer) || !frameObjects.has(frame)) throw new TypeError('Expected quad layer and XRFrame.');
    if (!['none', 'left', 'right'].includes(eye)) throw new TypeError('Invalid XREye.'); this.check(layer, frame);
    return new XRWebGLSubImage(new XRViewport(0, 0, layer._width, layer._height), layer._color, layer._depth, layer._width, layer._height);
  }
  getDepthInformation(view: XRView): never { this.assert(); view._frame._assertActive(true); return unsupported('GPU depth is not supported; request cpu-optimized depth.'); }
  getReflectionCubeMap(probe: XRLightProbe) { this.assert(); if (probe._session !== this._session) invalidState('Probe belongs to a different session.'); return null; }
  _prepare(layers: readonly XRCompositionLayer[]) {
    for (const layer of layers) if (!layer._destroyed) this.allocate(layer);
  }
  private clear(layer: XRCompositionLayer) {
    const gl = this._gl2();
    this.preserve(() => {
      this.framebuffer ??= gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.disable(gl.RASTERIZER_DISCARD); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.depthMask(true); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer._color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, layer._depth, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | (layer._depth ? gl.DEPTH_BUFFER_BIT : 0));
    });
  }
  _compose(frame: XRFrame, layers: readonly XRCompositionLayer[]) {
    const gl = this._gl2();
    this.preserve(() => {
      this.setupProgram(); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      const drawBuffer = gl.getParameter(gl.DRAW_BUFFER0) as number;
      gl.drawBuffers([gl.BACK]);
      try {
        gl.useProgram(this.program); gl.bindVertexArray(this.vao);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.colorMask(true, true, true, true);
        for (const cap of [gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.disable(cap);
        gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0); gl.bindSampler(0, null); gl.uniform1i(gl.getUniformLocation(this.program!, 'image'), 0);
        const pose = frame.getViewerPose(this._session._viewer)!;
        for (const layer of layers) {
          if (layer._destroyed) continue;
          gl.bindTexture(gl.TEXTURE_2D, layer._color);
          for (const view of pose.views) {
            const viewport = this._presentation.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            let matrix = mat4.create(); let uv = [0, 1];
            if (layer instanceof XRProjectionLayer) {
              gl.disable(gl.CULL_FACE);
              if (view.eye !== 'none') uv = [view.eye === 'right' && !layer.forceMonoPresentation ? 0.5 : 0, 0.5];
            } else if (layer instanceof XRQuadLayer) {
              gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
              const world = frame._world(layer.space); if (!world) continue;
              matrix = mat4.multiply(matrix, world, layer.transform.matrix);
              mat4.scale(matrix, matrix, [layer.width / 2, layer.height / 2, 1]);
              mat4.multiply(matrix, mat4.invert(mat4.create(), view._worldMatrix)!, matrix);
              mat4.multiply(matrix, view.projectionMatrix, matrix);
            }
            gl.uniform2f(gl.getUniformLocation(this.program!, 'alphaOptions'), layer.opacity, layer.blendTextureSourceAlpha ? 1 : 0);
            gl.uniformMatrix4fv(gl.getUniformLocation(this.program!, 'matrix'), false, matrix as Float32Array);
            gl.uniform2fv(gl.getUniformLocation(this.program!, 'uvRange'), uv);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        }
      } finally { gl.drawBuffers([drawBuffer]); }
    });
  }
  private setupProgram() {
    if (this.program) return; const gl = this._gl2();
    const compile = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!); return shader; };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      uniform mat4 matrix; uniform vec2 uvRange; out vec2 uv;
      void main() { vec2 p = vec2((gl_VertexID & 1) == 1 ? 1.0 : -1.0, gl_VertexID >= 2 ? 1.0 : -1.0);
        uv = (p + 1.0) * 0.5; uv.x = uvRange.x + uv.x * uvRange.y; gl_Position = matrix * vec4(p,0,1); }`);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform sampler2D image; uniform vec2 alphaOptions; in vec2 uv; out vec4 color; void main() { color = texture(image,uv); if (alphaOptions.y < 0.5) color.a = 1.0; color *= clamp(alphaOptions.x,0.0,1.0); }`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
    gl.deleteShader(vertex); gl.deleteShader(fragment); if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program)!);
    this.vao = gl.createVertexArray();
  }
  private preserve(action: () => void) {
    const gl = this._gl2();
    const saved = new Map<number, unknown>();
    for (const parameter of [gl.DRAW_FRAMEBUFFER_BINDING, gl.READ_FRAMEBUFFER_BINDING, gl.CURRENT_PROGRAM, gl.VERTEX_ARRAY_BINDING, gl.ACTIVE_TEXTURE,
      gl.VIEWPORT, gl.SCISSOR_BOX, gl.COLOR_WRITEMASK, gl.DEPTH_WRITEMASK, gl.COLOR_CLEAR_VALUE, gl.DEPTH_CLEAR_VALUE,
      gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA, gl.BLEND_EQUATION_RGB, gl.BLEND_EQUATION_ALPHA,
      gl.CULL_FACE_MODE, gl.FRONT_FACE]) saved.set(parameter, gl.getParameter(parameter));
    const enabled = [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE].map(cap => [cap, gl.isEnabled(cap)] as const);
    gl.activeTexture(gl.TEXTURE0); const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const sampler = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    try { action(); } finally {
      gl.bindSampler(0, sampler); gl.bindTexture(gl.TEXTURE_2D, texture); gl.activeTexture(saved.get(gl.ACTIVE_TEXTURE) as number);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.get(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.get(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null);
      gl.useProgram(saved.get(gl.CURRENT_PROGRAM) as WebGLProgram | null); gl.bindVertexArray(saved.get(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null);
      const viewport = saved.get(gl.VIEWPORT) as Int32Array; gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      const scissor = saved.get(gl.SCISSOR_BOX) as Int32Array; gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3]);
      const mask = saved.get(gl.COLOR_WRITEMASK) as boolean[]; gl.colorMask(mask[0], mask[1], mask[2], mask[3]); gl.depthMask(saved.get(gl.DEPTH_WRITEMASK) as boolean);
      const color = saved.get(gl.COLOR_CLEAR_VALUE) as Float32Array; gl.clearColor(color[0], color[1], color[2], color[3]); gl.clearDepth(saved.get(gl.DEPTH_CLEAR_VALUE) as number);
      gl.blendFuncSeparate(saved.get(gl.BLEND_SRC_RGB) as number, saved.get(gl.BLEND_DST_RGB) as number, saved.get(gl.BLEND_SRC_ALPHA) as number, saved.get(gl.BLEND_DST_ALPHA) as number);
      gl.blendEquationSeparate(saved.get(gl.BLEND_EQUATION_RGB) as number, saved.get(gl.BLEND_EQUATION_ALPHA) as number);
      gl.cullFace(saved.get(gl.CULL_FACE_MODE) as number); gl.frontFace(saved.get(gl.FRONT_FACE) as number);
      for (const [cap, value] of enabled) value ? gl.enable(cap) : gl.disable(cap);
    }
  }
}
