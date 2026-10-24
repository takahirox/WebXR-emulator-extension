import {mat4, vec3} from 'gl-matrix';
import type {XRSession} from './runtime';
import {interfaceBrands} from './interface-brand';

export const sessionObjects = interfaceBrands.sessions;
export const frameObjects = interfaceBrands.frames;
export const spaceObjects = interfaceBrands.spaces;
export const compatibleContexts = new WeakSet<WebGLRenderingContext | WebGL2RenderingContext>();

export const invalidState = (message: string): never => { throw new DOMException(message, 'InvalidStateError'); };
export const unsupported = (message: string): never => { throw new DOMException(message, 'NotSupportedError'); };

// DOMPointInit members are unrestricted doubles. WebIDL converts dictionaries
// before running constructor validation; null dictionaries are empty, whereas
// null members convert to zero. Unary + implements ToNumber, rejecting BigInt.
function convertPoint(value: DOMPointInit | null | undefined): [number, number, number, number] {
  const empty = value === null || value === undefined;
  // Object identity also recognizes document.all's legacy typeof behavior.
  if (!empty && Object(value) !== value) throw new TypeError('Expected DOMPointInit.');
  const result = {w: 1, x: 0, y: 0, z: 0};
  for (const key of ['w', 'x', 'y', 'z'] as const) {
    const component = empty ? undefined : value![key];
    if (component !== undefined) result[key] = +component;
  }
  return [result.x, result.y, result.z, result.w];
}
function transformState(value: XRRigidTransform) {
  const state = interfaceBrands.transforms.get(value);
  if (!state) throw new TypeError('Expected XRRigidTransform.');
  return state;
}
export const transformObjects = Object.freeze({has: (value: object) => interfaceBrands.transforms.has(value)});
// Only geometric consumers use this matrix. Never expose it as a JS attribute.
export const transformMatrix = (value: XRRigidTransform): mat4 => transformState(value).geometry;

export class XRRigidTransform {
  constructor(position: DOMPointInit | null = {}, orientation: DOMPointInit | null = {}) {
    const p = convertPoint(position), q = convertPoint(orientation);
    if (p[3] !== 1) throw new TypeError('Position w must equal 1.');
    if (![...p, ...q].every(Number.isFinite)) throw new TypeError('Transform components must be finite.');
    const lengthSquared = q.reduce((sum, value) => sum + value * value, 0);
    if (!lengthSquared || !Number.isFinite(lengthSquared)) throw new DOMException('Orientation cannot be normalized.', 'InvalidStateError');
    const length = Math.sqrt(lengthSquared);
    for (let i = 0; i < 4; i++) q[i] /= length;
    // Keep double-precision geometry independent of the exported mutable array.
    const geometry = mat4.fromRotationTranslation(new Array(16) as mat4, q, p);
    let matrix: Float32Array | undefined, inverse: XRRigidTransform | undefined;
    interfaceBrands.transforms.set(this, {
      position: new DOMPointReadOnly(...p), orientation: new DOMPointReadOnly(...q), geometry,
      // These closures retain the allocating realm even through borrowed getters.
      matrix: () => {
        if (!matrix || matrix.buffer.byteLength === 0) matrix = new Float32Array(geometry);
        return matrix;
      },
      inverse: () => {
        if (!inverse) {
          inverse = XRRigidTransform._fromMatrix(mat4.invert(new Array(16) as mat4, geometry)!);
          interfaceBrands.transforms.get(inverse)!.inverse = () => this;
        }
        return inverse;
      },
    });
  }
  static _fromMatrix(matrix: mat4) {
    const p = mat4.getTranslation([0, 0, 0], matrix);
    const q = mat4.getRotation([0, 0, 0, 1], matrix);
    return new XRRigidTransform({x: p[0], y: p[1], z: p[2]}, {x: q[0], y: q[1], z: q[2], w: q[3]});
  }
  get position() { return transformState(this).position; }
  get orientation() { return transformState(this).orientation; }
  get matrix() { return transformState(this).matrix(); }
  get inverse(): XRRigidTransform { return transformState(this).inverse(); }
}
for (const name of ['position', 'orientation', 'matrix', 'inverse']) {
  Object.defineProperty(XRRigidTransform.prototype, name, {...Object.getOwnPropertyDescriptor(XRRigidTransform.prototype, name), enumerable: true});
}

// Every space carries a session and a world-space matrix provider.
export class XRSpace extends interfaceBrands.SpaceObject {
  _baseMatrix: mat4 | null = null;
  constructor(readonly _session: XRSession, private matrixProvider: () => mat4 | null, joint = false) { super(joint); }
  get _inverseBaseMatrix() { return this._baseMatrix && mat4.invert(mat4.create(), this._baseMatrix); }
  _update() { this._baseMatrix = this.matrixProvider(); return this._baseMatrix; }
  _adjustForOriginOffset(_matrix: mat4) {} // Offset is already in _baseMatrix.
}
// Keep the public inheritance chain in the object's own realm. The shared
// allocation constructor only supplies the private interface brand.
Object.setPrototypeOf(XRSpace.prototype, EventTarget.prototype);

export class XRReferenceSpace extends XRSpace {
  onreset: ((event: Event) => void) | null = null;
  constructor(session: XRSession, readonly _type: string, protected nativeMatrix: () => mat4 | null, protected offset = mat4.create()) {
    super(session, () => {
      const matrix = nativeMatrix();
      return matrix && mat4.multiply(mat4.create(), matrix, offset);
    });
    const allocate = this.createOffsetSpace.bind(this);
    interfaceBrands.referenceOffsets.set(this, transform => allocate(mat4.multiply(mat4.create(), offset, transform)));
  }
  getOffsetReferenceSpace(transform: XRRigidTransform) {
    const allocate = interfaceBrands.referenceOffsets.get(this);
    if (!allocate) throw new TypeError('Expected XRReferenceSpace.');
    return allocate(transformMatrix(transform));
  }
  protected createOffsetSpace(offset: mat4): XRReferenceSpace {
    return new XRReferenceSpace(this._session, this._type, this.nativeMatrix, offset);
  }
}

Object.defineProperty(XRReferenceSpace.prototype, 'getOffsetReferenceSpace', {enumerable: true});

export class XRBoundedReferenceSpace extends XRReferenceSpace {
  private readonly boundsValue: readonly DOMPointReadOnly[];
  constructor(session: XRSession, nativeMatrix: () => mat4 | null,
    private readonly nativeBounds: readonly (readonly [number, number, number])[], offset = mat4.create()) {
    super(session, 'bounded-floor', nativeMatrix, offset);
    const inverse = mat4.invert(mat4.create(), offset)!;
    this.boundsValue = Object.freeze(nativeBounds.map(point => {
      const p = vec3.transformMat4(vec3.create(), point, inverse);
      return Object.freeze(new DOMPointReadOnly(p[0], p[1], p[2], 1));
    }));
  }
  get boundsGeometry() { return this.boundsValue; }
  override getOffsetReferenceSpace(transform: XRRigidTransform): XRBoundedReferenceSpace {
    return super.getOffsetReferenceSpace(transform) as XRBoundedReferenceSpace;
  }
  protected override createOffsetSpace(offset: mat4) {
    // Always transform native bounds by the inverse cumulative offset once.
    return new XRBoundedReferenceSpace(this._session, this.nativeMatrix, this.nativeBounds, offset);
  }
}

export class XRPose {
  readonly emulatedPosition = true;
  readonly linearVelocity = null;
  readonly angularVelocity = null;
  constructor(readonly transform: XRRigidTransform) {}
}
export class XRViewerPose extends XRPose {
  constructor(transform: XRRigidTransform, readonly views: readonly XRView[]) { super(transform); }
}
export class XRViewport {
  constructor(readonly x: number, readonly y: number, readonly width: number, readonly height: number) {}
}
export class XRViewGeometry {
  constructor(readonly transform: XRRigidTransform, readonly projectionMatrix: Float32Array) {}
}
export class XRView extends XRViewGeometry {
  readonly recommendedViewportScale = null;
  readonly isFirstPersonObserver = false;
  constructor(readonly _frame: import('./runtime').XRFrame, readonly eye: 'none' | 'left' | 'right', transform: XRRigidTransform,
    projectionMatrix: Float32Array, readonly _worldMatrix: mat4) { super(transform, projectionMatrix); }
  requestViewportScale(_scale: number | null) {} // Advisory; fixed emulated resolution.
}
