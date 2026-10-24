import {installWebGLCompatibility} from './webgl';
import type {PolyfillGlobal} from '../types/polyfill';
import * as geometry from './api/geometry';
import * as layers from './api/layers';
import * as sensing from './api/sensing';
import * as environment from './api/environment';
import * as runtime from './api/runtime';
import EX_API from './api/index';

// Installed synchronously in the MAIN world. Configuration is the only async
// dependency; requestSession and isSessionSupported both wait for it.
export default class CustomWebXRPolyfill {
  readonly xr: runtime.XRSystem;
  constructor() {
    const global = window as PolyfillGlobal;
    for (const [name, value] of Object.entries({...geometry, ...runtime, ...sensing, ...environment, ...layers, ...EX_API})) {
      if (name.startsWith('XR')) (global as unknown as Record<string, unknown>)[name] = value;
    }
    this.xr = runtime.xr;
    Object.defineProperty(navigator, 'xr', {value: this.xr, configurable: true});
    installWebGLCompatibility();
  }
}
