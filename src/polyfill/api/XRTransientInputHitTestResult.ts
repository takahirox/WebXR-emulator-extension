import type XRFrame from 'webxr-polyfill/src/api/XRFrame';
import type XRInputSource from 'webxr-polyfill/src/api/XRInputSource';
import type XRHitTestResult from './XRHitTestResult';

export const PRIVATE = Symbol('@@webxr-polyfill/XRTransientInputHitTestResult');

export default class XRTransientInputHitTestResult {
  [PRIVATE]: {frame: XRFrame; results: XRHitTestResult[]; inputSource: XRInputSource};

  constructor(frame: XRFrame, results: XRHitTestResult[], inputSource: XRInputSource) {
    this[PRIVATE] = {
      frame,
      inputSource,
      results
    };
  }

  get inputSource() {
    return this[PRIVATE].inputSource;
  }

  get results() {
    return this[PRIVATE].results;
  }
}
