import type {XRFrame} from './runtime';
export const PRIVATE = Symbol('@@webxr-polyfill/XRHitTestResult');
import {XRSpace, XRRigidTransform, transformMatrix} from './geometry';

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

  async createAnchor() {
    const {frame, transform} = this[PRIVATE];
    const space = new XRSpace(frame.session, () => mat4.clone(transformMatrix(transform)));
    return frame.createAnchor(new XRRigidTransform(), space);
  }

  getPose(baseSpace: XRSpace) {
    const space = new XRSpace(this[PRIVATE].frame.session, () => mat4.clone(transformMatrix(this[PRIVATE].transform)));
    return this[PRIVATE].frame.getPose(space, baseSpace);
  }
}
