import {mat4, vec3} from 'gl-matrix';
import {XRSpace, XRPose, XRRigidTransform, XRView, initializeViewGeometry, installViewGeometry, projectionData, enumerableMembers, invalidState, unsupported} from './geometry';
import type {XRSession, XRFrame} from './runtime';
import {interfaceBrands} from './interface-brand';
import {jointNames} from './hand-allocation';

/** Read-only WebIDL setlike view; callers cannot add/delete tracked anchors. */
export class XRAnchorSet implements Iterable<XRAnchor> {
  private valuesSet: Set<XRAnchor>;
  constructor(anchors: Iterable<XRAnchor>) { this.valuesSet = new Set(anchors); }
  get size() { return this.valuesSet.size; }
  has(anchor: XRAnchor) { return this.valuesSet.has(anchor); }
  values() { return this.valuesSet.values(); }
  keys() { return this.valuesSet.keys(); }
  entries() { return this.valuesSet.entries(); }
  forEach(callback: (value: XRAnchor, key: XRAnchor, set: XRAnchorSet) => void, thisArg?: unknown) { for (const anchor of this) callback.call(thisArg, anchor, anchor, this); }
  [Symbol.iterator]() { return this.values(); }
}
export class XRAnchor {
  private deleted = false;
  private space: XRSpace;
  constructor(readonly _session: XRSession, readonly _matrix: mat4) { this.space = new XRSpace(_session, () => this.deleted ? null : _matrix); }
  get anchorSpace() { if (this.deleted) invalidState('Anchor was deleted.'); this._session._assertLive(); return this.space; }
  delete() { this.deleted = true; this._session._anchors.delete(this); }
  async requestPersistentHandle(): Promise<string> { this._session._assertLive(); if (this.deleted) invalidState('Anchor was deleted.'); return unsupported('Persistent anchors are not simulated.'); }
}

export const jointObjects = interfaceBrands.joints;
const handBindings = interfaceBrands.handAllocations;
function handState(value: object) {
  const state = handBindings.hands.get(value);
  if (!state) throw new TypeError('Expected XRHand.');
  return state;
}
function jointState(value: object) {
  const state = handBindings.joints.get(value);
  if (!state) throw new TypeError('Expected XRJointSpace.');
  return state;
}
function illegalHandConstruction(): never { throw new TypeError('Illegal constructor.'); }
export class XRJointSpace extends XRSpace {
  constructor() { super(illegalHandConstruction(), () => null); }
  get jointName() { return jointState(this).name; }
  get _radius() { return jointState(this).radius; }
  override _update() { this._baseMatrix = jointState(this).update(); return this._baseMatrix; }
}
export class XRJointPose extends XRPose {
  constructor() { super(illegalHandConstruction(), false); }
  get radius() {
    const radius = handBindings.poses.get(this);
    if (radius === undefined) throw new TypeError('Expected XRJointPose.');
    return radius;
  }
}
const handIteratorPrototype = Object.create(Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));
Object.defineProperties(handIteratorPrototype, {
  next: {value: {next(this: object) {
    const step = handBindings.next(this);
    const value = Array.isArray(step.value) ? [step.value[0], step.value[1]] : step.value;
    return {value, done: step.done};
  }}.next, enumerable: true, configurable: true, writable: true},
  [Symbol.toStringTag]: {value: 'XRHand Iterator', configurable: true},
});
export class XRHand implements Iterable<[string, XRJointSpace]> {
  constructor() { throw new TypeError('Illegal constructor.'); }
  get size() { return handState(this).size; }
  get(key: string) {
    const state = handState(this);
    if (arguments.length < 1) throw new TypeError('Expected XRHandJoint.');
    // Template interpolation performs abstract ToString (unlike String(), it
    // rejects Symbols), including objects, boxed strings and abrupt coercions.
    const name = `${key}`;
    if (!jointNames.includes(name)) throw new TypeError('Invalid XRHandJoint.');
    return state.get(name);
  }
  keys(): IterableIterator<string> { handState(this); return handBindings.iterator(this, 'keys', handIteratorPrototype); }
  values(): IterableIterator<XRJointSpace> { handState(this); return handBindings.iterator(this, 'values', handIteratorPrototype); }
  entries(): IterableIterator<[string, XRJointSpace]> { handState(this); return handBindings.iterator(this, 'entries', handIteratorPrototype); }
  forEach(callback: (value: XRJointSpace, key: string, hand: XRHand) => void, thisArg?: unknown) {
    const state = handState(this);
    if (typeof callback !== 'function') throw new TypeError('Expected callback.');
    for (const [name, joint] of state.entries()) Reflect.apply(callback, thisArg, [joint, name, this]);
  }
  [Symbol.iterator]() { return this.entries(); }
}
Object.defineProperty(XRHand.prototype, Symbol.iterator, {value: XRHand.prototype.entries, writable: true, configurable: true});
Object.defineProperty(XRHand.prototype.forEach, 'length', {value: 1, configurable: true});
for (const [C, members] of [[XRHand, ['size','get','keys','values','entries','forEach']], [XRJointSpace, ['jointName']], [XRJointPose, ['radius']]] as const) {
  enumerableMembers(C.prototype, members);
  Object.defineProperty(C.prototype, Symbol.toStringTag, {value: C.name, configurable: true});
}

export class XRLightProbe extends EventTarget {
  readonly probeSpace: XRSpace;
  onreflectionchange: ((event: Event) => void) | null = null;
  constructor(readonly _session: XRSession) { super(); this.probeSpace = new XRSpace(_session, () => mat4.create()); }
}
export class XRLightEstimate {
  readonly sphericalHarmonicsCoefficients: Float32Array;
  readonly primaryLightDirection = new DOMPointReadOnly(-1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3), 0);
  readonly primaryLightIntensity = new DOMPointReadOnly(4 * Math.PI, 4 * Math.PI, 4 * Math.PI, 1);
  constructor() {
    // SH projection of the room's white directional light, in probe space.
    const light = 4 * Math.PI;
    const {x, y, z} = this.primaryLightDirection;
    const basis = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x,
      1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
    this.sphericalHarmonicsCoefficients = new Float32Array(basis.flatMap(value => [value * light, value * light, value * light]));
  }
}
export class XRDepthInformation {
  declare readonly transform: XRRigidTransform;
  declare readonly projectionMatrix: Float32Array;
  readonly width = 32; readonly height = 32;
  readonly rawValueToMeters: number;
  readonly normDepthBufferFromNormView = new XRRigidTransform();
  constructor(readonly _frame: XRFrame, readonly view: XRView) {
    // The simulated depth sensor is aligned with this view, including its
    // reference-space offset. Raycasting below still uses the world-space pose.
    interfaceBrands.depthGeometry.add(this);
    initializeViewGeometry(this, view.transform, projectionData(view));
    this.rawValueToMeters = _frame.session.depthDataFormat === 'float32' ? 1 : 0.001;
  }
}
installViewGeometry(XRDepthInformation.prototype, value => interfaceBrands.depthGeometry.has(value));
export class XRCPUDepthInformation extends XRDepthInformation {
  private samples: Float32Array | Uint16Array;
  constructor(frame: XRFrame, view: XRView) {
    super(frame, view); this.samples = this.rawValueToMeters === 1 ? new Float32Array(this.width * this.height) : new Uint16Array(this.width * this.height);
    const origin = mat4.getTranslation(vec3.create(), view._worldMatrix);
    const inverseProjection = mat4.invert(mat4.create(), projectionData(view))!;
    const local = vec3.create(); const world = vec3.create();
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      vec3.transformMat4(local, [(x + 0.5) / this.width * 2 - 1, 1 - (y + 0.5) / this.height * 2, 0], inverseProjection);
      vec3.transformMat4(world, local, view._worldMatrix); vec3.subtract(world, world, origin); vec3.normalize(world, world);
      const hit = frame.session._device.arScene!.getHitTestResults(origin, world)[0];
      if (hit) {
        const depth = hit.distance * (-local[2] / vec3.length(local));
        // Millimeters in 16 bits; zero means unknown, including out-of-range.
        const raw = Math.round(depth / this.rawValueToMeters);
        this.samples[y * this.width + x] = this.rawValueToMeters === 1 ? depth : raw > 0 && raw <= 65535 ? raw : 0;
      }
    }
  }
  get data() { this._frame._assertActive(true); return this.samples.buffer as ArrayBuffer; }
  getDepthInMeters(x: number, y: number) {
    this._frame._assertActive(true);
    if (![x, y].every(Number.isFinite)) throw new TypeError('Coordinates must be finite.');
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new RangeError('Depth coordinates must be in [0,1].');
    return this.samples[Math.min(this.height - 1, Math.floor(y * this.height)) * this.width + Math.min(this.width - 1, Math.floor(x * this.width))] * this.rawValueToMeters;
  }
}
