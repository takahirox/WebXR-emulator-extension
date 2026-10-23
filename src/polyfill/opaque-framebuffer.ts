type GL = WebGLRenderingContext | WebGL2RenderingContext;
export interface OpaqueFramebuffer { active: boolean; alive: boolean; dirty: boolean }
const owners = new WeakMap<WebGLFramebuffer, OpaqueFramebuffer>();
const errors = new WeakMap<GL, Set<number>>();
let privileged = 0;
/** Only packaged compositor operations may bypass the ordinary WebGL guards. */
export function compositorOperation<T>(action: () => T): T {
  privileged++;
  try { return action(); } finally { privileged--; }
}
export function ownFramebuffer(framebuffer: WebGLFramebuffer, owner: OpaqueFramebuffer) { owners.set(framebuffer, owner); }

export function installOpaqueFramebufferGuards(Context: typeof WebGLRenderingContext | typeof WebGL2RenderingContext) {
  const prototype = Context.prototype as unknown as Record<string, (...args: any[]) => any>;
  const nativeGetError = prototype.getError;
  const nativeGetParameter = prototype.getParameter;
  const queueError = (gl: GL, error: number) => {
    let pending = errors.get(gl);
    if (!pending) errors.set(gl, pending = new Set());
    // Preserve existing native error flags, including errors preceding this call.
    for (let i = 0; i < 32; i++) { const value = nativeGetError.call(gl); if (!value) break; pending.add(value); }
    pending.add(error);
  };
  prototype.getError = function(this: GL) {
    const pending = errors.get(this);
    if (pending?.size) { const first = pending.values().next().value!; pending.delete(first); return first; }
    return nativeGetError.call(this);
  };
  const bound = (gl: GL, read = false) => owners.get(nativeGetParameter.call(gl, read && gl instanceof WebGL2RenderingContext ? gl.READ_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING));
  const targetRead = (gl: GL, target: number) => gl instanceof WebGL2RenderingContext && target === gl.READ_FRAMEBUFFER;
  const wrap = (name: string, guard: (gl: GL, args: any[]) => number | undefined, fallback?: unknown, writes = false) => {
    const original = prototype[name]; if (!original) return;
    prototype[name] = function(this: GL, ...args: any[]) {
      const error = privileged ? undefined : guard(this, args);
      if (error !== undefined) { queueError(this, error); return fallback; }
      if (!privileged && writes) { const owner = bound(this); if (owner) owner.dirty = true; }
      return original.apply(this, args);
    };
  };
  for (const name of ['framebufferTexture2D', 'framebufferRenderbuffer', 'framebufferTextureLayer', 'getFramebufferAttachmentParameter']) {
    wrap(name, (gl, args) => bound(gl, targetRead(gl, args[0])) ? gl.INVALID_OPERATION : undefined, name === 'getFramebufferAttachmentParameter' ? null : undefined);
  }
  wrap('deleteFramebuffer', (gl, args) => owners.has(args[0]) ? gl.INVALID_OPERATION : undefined);
  const originalStatus = prototype.checkFramebufferStatus;
  prototype.checkFramebufferStatus = function(this: GL, target: number) {
    const owner = bound(this, targetRead(this, target));
    if (!privileged && owner && (!owner.active || !owner.alive)) return this.FRAMEBUFFER_UNSUPPORTED;
    return originalStatus.call(this, target);
  };
  const unavailable = (owner?: OpaqueFramebuffer) => owner && (!owner.active || !owner.alive);
  for (const name of ['clear', 'drawArrays', 'drawElements', 'drawRangeElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi']) {
    wrap(name, gl => unavailable(bound(gl)) ? gl.INVALID_FRAMEBUFFER_OPERATION : undefined, undefined, true);
  }
  for (const name of ['readPixels', 'copyTexImage2D', 'copyTexSubImage2D', 'copyTexSubImage3D']) {
    wrap(name, gl => unavailable(bound(gl, true)) ? gl.INVALID_FRAMEBUFFER_OPERATION : undefined);
  }
  wrap('blitFramebuffer', gl => unavailable(bound(gl)) || unavailable(bound(gl, true)) ? gl.INVALID_FRAMEBUFFER_OPERATION : undefined, undefined, true);
  const getExtension = prototype.getExtension;
  const patched = new WeakSet<object>();
  prototype.getExtension = function(this: GL, name: string) {
    const extension = getExtension.call(this, name);
    if (extension && !patched.has(extension)) {
      patched.add(extension);
      for (const key of new Set([...Object.getOwnPropertyNames(extension), ...Object.getOwnPropertyNames(Object.getPrototypeOf(extension))])) {
        const attachment = /^framebufferTexture/.test(key);
        if (!attachment && !/^(drawArrays|drawElements|multiDraw)/.test(key)) continue;
        const original = extension[key]; if (typeof original !== 'function') continue;
        const gl = this;
        extension[key] = function(...args: any[]) {
          if (!privileged && attachment && bound(gl, targetRead(gl, args[0]))) { queueError(gl, gl.INVALID_OPERATION); return; }
          if (!privileged && !attachment && unavailable(bound(gl))) { queueError(gl, gl.INVALID_FRAMEBUFFER_OPERATION); return; }
          if (!privileged && !attachment) { const owner = bound(gl); if (owner) owner.dirty = true; }
          return original.apply(extension, args);
        };
      }
    }
    return extension;
  };
}
