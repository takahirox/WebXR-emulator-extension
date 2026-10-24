import {XRSpace} from './geometry';
import type {XRSession} from './runtime';
import type {XRMesh, XRMeshSet} from './environment';
import {roomSurfaces, type Surface} from './room-surfaces';
import type {mat4} from 'gl-matrix';

/** Share mesh brands and tracking, keeping allocation functions in this
 * closure. Public constructors cannot register caller-supplied records, readers
 * or collections, including through reflective superclass construction. */
export function createMeshAllocations(sessions: WeakSet<object>) {
  const meshes = new WeakMap<object, Readonly<{space: XRSpace; vertices: () => Float32Array; indices: () => Uint32Array; changed: () => number}>>();
  const sets = new WeakMap<object, Readonly<{size: number; has: (value: XRMesh) => boolean; values: () => SetIterator<XRMesh>; entries: () => SetIterator<[XRMesh, XRMesh]>}>>();
  const meshBindings = Object.freeze({
    meshes: Object.freeze({get: (value: object) => meshes.get(value)}),
    sets: Object.freeze({get: (value: object) => sets.get(value)})});
  type MeshTracking = {matrix: mat4 | null; vertices: Float32Array; indices: Uint32Array; changed: number};
  const meshTracking = new WeakMap<XRMesh, MeshTracking>();
  // Allocate without invoking public constructors or their mutable superclass
  // chains. No public factory can retain caller-supplied records or callbacks.
  function allocateMesh(session: XRSession, prototype: XRMesh): XRMesh {
    const state: MeshTracking = {matrix: null, vertices: new Float32Array(), indices: new Uint32Array(), changed: 0};
    const space = new XRSpace(session, () => session.ended ? null : state.matrix);
    const mesh: XRMesh = Object.create(prototype);
    meshes.set(mesh, Object.freeze({space,
      vertices: () => new Float32Array(state.vertices),
      indices: () => new Uint32Array(state.indices), changed: () => state.changed}));
    meshTracking.set(mesh, state);
    return mesh;
  }
  function allocateSet(values: Iterable<XRMesh>, prototype: XRMeshSet): XRMeshSet {
    const set = new Set(values);
    const collection: XRMeshSet = Object.create(prototype);
    sets.set(collection, Object.freeze({size: set.size, has: (value: XRMesh) => set.has(value),
      values: () => set.values(), entries: () => set.entries()}));
    return collection;
  }
  function updateMesh(mesh: XRMesh, surface: Surface, time: number) {
    const state = meshTracking.get(mesh)!;
    // Mesh 5397685's attribute-change prose excludes pose-only changes, despite
    // its update algorithm assigning timestamps unconditionally. Orientation is
    // not an XRMesh attribute. Round candidates to their published Float32
    // precision before comparing with the last published shape at 10 micrometres,
    // retaining it until a change exceeds that tolerance.
    const vertices = new Float32Array(surface.vertices);
    if (state.vertices.length !== vertices.length || vertices.some((v, i) => Math.abs(v - state.vertices[i]) > 1e-5)) {
      state.vertices = vertices;
      state.indices = new Uint32Array([0, 1, 2]);
      state.changed = time;
    }
    state.matrix = surface.matrix;
  }

  // Only this tracker invokes the private allocation functions. Its API reads
  // the existing virtual backend, never caller-supplied mesh records/readers.
  const trackers = new WeakMap<MeshTracker, {session: XRSession; meshes: Map<string, XRMesh>; meshPrototype: XRMesh; setPrototype: XRMeshSet}>();
  class MeshTracker {
    constructor(session: XRSession, meshPrototype: XRMesh, setPrototype: XRMeshSet) {
      if (!sessions.has(session)) throw new TypeError('Expected XRSession.');
      trackers.set(this, {session, meshes: new Map(), meshPrototype, setPrototype});
    }
    update(time: number) {
      const {session, meshes, meshPrototype} = trackers.get(this)!;
      const surfaces = roomSurfaces(session._device.arScene?.room ?? null);
      const keys = new Set(surfaces.map(surface => surface.key));
      for (const [key, mesh] of meshes) if (!keys.has(key)) {
        meshTracking.get(mesh)!.matrix = null; meshes.delete(key);
      }
      if (session.enabledFeatures.includes('mesh-detection')) for (const surface of surfaces) {
        let mesh = meshes.get(surface.key);
        if (!mesh) meshes.set(surface.key, mesh = allocateMesh(session, meshPrototype));
        updateMesh(mesh, surface, time);
      }
    }
    snapshot() {
      const {meshes, setPrototype} = trackers.get(this)!;
      return allocateSet(meshes.values(), setPrototype);
    }
    clear() {
      const {meshes} = trackers.get(this)!;
      for (const mesh of meshes.values()) meshTracking.get(mesh)!.matrix = null;
      meshes.clear();
    }
  }
  Object.freeze(MeshTracker.prototype); Object.freeze(MeshTracker);
  return Object.freeze({MeshTracker, ...meshBindings});
}
