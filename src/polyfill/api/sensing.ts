import {mat4, vec3} from 'gl-matrix';
import {XRSpace, XRPose, XRRigidTransform, XRView, initializeViewGeometry, installViewGeometry, projectionData, invalidState, unsupported} from './geometry';
import type {XRSession, XRFrame} from './runtime';
import {interfaceBrands} from './interface-brand';

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

const names = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap(finger => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(bone => `${finger}-${bone}`))];
export const jointObjects = interfaceBrands.joints;
export class XRJointSpace extends XRSpace {
  constructor(session: XRSession, readonly jointName: string, readonly _radius: number, provider: () => mat4 | null) { super(session, provider, true); }
}
export class XRJointPose extends XRPose { constructor(transform: XRRigidTransform, readonly radius: number, emulatedPosition: boolean, token?: symbol) { super(transform, emulatedPosition, token); } }
export class XRHand implements Iterable<[string, XRJointSpace]> {
  private joints = new Map<string, XRJointSpace>();
  constructor(session: XRSession, controller: number, active: () => boolean) {
    for (const [index, name] of names.entries()) {
      const radius = index === 0 ? 0.018 : name.endsWith('tip') ? 0.007 : 0.009;
      this.joints.set(name, new XRJointSpace(session, name, radius, () => {
        if (!active()) return null;
        const gamepad = session._device.gamepads[controller]; if (!gamepad) return null;
        const matrix = mat4.fromRotationTranslation(mat4.create(), gamepad.pose.orientation, gamepad.pose.position);
        if (index === 0) return matrix;
        // A reproducible five-finger skeleton. The panel trigger curls the fingers;
        // controller translation/rotation moves the entire simulated hand.
        const finger = index <= 4 ? 0 : 1 + Math.floor((index - 5) / 5);
        const joint = index <= 4 ? index : 1 + (index - 5) % 5;
        const side = gamepad.hand === 'left' ? -1 : 1;
        const curled = gamepad.buttons[0].pressed;
        const position = (bone: number): vec3 => vec3.fromValues((finger - 2) * 0.019 * side, curled ? -bone * 0.009 : 0, -0.025 - bone * (curled ? 0.008 : 0.025));
        const origin = position(joint);
        // -Z follows the outgoing bone; tips continue the distal bone. The
        // palm's +Y fixes roll, keeping -Y outward from the palm's skin.
        const target = name.endsWith('tip') ? vec3.add(vec3.create(), origin, vec3.subtract(vec3.create(), origin, position(joint - 1))) : position(joint + 1);
        return mat4.multiply(matrix, matrix, mat4.targetTo(mat4.create(), origin, target, [0, 1, 0]));
      }));
    }
  }
  get size() { return this.joints.size; }
  get(key: string) { if (!names.includes(key)) throw new TypeError('Invalid XRHandJoint.'); return this.joints.get(key)!; }
  keys() { return this.joints.keys(); }
  values() { return this.joints.values(); }
  entries() { return this.joints.entries(); }
  forEach(callback: (value: XRJointSpace, key: string, hand: XRHand) => void, thisArg?: unknown) { for (const [name, joint] of this) callback.call(thisArg, joint, name, this); }
  [Symbol.iterator]() { return this.entries(); }
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
