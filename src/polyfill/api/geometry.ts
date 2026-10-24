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

function initializeSpaceRelation(space: XRSpace, origin: object, offset: mat4) {
  let tracking = interfaceBrands.trackingOrigins.get(origin);
  if (!tracking) { tracking = {emulatedPosition: false}; interfaceBrands.trackingOrigins.set(origin, tracking); }
  interfaceBrands.spaceRelations.set(space, {origin, offset, tracking});
}
// Every space carries a session and a world-space matrix provider.
export class XRSpace extends interfaceBrands.SpaceObject {
  _baseMatrix: mat4 | null = null;
  // Virtual providers supply exact 6DoF positions. A provider supplying an
  // estimated position can mark it explicitly; self-relative poses stay exact.
  get _emulatedPosition() { return interfaceBrands.spaceRelations.get(this)!.tracking.emulatedPosition; }
  set _emulatedPosition(value: boolean) { interfaceBrands.spaceRelations.get(this)!.tracking.emulatedPosition = value; }
  constructor(readonly _session: XRSession, private matrixProvider: () => mat4 | null, joint = false) {
    super(joint);
    initializeSpaceRelation(this, matrixProvider, mat4.create());
  }
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
    initializeSpaceRelation(this, nativeMatrix, offset);
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

// Allocation permission stays inside the bundle; public interfaces have no
// constructor in WebIDL. Never publish this token on the injected global.
export const geometryAllocation = Symbol('geometry allocation');
export function requireGeometryAllocation(token: symbol | undefined) {
  if (token !== geometryAllocation) throw new TypeError('Illegal constructor.');
}
function poseState(value: object) {
  const state = interfaceBrands.poses.get(value);
  if (!state) throw new TypeError('Expected XRPose.');
  return state;
}
export function relativePose(space: XRSpace, base: XRSpace) {
  const source = interfaceBrands.spaceRelations.get(space)!, target = interfaceBrands.spaceRelations.get(base)!;
  // A shared native origin has a statically known relative relationship even
  // when its absolute tracking is unavailable or estimated.
  if (source.origin === target.origin) return {
    matrix: mat4.multiply(mat4.create(), mat4.invert(mat4.create(), target.offset)!, source.offset), emulated: false,
  };
  const world = space._update(), baseWorld = base._update();
  return world && baseWorld ? {
    matrix: mat4.multiply(mat4.create(), mat4.invert(mat4.create(), baseWorld)!, world),
    emulated: source.tracking.emulatedPosition || target.tracking.emulatedPosition,
  } : null;
}
export class XRPose {
  constructor(transform: XRRigidTransform, emulatedPosition: boolean, token?: symbol) {
    requireGeometryAllocation(token);
    interfaceBrands.poses.set(this, {transform, emulatedPosition});
  }
  get transform() { return poseState(this).transform; }
  get emulatedPosition() { return poseState(this).emulatedPosition; }
  get linearVelocity() { poseState(this); return null; }
  get angularVelocity() { poseState(this); return null; }
}
export class XRViewerPose extends XRPose {
  constructor(transform: XRRigidTransform, views: readonly XRView[], emulatedPosition: boolean, token?: symbol) {
    super(transform, emulatedPosition, token);
    interfaceBrands.viewerViews.set(this, Object.freeze([...views]));
  }
  get views() {
    const views = interfaceBrands.viewerViews.get(this);
    if (!views) throw new TypeError('Expected XRViewerPose.');
    return views;
  }
}
function viewportState(value: object) {
  const state = interfaceBrands.viewports.get(value);
  if (!state) throw new TypeError('Expected XRViewport.');
  return state;
}
export class XRViewport {
  constructor(x: number, y: number, width: number, height: number, token?: symbol) {
    requireGeometryAllocation(token); interfaceBrands.viewports.set(this, {x, y, width, height});
  }
  get x() { return viewportState(this).x; }
  get y() { return viewportState(this).y; }
  get width() { return viewportState(this).width; }
  get height() { return viewportState(this).height; }
}
export function initializeViewGeometry(value: object, transform: XRRigidTransform, projection: ArrayLike<number>) {
  const geometry = Array.from(projection) as mat4;
  let array: Float32Array | undefined;
  interfaceBrands.viewGeometry.set(value, {transform, projection: geometry, array: () => {
    if (!array || array.buffer.byteLength === 0) array = new Float32Array(geometry);
    return array;
  }});
}
// XRViewGeometry is a mixin: its members live directly on each including
// interface's prototype, with that interface's own receiver check.
export function installViewGeometry(prototype: object, has: (value: object) => boolean) {
  for (const name of ['transform', 'projectionMatrix'] as const) {
    Object.defineProperty(prototype, name, {enumerable: true, configurable: true, get(this: object) {
      if (!has(this)) throw new TypeError('Expected a view geometry receiver.');
      const state = interfaceBrands.viewGeometry.get(this)!;
      return name === 'transform' ? state.transform : state.array();
    }});
  }
}
export const projectionData = (value: object) => {
  const state = interfaceBrands.viewGeometry.get(value);
  if (!state) throw new TypeError('Expected view geometry.');
  return state.projection;
};
export function viewState(value: object) {
  const state = interfaceBrands.views.get(value);
  if (!state) throw new TypeError('Expected XRView.');
  return state;
}
export class XRView {
  declare readonly transform: XRRigidTransform;
  declare readonly projectionMatrix: Float32Array;
  constructor(frame: import('./runtime').XRFrame, eye: 'none' | 'left' | 'right', transform: XRRigidTransform,
    projection: ArrayLike<number>, world: mat4, index: number, token?: symbol) {
    requireGeometryAllocation(token);
    interfaceBrands.views.set(this, {frame, eye, index, world});
    initializeViewGeometry(this, transform, projection);
  }
  get eye() { return viewState(this).eye; }
  get index() { return viewState(this).index; }
  get recommendedViewportScale() { viewState(this); return null; }
  get isFirstPersonObserver() { viewState(this); return false; }
  get _frame() { return viewState(this).frame; }
  get _worldMatrix() { return viewState(this).world; }
  requestViewportScale(scale: number | null) {
    viewState(this);
    if (arguments.length < 1) throw new TypeError('Expected scale.');
    // Required nullable double: explicit undefined and null both convert to null.
    if (scale != null && !Number.isFinite(+scale)) throw new TypeError('Expected a finite double.');
    // Advisory; fixed emulated resolution, including retained views.
  }
}
installViewGeometry(XRView.prototype, value => interfaceBrands.views.has(value));
export function enumerableMembers(prototype: object, names: readonly string[]) {
  for (const name of names) Object.defineProperty(prototype, name, {...Object.getOwnPropertyDescriptor(prototype, name), enumerable: true});
}
enumerableMembers(XRPose.prototype, ['transform', 'emulatedPosition', 'linearVelocity', 'angularVelocity']);
enumerableMembers(XRViewerPose.prototype, ['views']);
enumerableMembers(XRViewport.prototype, ['x', 'y', 'width', 'height']);
enumerableMembers(XRView.prototype, ['eye', 'index', 'recommendedViewportScale', 'isFirstPersonObserver', 'requestViewportScale']);
