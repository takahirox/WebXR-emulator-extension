import type {XRFrame} from './runtime';
import {XRSpace, XRRigidTransform, transformMatrix, spaceObjects, enumerableMembers} from './geometry';
import {interfaceBrands} from './interface-brand';
import {interfaceValue} from './bulk-input';
import {requireHitTestAllocation} from './hit-test-options';
import {mat4} from 'gl-matrix';

function resultState(value: object) {
  const state = interfaceBrands.hitResults.get(value);
  if (!state) throw new TypeError('Expected XRHitTestResult.');
  return state;
}
export default class XRHitTestResult extends interfaceBrands.hitTestAllocations.HitResultAllocation {
  constructor(...args: [frame: XRFrame, transform: XRRigidTransform, token?: symbol]) {
    const [frame, transform, token] = args;
    requireHitTestAllocation(token);
    super(frame, transform);
  }
  async createAnchor() {
    const {frame, transform} = resultState(this);
    frame._assertActive();
    const space = new XRSpace(frame.session, () => mat4.clone(transformMatrix(transform)));
    return frame.createAnchor(new XRRigidTransform(), space);
  }
  getPose(baseSpace: XRSpace) {
    const {frame, transform} = resultState(this);
    if (arguments.length < 1) throw new TypeError('Expected baseSpace.');
    interfaceValue(baseSpace, spaceObjects, 'XRSpace');
    frame._assertActive();
    const space = new XRSpace(frame.session, () => mat4.clone(transformMatrix(transform)));
    return frame.getPose(space, baseSpace);
  }
}
enumerableMembers(XRHitTestResult.prototype, ['getPose', 'createAnchor']);
Object.defineProperty(XRHitTestResult.prototype, Symbol.toStringTag, {value: 'XRHitTestResult', configurable: true});
