import {XRSpace} from './geometry';
import type {XRSession} from './runtime';
import type {XRPlane, XRPlaneSet} from './environment';
import {planeRegions} from './plane-regions';
import {roomMeshes, type Surface} from './room-surfaces';
import {mat4} from 'gl-matrix';

/** Same-origin injections share protected readers and a backend tracker. The
 * allocation functions, tracking records and membership writers stay private. */
export function createPlaneAllocations(sessions: WeakSet<object>) {
  type PlaneTracking = {space: XRSpace; polygon: readonly DOMPointReadOnly[];
    orientation: Surface['orientation']; changed: number; matrix: mat4 | null; signature: number[]};
  const tracking = new WeakMap<XRPlane, PlaneTracking>();
  const planes = new WeakMap<object, Readonly<{space: XRSpace; polygon: readonly DOMPointReadOnly[];
    orientation: Surface['orientation']; changed: number}>>();
  const sets = new WeakMap<object, Readonly<{size: number; has: (value: XRPlane) => boolean;
    values: () => SetIterator<XRPlane>; entries: () => SetIterator<[XRPlane, XRPlane]>}>>();

  // Never call public constructors/superclasses or retain caller-supplied
  // records, iterables or callbacks as the source of trusted plane state.
  function allocatePlane(session: XRSession, prototype: XRPlane): XRPlane {
    const state: PlaneTracking = {space: null as unknown as XRSpace, polygon: Object.freeze([]),
      orientation: null, changed: 0, matrix: null, signature: []};
    // XRSpace's diagnostic provider/base matrix must not export the tracking buffer.
    state.space = new XRSpace(session, () => session.ended || !state.matrix ? null : mat4.clone(state.matrix));
    const plane: XRPlane = Object.create(prototype);
    tracking.set(plane, state);
    planes.set(plane, Object.freeze({space: state.space,
      get polygon() { return state.polygon; }, get orientation() { return state.orientation; },
      get changed() { return state.changed; }}));
    return plane;
  }
  function allocateSet(values: Iterable<XRPlane>, prototype: XRPlaneSet): XRPlaneSet {
    const set = new Set(values), collection: XRPlaneSet = Object.create(prototype);
    sets.set(collection, Object.freeze({size: set.size, has: (value: XRPlane) => set.has(value),
      values: () => set.values(), entries: () => set.entries()}));
    return collection;
  }
  function updatePlane(plane: XRPlane, surface: Surface, time: number) {
    const state = tracking.get(plane)!;
    // Planes 394f13e attribute-change prose and WPT no_change take precedence
    // over the update algorithm's unconditional timestamp assignment.
    if (state.signature.length !== surface.vertices.length || surface.vertices.some((v,i)=>Math.abs(v-state.signature[i])>1e-5) || state.orientation !== surface.orientation) {
      state.changed = time;
      // Compare future updates with published geometry so tiny changes accumulate.
      state.signature = surface.vertices.slice();
      state.polygon = Object.freeze(Array.from({length: surface.vertices.length/3}, (_,i) => Object.freeze(new DOMPointReadOnly(surface.vertices[i*3],0,surface.vertices[i*3+2],1))));
    }
    state.orientation = surface.orientation; state.matrix = surface.matrix;
  }
  const trackers = new WeakMap<PlaneTracker, {session: XRSession; planes: Map<string, XRPlane>;
    planePrototype: XRPlane; setPrototype: XRPlaneSet}>();
  class PlaneTracker {
    constructor(session: XRSession, planePrototype: XRPlane, setPrototype: XRPlaneSet) {
      if (!sessions.has(session)) throw new TypeError('Expected XRSession.');
      trackers.set(this, {session, planes: new Map(), planePrototype, setPrototype});
    }
    update(time: number) {
      if (!Number.isFinite(time)) throw new TypeError('Expected finite frame time.');
      const {session, planes, planePrototype} = trackers.get(this)!;
      const surfaces = roomMeshes(session._device.arScene?.room ?? null).flatMap(planeRegions);
      const keys = new Set(surfaces.map(surface => surface.key));
      for (const [key, plane] of planes) if (!keys.has(key)) {
        tracking.get(plane)!.matrix = null; planes.delete(key);
      }
      if (!session.ended && session.enabledFeatures.includes('plane-detection')) for (const surface of surfaces) {
        let plane = planes.get(surface.key);
        if (!plane) planes.set(surface.key, plane = allocatePlane(session, planePrototype));
        updatePlane(plane, surface, time);
      }
    }
    snapshot() {
      const {planes, setPrototype} = trackers.get(this)!;
      return allocateSet(planes.values(), setPrototype);
    }
    clear() {
      const {planes} = trackers.get(this)!;
      for (const plane of planes.values()) tracking.get(plane)!.matrix = null;
      planes.clear();
    }
  }
  Object.freeze(PlaneTracker.prototype); Object.freeze(PlaneTracker);
  return Object.freeze({PlaneTracker,
    planes: Object.freeze({get: (value: object) => planes.get(value)}),
    sets: Object.freeze({get: (value: object) => sets.get(value)})});
}
