import type {XRFrame} from './runtime';
import type {XRInputSource} from './runtime';
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
