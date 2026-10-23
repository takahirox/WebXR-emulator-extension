import {compositorOperation, ownFramebuffer, type OpaqueFramebuffer} from './opaque-framebuffer';
type GL = WebGLRenderingContext | WebGL2RenderingContext;
export interface WebGLLayerOptions { alpha: boolean; antialias: boolean; depth: boolean; stencil: boolean; ignoreDepthValues: boolean; framebufferScaleFactor: number }
export function convertWebGLLayerOptions(value: unknown): WebGLLayerOptions {
  if (value != null && typeof value !== 'object' && typeof value !== 'function') throw new TypeError('Expected XRWebGLLayerInit dictionary.');
  const dictionary = (value ?? {}) as Record<string, unknown>;
  const result = {} as WebGLLayerOptions;
  for (const key of ['alpha', 'antialias', 'depth', 'framebufferScaleFactor', 'ignoreDepthValues', 'stencil'] as const) {
    const member = dictionary[key];
    if (key === 'framebufferScaleFactor') {
      const number = member === undefined ? 1 : +(member as number);
      if (!Number.isFinite(number)) throw new TypeError('framebufferScaleFactor must be a finite double.');
      result[key] = number;
    } else result[key] = member === undefined ? ['alpha', 'antialias', 'depth'].includes(key) : Boolean(member);
  }
  return result;
}

/** State touched by allocation, implicit clears, resolve and CPU presentation. */
function preserve<T>(gl: GL, action: () => T): T {
  return compositorOperation(() => {
    const gl2 = gl instanceof WebGL2RenderingContext ? gl : null;
    const draw = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const read = gl2?.getParameter(gl2.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const renderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null;
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const unpack = gl2?.getParameter(gl2.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
    const pack = gl2?.getParameter(gl2.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    const pixelStore = [gl.PACK_ALIGNMENT, gl.UNPACK_ALIGNMENT, ...(gl2 ? [gl2.PACK_ROW_LENGTH, gl2.PACK_SKIP_PIXELS, gl2.PACK_SKIP_ROWS, gl2.UNPACK_ROW_LENGTH, gl2.UNPACK_SKIP_PIXELS, gl2.UNPACK_SKIP_ROWS] : [])].map(key => [key, gl.getParameter(key)] as const);
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const front = gl.getParameter(gl.STENCIL_WRITEMASK) as number, back = gl.getParameter(gl.STENCIL_BACK_WRITEMASK) as number;
    const color = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const depth = gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number, stencil = gl.getParameter(gl.STENCIL_CLEAR_VALUE) as number;
    const enabled = [gl.SCISSOR_TEST, ...(gl2 ? [gl2.RASTERIZER_DISCARD] : [])].map(cap => [cap, gl.isEnabled(cap)] as const);
    try {
      if (gl2) { gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null); gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null); }
      for (const [key] of pixelStore) gl.pixelStorei(key, key === gl.PACK_ALIGNMENT || key === gl.UNPACK_ALIGNMENT ? 1 : 0);
      return action();
    } finally {
      for (const [key, value] of pixelStore) gl.pixelStorei(key, value);
      if (gl2) { gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, pack); gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, unpack); gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, read); }
      gl.bindFramebuffer(gl2 ? gl2.DRAW_FRAMEBUFFER : gl.FRAMEBUFFER, draw);
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.colorMask(mask[0], mask[1], mask[2], mask[3]); gl.depthMask(depthMask);
      gl.stencilMaskSeparate(gl.FRONT, front); gl.stencilMaskSeparate(gl.BACK, back);
      gl.clearColor(color[0], color[1], color[2], color[3]); gl.clearDepth(depth); gl.clearStencil(stencil);
      for (const [cap, value] of enabled) value ? gl.enable(cap) : gl.disable(cap);
    }
  });
}

export class XRFramebuffer implements OpaqueFramebuffer {
  active = false; alive = true; dirty = false;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number; readonly height: number; readonly antialias: boolean;
  readonly canvas = document.createElement('canvas');
  private resolve: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private buffers: WebGLRenderbuffer[] = [];
  private pixels: Uint8Array;
  private image: ImageData;
  private output: CanvasRenderingContext2D;
  private lastStereo: boolean | null = null;
  constructor(private gl: GL, size: {width: number; height: number}, private options: WebGLLayerOptions, stereo: boolean) {
    // Bounded emulator policy: scale [1/16, 2], floor dimensions, maximum
    // 4096 per axis and four megapixels total, respecting device GL limits.
    const scale = Math.max(1 / 16, Math.min(2, options.framebufferScaleFactor));
    const maximum = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    let width = Math.max(stereo ? 2 : 1, Math.min(maximum, Math.floor(size.width * scale)));
    let height = Math.max(1, Math.min(maximum, Math.floor(size.height * scale)));
    const reduction = Math.min(1, Math.sqrt(4194304 / (width * height)));
    this.width = width = Math.max(stereo ? 2 : 1, Math.floor(width * reduction));
    this.height = height = Math.max(1, Math.floor(height * reduction));
    this.canvas.width = width; this.canvas.height = height;
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    try {
      const output = this.canvas.getContext('2d', {colorSpace: 'srgb'});
      if (!output) throw new Error('Unable to create presentation context.');
      this.output = output;
      this.image = output.createImageData(width, height); this.pixels = new Uint8Array(width * height * 4);
    } catch { throw new DOMException('Unable to allocate XR presentation storage.', 'OperationError'); }
    const gl2 = gl instanceof WebGL2RenderingContext ? gl : null;
    const colorFormat = options.alpha ? (gl2 ? gl2.RGBA8 : gl.RGBA) : (gl2 ? gl2.RGB8 : gl.RGB);
    const depthFormat = options.stencil ? (gl2 ? gl2.DEPTH24_STENCIL8 : gl.DEPTH_STENCIL) : gl.DEPTH_COMPONENT16;
    let samples = 0;
    if (gl2 && options.antialias) {
      const counts = gl2.getInternalformatParameter(gl2.RENDERBUFFER, colorFormat, gl2.SAMPLES) as Int32Array;
      const depthCounts = options.depth || options.stencil ? gl2.getInternalformatParameter(gl2.RENDERBUFFER, depthFormat, gl2.SAMPLES) as Int32Array : counts;
      samples = Array.from(counts).find(count => count > 1 && count <= 4 && Array.from(depthCounts).includes(count)) ?? 0;
    }
    this.antialias = samples > 1;
    const created = gl.createFramebuffer(); if (!created) throw new DOMException('Unable to create XR framebuffer.', 'OperationError');
    this.framebuffer = created;
    try {
      preserve(gl, () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, created);
        this.texture = gl.createTexture(); if (!this.texture) throw new Error('Unable to create color texture.');
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, colorFormat, width, height, 0, options.alpha ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (gl2 && samples) {
          this.resolve = gl.createFramebuffer(); if (!this.resolve) throw new Error('Unable to create resolve framebuffer.');
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolve);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete XR resolve framebuffer.');
          gl.bindFramebuffer(gl.FRAMEBUFFER, created);
          this.attach(gl.COLOR_ATTACHMENT0, colorFormat, samples);
        } else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        if (options.depth || options.stencil) this.attach(options.stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, depthFormat, samples);
        if (gl.isContextLost() || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete XR framebuffer.');
      });
      ownFramebuffer(created, this);
      this.clear();
    } catch (error) { this.dispose(); throw new DOMException(`Unable to allocate XR framebuffer: ${String(error)}`, 'OperationError'); }
  }
  private attach(attachment: number, format: number, samples: number) {
    const gl = this.gl;
    const buffer = gl.createRenderbuffer(); if (!buffer) throw new Error('Unable to create XR renderbuffer.');
    this.buffers.push(buffer); gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    if (samples && gl instanceof WebGL2RenderingContext) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, this.width, this.height);
    else gl.renderbufferStorage(gl.RENDERBUFFER, format, this.width, this.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
  }
  get colorTexture() { return this.texture; }
  clear() {
    if (!this.alive || this.gl.isContextLost()) return;
    const gl = this.gl;
    preserve(gl, () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      const drawBuffer = gl instanceof WebGL2RenderingContext ? gl.getParameter(gl.DRAW_BUFFER0) as number : 0;
      gl.disable(gl.SCISSOR_TEST); if (gl instanceof WebGL2RenderingContext) { gl.disable(gl.RASTERIZER_DISCARD); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); }
      gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMaskSeparate(gl.FRONT, 0xffffffff); gl.stencilMaskSeparate(gl.BACK, 0xffffffff);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | (this.options.depth || this.options.stencil ? gl.DEPTH_BUFFER_BIT : 0) | (this.options.stencil ? gl.STENCIL_BUFFER_BIT : 0));
      if (gl instanceof WebGL2RenderingContext) gl.drawBuffers([drawBuffer]);
    });
  }
  present(stereo: boolean, force = false) {
    const gl = this.gl;
    if (!this.alive || gl.isContextLost()) return;
    const update = force || this.dirty;
    if (!update && stereo === this.lastStereo) return;
    this.lastStereo = stereo; this.dirty = false;
    if (update) {
      preserve(gl, () => {
        gl.disable(gl.SCISSOR_TEST);
        if (gl instanceof WebGL2RenderingContext && this.resolve) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve);
          const sourceReadBuffer = gl.getParameter(gl.READ_BUFFER) as number;
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.readBuffer(sourceReadBuffer);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolve ?? this.framebuffer);
        const readBuffer = gl instanceof WebGL2RenderingContext ? gl.getParameter(gl.READ_BUFFER) as number : 0;
        if (gl instanceof WebGL2RenderingContext) gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.flush(); gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
        if (gl instanceof WebGL2RenderingContext) gl.readBuffer(readBuffer);
      });
      // Opaque XR colors are sRGB-encoded and premultiplied regardless of the
      // application's default context attributes. ImageData expects straight alpha.
      const data = this.image.data, width = this.width, height = this.height;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const source = ((height - 1 - y) * width + x) * 4, target = (y * width + x) * 4;
        const alpha = this.options.alpha ? this.pixels[source + 3] : 255;
        for (let c = 0; c < 3; c++) data[target + c] = alpha ? Math.min(255, Math.round(this.pixels[source + c] * 255 / alpha)) : 0;
        data[target + 3] = alpha;
      }
    }
    const width = this.width, height = this.height;
    this.output.putImageData(this.image, 0, 0);
    // Mono preview selects and expands the left view; API storage stays stereo.
    if (!stereo) {
      this.output.globalCompositeOperation = 'copy';
      this.output.drawImage(this.canvas, 0, 0, Math.floor(width / 2), height, 0, 0, width, height);
      this.output.globalCompositeOperation = 'source-over';
    }
  }
  dispose() {
    if (!this.alive) return;
    this.active = false; this.alive = false;
    compositorOperation(() => {
      this.gl.deleteFramebuffer(this.framebuffer); this.gl.deleteFramebuffer(this.resolve); this.gl.deleteTexture(this.texture);
      for (const buffer of this.buffers) this.gl.deleteRenderbuffer(buffer);
    });
    this.buffers = []; this.canvas.width = this.canvas.height = 1;
    this.pixels = new Uint8Array(0); this.image = new ImageData(1, 1);
    this.texture = null; this.resolve = null;
  }
}
