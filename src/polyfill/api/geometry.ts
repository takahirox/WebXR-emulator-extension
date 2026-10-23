import {mat4, quat, vec3} from 'gl-matrix';
import type {XRSession} from './runtime';
import {interfaceBrands} from './interface-brand';

export const sessionObjects = interfaceBrands.sessions;
export const frameObjects = interfaceBrands.frames;
export const spaceObjects = interfaceBrands.spaces;
export const compatibleContexts = new WeakSet<WebGLRenderingContext | WebGL2RenderingContext>();

export const invalidState = (message: string): never => { throw new DOMException(message, 'InvalidStateError'); };
export const unsupported = (message: string): never => { throw new DOMException(message, 'NotSupportedError'); };

export class XRRigidTransform {
  readonly position: DOMPointReadOnly;
  readonly orientation: DOMPointReadOnly;
  readonly matrix: Float32Array;
  private inverseValue?: XRRigidTransform;
  constructor(position: DOMPointInit = {}, orientation: DOMPointInit = {}) {
    const p = [position.x ?? 0, position.y ?? 0, position.z ?? 0];
    const q = [orientation.x ?? 0, orientation.y ?? 0, orientation.z ?? 0, orientation.w ?? 1];
    if (![...p, ...q, position.w ?? 1].every(Number.isFinite)) throw new TypeError('Transform components must be finite.');
    if ((position.w ?? 1) !== 1) throw new TypeError('Position w must equal 1.');
    if (!Math.hypot(...q) || !Number.isFinite(q.reduce((sum, value) => sum + value * value, 0))) throw new DOMException('Orientation cannot be zero.', 'InvalidStateError');
    quat.normalize(q, q);
    this.position = new DOMPointReadOnly(...p, 1);
    this.orientation = new DOMPointReadOnly(...q);
    this.matrix = new Float32Array(16);
    mat4.fromRotationTranslation(this.matrix, q, p);
  }
  static _fromMatrix(matrix: mat4) {
    const p = mat4.getTranslation(vec3.create(), matrix);
    const q = mat4.getRotation(quat.create(), matrix);
    return new XRRigidTransform({x: p[0], y: p[1], z: p[2]}, {x: q[0], y: q[1], z: q[2], w: q[3]});
  }
  get inverse(): XRRigidTransform {
    if (!this.inverseValue) {
      this.inverseValue = XRRigidTransform._fromMatrix(mat4.invert(mat4.create(), this.matrix)!);
      this.inverseValue.inverseValue = this;
    }
    return this.inverseValue;
  }
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
  }
  getOffsetReferenceSpace(transform: XRRigidTransform) {
    if (!(transform instanceof XRRigidTransform)) throw new TypeError('Expected XRRigidTransform.');
    return this.createOffsetSpace(mat4.multiply(mat4.create(), this.offset, transform.matrix));
  }
  protected createOffsetSpace(offset: mat4): XRReferenceSpace {
    return new XRReferenceSpace(this._session, this._type, this.nativeMatrix, offset);
  }
}

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
