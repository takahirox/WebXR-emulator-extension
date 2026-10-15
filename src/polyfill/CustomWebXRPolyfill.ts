import {installWebGLCompatibility} from './webgl';
import type {PolyfillGlobal} from '../types/polyfill';
import * as geometry from './api/geometry';
import * as layers from './api/layers';
import * as sensing from './api/sensing';
import * as runtime from './api/runtime';
import EX_API from './api/index';
import EmulatedXRDevice from './EmulatedXRDevice';

// Installed synchronously in the MAIN world. Configuration is the only async
// dependency; requestSession and isSessionSupported both wait for it.
export default class CustomWebXRPolyfill {
  readonly xr: runtime.XRSystem;
  constructor() {
    const global = window as PolyfillGlobal;
    for (const [name, value] of Object.entries({...geometry, ...runtime, ...sensing, ...layers, ...EX_API})) {
      if (name.startsWith('XR')) (global as unknown as Record<string, unknown>)[name] = value;
    }
    const device = new Promise<EmulatedXRDevice>(resolve => {
      const init = (event: WindowEventMap['webxr-device-init']) => {
        window.removeEventListener('webxr-device-init', init);
        resolve(new EmulatedXRDevice(global, {...event.detail.deviceDefinition, stereoEffect: event.detail.stereoEffect}));
      };
      window.addEventListener('webxr-device-init', init);
    });
    this.xr = new runtime.XRSystem(device);
    Object.defineProperty(navigator, 'xr', {value: this.xr, configurable: true});
    installWebGLCompatibility();
  }
}
