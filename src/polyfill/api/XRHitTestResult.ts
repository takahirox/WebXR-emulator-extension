import type XRFrame from 'webxr-polyfill/src/api/XRFrame';
export const PRIVATE = Symbol('@@webxr-polyfill/XRHitTestResult');
import type XRRigidTransform from 'webxr-polyfill/src/api/XRRigidTransform';
import XRSpace from 'webxr-polyfill/src/api/XRSpace';
import {
  mat4
} from 'gl-matrix';

export default class XRHitTestResult {
  [PRIVATE]: {frame: XRFrame; transform: XRRigidTransform};

  constructor(frame: XRFrame, transform: XRRigidTransform) {
    this[PRIVATE] = {
      frame,
      transform
    };
  }

  getPose(baseSpace: XRSpace) {
    const space = new XRSpace();
    space._baseMatrix = mat4.copy(mat4.create(), this[PRIVATE].transform.matrix);
    return this[PRIVATE].frame.getPose(space, baseSpace);
  }
}
