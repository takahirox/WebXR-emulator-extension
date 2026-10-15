// Narrow declarations for the untyped dependency's internal APIs used by this extension.
declare module 'webxr-polyfill/src/WebXRPolyfill' {
  type PolyfillGlobal = import('./polyfill').PolyfillGlobal;
  import XRSystem from 'webxr-polyfill/src/api/XRSystem';
  export default class WebXRPolyfill {
    constructor(); global: PolyfillGlobal; nativeWebXR: boolean; injected: boolean; xr: XRSystem;
    _patchNavigatorXR(): void;
  }
}
declare module 'webxr-polyfill/src/constants' { export const XR_COMPATIBLE: unique symbol; }
declare module 'webxr-polyfill/src/devices/XRDevice' {
  type PolyfillGlobal = import('./polyfill').PolyfillGlobal;
  import type XRInputSource from 'webxr-polyfill/src/api/XRInputSource';
  export default class XRDevice {
    constructor(global: PolyfillGlobal); global: PolyfillGlobal;
    dispatchEvent(type: string, detail: number | {sessionId: number; inputSource: XRInputSource}): void;
  }
}
declare module 'webxr-polyfill/src/api/XRSystem' {
  type SessionMode = import('./contracts').SessionMode;
  type SessionOptions = import('./polyfill').SessionOptions;
  import XRDevice from 'webxr-polyfill/src/devices/XRDevice';
  import XRSession from 'webxr-polyfill/src/api/XRSession';
  export default class XRSystem {
    constructor(device: Promise<XRDevice>);
    requestSession(mode: SessionMode, options?: SessionOptions): Promise<XRSession>;
  }
}
declare module 'webxr-polyfill/src/api/XRSession' {
  type EmulatedXRDevice = import('../polyfill/EmulatedXRDevice').default;
  type HitTestOptions = import('./polyfill').HitTestOptions;
  type TransientHitTestOptions = import('./polyfill').TransientHitTestOptions;
  type XRHitTestSource = import('../polyfill/api/XRHitTestSource').default;
  type XRTransientInputHitTestSource = import('../polyfill/api/XRTransientInputHitTestSource').default;
  export const PRIVATE: unique symbol;
  export default class XRSession {
    [PRIVATE]: {device: EmulatedXRDevice; id: number};
    ended: boolean; domOverlayState?: {type: 'screen'};
    end(): Promise<void>;
    requestHitTestSource(options: HitTestOptions): Promise<XRHitTestSource>;
    requestHitTestSourceForTransientInput(options: TransientHitTestOptions): Promise<XRTransientInputHitTestSource>;
  }
}
declare module 'webxr-polyfill/src/api/XRFrame' {
  import XRSession from 'webxr-polyfill/src/api/XRSession';
  import XRSpace from 'webxr-polyfill/src/api/XRSpace';
  import XRPose from 'webxr-polyfill/src/api/XRPose';
  type XRHitTestResult = import('../polyfill/api/XRHitTestResult').default;
  type XRHitTestSource = import('../polyfill/api/XRHitTestSource').default;
  type XRTransientInputHitTestSource = import('../polyfill/api/XRTransientInputHitTestSource').default;
  type XRTransientInputHitTestResult = import('../polyfill/api/XRTransientInputHitTestResult').default;
  export default class XRFrame {
    session: XRSession;
    getPose(space: XRSpace, baseSpace: XRSpace): XRPose | null;
    getHitTestResults(source: XRHitTestSource): XRHitTestResult[];
    getHitTestResultsForTransientInput(source: XRTransientInputHitTestSource): XRTransientInputHitTestResult[];
  }
}
declare module 'webxr-polyfill/src/api/XRSpace' {
  import type { mat4 } from 'gl-matrix';
  export default class XRSpace {
    constructor(type?: string);
    _inverseBaseMatrix: mat4 | null;
    _baseMatrix: mat4 | null;
    _transformBasePoseMatrix(out: mat4, matrix: mat4): mat4;
  }
}
declare module 'webxr-polyfill/src/api/XRRigidTransform' {
  import type { mat4 } from 'gl-matrix';
  export default class XRRigidTransform {
    constructor(matrix: mat4); matrix: mat4; inverse: XRRigidTransform;
  }
}
declare module 'webxr-polyfill/src/api/XRPose' {
  import XRRigidTransform from 'webxr-polyfill/src/api/XRRigidTransform';
  export default class XRPose { transform: XRRigidTransform }
}
declare module 'webxr-polyfill/src/api/XRInputSource' {
  export default class XRInputSource { handedness: string; targetRayMode: string; profiles: string[] }
}
declare module 'webxr-polyfill/src/devices/GamepadXRInputSource' {
  import XRDevice from 'webxr-polyfill/src/devices/XRDevice';
  import XRInputSource from 'webxr-polyfill/src/api/XRInputSource';
  import XRSpace from 'webxr-polyfill/src/api/XRSpace';
  import XRPose from 'webxr-polyfill/src/api/XRPose';
  type EmulatedGamepad = import('./contracts').EmulatedGamepad;
  export default class GamepadXRInputSource {
    constructor(device: XRDevice, display: object, primaryButton: number, squeezeButton: number);
    active: boolean; handedness: string; targetRayMode: string; primaryButtonIndex: number; primarySqueezeButtonIndex: number;
    primaryActionPressed: boolean; primarySqueezeActionPressed: boolean; inputSource: XRInputSource;
    updateFromGamepad(gamepad: EmulatedGamepad): void;
    getXRPose(space: XRSpace, type: string): XRPose | null;
  }
}
declare module 'webxr-polyfill/src/api/index' { const api: Record<string, unknown>; export default api; }
