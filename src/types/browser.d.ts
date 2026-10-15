import type { EmulatorEvents } from './contracts';

declare global {
  function cloneInto<T>(value: T, target: Window): T;
  function WebXRPolyfillInjection(): void;
  const CustomWebXRPolyfill: typeof import('../polyfill/CustomWebXRPolyfill').default;
  interface WindowEventMap extends CustomEvents {}
  interface WebGLRenderingContext { makeXRCompatible(): Promise<void> }
  interface WebGL2RenderingContext { makeXRCompatible(): Promise<void> }
}
type CustomEvents = {[K in keyof EmulatorEvents]: CustomEvent<EmulatorEvents[K]>};
