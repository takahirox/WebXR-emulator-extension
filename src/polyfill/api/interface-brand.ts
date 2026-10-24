import type {XRSession, XRFrame, XRInputSource} from './runtime';
import type {XRReferenceSpace, XRRigidTransform, XRPose, XRViewerPose, XRView, XRViewport} from './geometry';
import type {mat4} from 'gl-matrix';
import type {EventHandler} from './event-handlers';
import {createLayerAllocations} from './layer-allocation';
import {createMeshAllocations} from './mesh-allocation';
import {createHitTestAllocations} from './hit-test-allocation';

// Same-origin injections share allocation brands, not writable WeakSets. Only
// constructors can brand a newly allocated object; borrowing a prototype or
// wrapping an instance in a Proxy cannot acquire its brand.
function createBrands() {
  const frames = new WeakSet<object>(), spaces = new WeakSet<object>(), joints = new WeakSet<object>();
  const sessions = new WeakSet<object>(), inputSources = new WeakSet<object>();
  class SessionObject extends EventTarget {
    constructor() { super(); sessions.add(this); }
  }
  class InputSourceObject {
    constructor() { inputSources.add(this); }
  }
  class FrameObject {
    constructor() { frames.add(this); }
  }
  class SpaceObject extends EventTarget {
    constructor(joint = false) { super(); spaces.add(this); if (joint) joints.add(this); }
  }
  Object.freeze(FrameObject.prototype); Object.freeze(FrameObject);
  Object.freeze(SpaceObject.prototype); Object.freeze(SpaceObject);
  Object.freeze(SessionObject.prototype); Object.freeze(SessionObject);
  Object.freeze(InputSourceObject.prototype); Object.freeze(InputSourceObject);
  const transforms = new WeakMap<object, {
    position: DOMPointReadOnly; orientation: DOMPointReadOnly; geometry: mat4;
    matrix: () => Float32Array; inverse: () => XRRigidTransform;
  }>();
  const hitTestAllocations = createHitTestAllocations({sessions, spaces, frames, inputSources, transforms});
  return Object.freeze({FrameObject, SpaceObject, SessionObject, InputSourceObject,
    layerAllocations: createLayerAllocations(sessions),
    meshAllocations: createMeshAllocations(sessions),
    planeValues: new WeakMap<object, {
      space: import('./geometry').XRSpace; polygon: readonly DOMPointReadOnly[];
      orientation: 'horizontal' | 'vertical' | null; changed: number;
      matrix: mat4 | null; signature: number[];
    }>(),
    planeSets: new WeakMap<object, Set<import('./environment').XRPlane>>(),
    roomCaptures: new WeakMap<object, () => Promise<void>>(),
    hitTestAllocations,
    rays: hitTestAllocations.rays,
    hitSources: hitTestAllocations.hitSources,
    transientHitSources: hitTestAllocations.transientHitSources,
    hitResults: hitTestAllocations.hitResults,
    transientHitResults: hitTestAllocations.transientHitResults,
    // Invoke the session realm's operation without consulting public properties.
    transforms,
    referenceOffsets: new WeakMap<object, (transform: mat4) => XRReferenceSpace>(),
    referenceSpaceRequests: new WeakMap<object, (type: string) => Promise<XRReferenceSpace>>(),
    frameValues: new WeakMap<object, {session: XRSession; predictedDisplayTime: number; pose: (matrix: mat4, emulated: boolean) => XRPose}>(),
    viewerPoses: new WeakMap<object, (frame: XRFrame, reference: XRReferenceSpace) => XRViewerPose | null>(),
    poses: new WeakMap<object, {transform: XRRigidTransform; emulatedPosition: boolean}>(),
    viewerViews: new WeakMap<object, readonly XRView[]>(),
    views: new WeakMap<object, {frame: XRFrame; eye: 'none' | 'left' | 'right'; index: number; world: mat4}>(),
    viewGeometry: new WeakMap<object, {transform: XRRigidTransform; projection: mat4; array: () => Float32Array}>(),
    depthGeometry: new WeakSet<object>(),
    spaceRelations: new WeakMap<object, {origin: object; offset: mat4; tracking: {emulatedPosition: boolean}}>(),
    trackingOrigins: new WeakMap<object, {emulatedPosition: boolean}>(),
    bindingSubImages: new WeakMap<object, (layer: import('./layers').XRProjectionLayer, view: XRView) => import('./layers').XRWebGLSubImage>(),
    viewports: new WeakMap<object, {x: number; y: number; width: number; height: number}>(),
    layerViewports: new WeakMap<object, (view: XRView) => XRViewport>(),
    // Dispatch and declared event attributes belong to the object, even when an
    // accessor from another injection is borrowed. Weak keys reject proxies and
    // prototype forgeries just as they do in an individual injection.
    eventSessions: new WeakMap<object, {session: XRSession}>(),
    eventInputs: new WeakMap<object, {frame: XRFrame; inputSource: XRInputSource}>(),
    eventChanges: new WeakMap<object, {session: XRSession; added: readonly XRInputSource[]; removed: readonly XRInputSource[]}>(),
    eventHandlers: new WeakMap<object, Map<string, {value: EventHandler; listener: EventListener}>>(),
    sessions: Object.freeze({has: (value: object) => sessions.has(value)}),
    inputSources: Object.freeze({has: (value: object) => inputSources.has(value)}),
    frames: Object.freeze({has: (value: object) => frames.has(value)}),
    spaces: Object.freeze({has: (value: object) => spaces.has(value)}),
    joints: Object.freeze({has: (value: object) => joints.has(value)}),
  });
}

// Reuse allocation bases through both parent and opener links. Popups have
// themselves as parent, so walking only ancestors would split their brands.
// Only inspect registries on accessible windows; relationship links can cross
// origins. Track visited WindowProxies because opener links can form cycles.
const key = Symbol.for('WebXR-emulator.interface-brands');
let host: object = globalThis;
if (typeof window !== 'undefined') {
  const pending: Window[] = [window], visited = new Set<Window>();
  while (pending.length) {
    const candidate = pending.pop()!;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      void candidate.document;
      host = candidate;
      if (Object.prototype.hasOwnProperty.call(candidate, key)) break;
    } catch { /* cross-origin or closed */ }
    try { if (candidate.opener) pending.push(candidate.opener as Window); } catch { /* closed */ }
    try { pending.push(candidate.parent); } catch { /* closed */ }
  }
}
const shared = host as unknown as {[key: symbol]: ReturnType<typeof createBrands>};
if (!Object.prototype.hasOwnProperty.call(shared, key)) {
  Object.defineProperty(shared, key, {value: createBrands()});
}
export const interfaceBrands = shared[key];

// All injections use the same complete allocation constructors and private
// membership records. Never discover or invoke predicates from frame properties.
export const layerBrands = interfaceBrands.layerAllocations;
