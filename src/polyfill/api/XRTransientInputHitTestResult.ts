import type {XRFrame, XRInputSource} from './runtime';
import type XRHitTestResult from './XRHitTestResult';
import {interfaceBrands} from './interface-brand';
import {enumerableMembers} from './geometry';
import {requireHitTestAllocation} from './hit-test-options';

function resultState(value: object) {
  const state = interfaceBrands.transientHitResults.get(value);
  if (!state) throw new TypeError('Expected XRTransientInputHitTestResult.');
  return state;
}
export default class XRTransientInputHitTestResult {
  constructor(...args: [frame: XRFrame, results: XRHitTestResult[], inputSource: XRInputSource, token?: symbol]) {
    const [, results, inputSource, token] = args;
    requireHitTestAllocation(token);
    interfaceBrands.transientHitResults.set(this, {inputSource, results: Object.freeze([...results])});
  }
  get inputSource() { return resultState(this).inputSource; }
  get results() { return resultState(this).results; }
}
enumerableMembers(XRTransientInputHitTestResult.prototype, ['inputSource', 'results']);
Object.defineProperty(XRTransientInputHitTestResult.prototype, Symbol.toStringTag, {value: 'XRTransientInputHitTestResult', configurable: true});
