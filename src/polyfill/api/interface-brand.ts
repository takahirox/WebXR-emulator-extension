import type {XRSession, XRFrame, XRInputSource} from './runtime';
import type {XRReferenceSpace, XRRigidTransform, XRPose, XRViewerPose, XRView, XRViewport} from './geometry';
import type {mat4} from 'gl-matrix';
import type {EventHandler} from './event-handlers';
import {createLayerAllocations} from './layer-allocation';
import {createMeshAllocations} from './mesh-allocation';
import {createPlaneAllocations} from './plane-allocation';
import {createHitTestAllocations} from './hit-test-allocation';
import {createHandAllocations} from './hand-allocation';

// Same-origin injections share allocation brands, not writable WeakSets. Only
// constructors can brand a newly allocated object; borrowing a prototype or
// wrapping an instance in a Proxy cannot acquire its brand.
export let initializeHandBackend: ReturnType<typeof createHandAllocations>['initialize'] | undefined;

function createBrands() {
  const frames = new WeakSet<object>(), spaces = new WeakSet<object>();
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
    constructor() { super(); spaces.add(this); }
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
  const planeAllocations = createPlaneAllocations(sessions);
  const frameValues = new WeakMap<object, {session: XRSession; predictedDisplayTime: number; pose: (matrix: mat4, emulated: boolean) => XRPose}>();
  const poseValues = new WeakMap<object, {transform: XRRigidTransform; emulatedPosition: boolean}>();
  const {bindings: handAllocations, initialize} = createHandAllocations(inputSources, poseValues);
  initializeHandBackend = initialize;
  return Object.freeze({FrameObject, SpaceObject, SessionObject, InputSourceObject,
    handAllocations,
    layerAllocations: createLayerAllocations(sessions),
    meshAllocations: createMeshAllocations(sessions),
    planeAllocations,
    planeValues: planeAllocations.planes,
    planeSets: planeAllocations.sets,
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
    frameValues,
    viewerPoses: new WeakMap<object, (frame: XRFrame, reference: XRReferenceSpace) => XRViewerPose | null>(),
    poses: poseValues,
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
    joints: handAllocations.joints,
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
export const interfaceBrands: ReturnType<typeof createBrands> = shared[key];
export const brandHost = host;

// All injections use the same complete allocation constructors and private
// membership records. Never discover or invoke predicates from frame properties.
export const layerBrands = interfaceBrands.layerAllocations;
