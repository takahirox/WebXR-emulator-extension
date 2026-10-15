import {compatibleContexts} from './api/geometry';

/** Adapt the standard xrCompatible flag without asking native XR for hardware. */
export function installWebGLCompatibility() {
  for (const Context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!Context) continue;
    Context.prototype.makeXRCompatible = function() {
      if (this.isContextLost()) return Promise.reject(new DOMException('WebGL context is lost.', 'InvalidStateError'));
      compatibleContexts.add(this); return Promise.resolve();
    };
  }
  const patchCanvas = (prototype: HTMLCanvasElement | OffscreenCanvas) => {
    const original = prototype.getContext as (this: HTMLCanvasElement | OffscreenCanvas, type: string, options?: unknown) => RenderingContext | OffscreenRenderingContext | null;
    Object.defineProperty(prototype, 'getContext', {configurable: true, writable: true,
      value(this: HTMLCanvasElement | OffscreenCanvas, type: string, options?: Record<string, unknown>) {
        const webgl = type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl';
        const requested = webgl && !!options?.xrCompatible;
        // Native XR compatibility can require a real headset or select a different
        // GPU. The virtual compositor uses ordinary packaged WebGL resources.
        const context = original.call(this, type, requested ? {...options, xrCompatible: false} : options);
        if (requested && (context instanceof WebGLRenderingContext || (typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext))) compatibleContexts.add(context);
        return context;
      },
    });
  };
  patchCanvas(HTMLCanvasElement.prototype);
  if (typeof OffscreenCanvas !== 'undefined') patchCanvas(OffscreenCanvas.prototype);
}
