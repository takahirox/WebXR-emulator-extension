import type {XRSpace} from './geometry';
import type {XRMesh} from './environment';

/** Cross-injection allocation brands expose frozen readers, never tracking
 * records or registry writers. Constructors only brand their new object. */
export function createMeshAllocations() {
  type Shape = {vertices: Float32Array; indices: Uint32Array; changed: number};
  const meshes = new WeakMap<object, Readonly<{space: XRSpace; vertices: () => Float32Array; indices: () => Uint32Array; changed: () => number}>>();
  const sets = new WeakMap<object, Readonly<{size: number; has: (value: XRMesh) => boolean; values: () => SetIterator<XRMesh>; entries: () => SetIterator<[XRMesh, XRMesh]>}>>();
  class MeshAllocation {
    constructor(space: XRSpace, read: () => Shape) {
      meshes.set(this, Object.freeze({space,
        vertices: () => new Float32Array(read().vertices),
        indices: () => new Uint32Array(read().indices), changed: () => read().changed}));
    }
  }
  class MeshSetAllocation {
    constructor(values: Iterable<XRMesh>) {
      const snapshot = [...new Set(values)];
      if (snapshot.some(value => !meshes.has(value))) throw new TypeError('Expected XRMesh.');
      const set = new Set(snapshot);
      sets.set(this, Object.freeze({size: set.size, has: (value: XRMesh) => set.has(value),
        values: () => set.values(), entries: () => set.entries()}));
    }
  }
  for (const C of [MeshAllocation, MeshSetAllocation]) { Object.freeze(C.prototype); Object.freeze(C); }
  return Object.freeze({MeshAllocation, MeshSetAllocation,
    meshes: Object.freeze({get: (value: object) => meshes.get(value)}),
    sets: Object.freeze({get: (value: object) => sets.get(value)})});
}
