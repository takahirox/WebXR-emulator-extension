// Initialize geometry before the shared allocators that defer XRSpace creation.
import './geometry';
import type {XRSession} from './runtime';
import {interfaceBrands} from './interface-brand';
export {roomMeshes, roomSurfaces, type Surface} from './room-surfaces';

function planeState(value: XRPlane) {
  const state = interfaceBrands.planeValues.get(value);
  if (!state) throw new TypeError('Expected XRPlane.');
  return state;
}
function planeSetState(value: XRPlaneSet) {
  const state = interfaceBrands.planeSets.get(value);
  if (!state) throw new TypeError('Expected XRPlaneSet.');
  return state;
}
export class XRPlaneSet implements Iterable<XRPlane> {
  constructor(_values?: Iterable<XRPlane>) { throw new TypeError('Illegal constructor.'); }
  get size() { return planeSetState(this).size; }
  has(value: XRPlane) {
    const set = planeSetState(this);
    if (!arguments.length) throw new TypeError('XRPlane is required.');
    planeState(value);
    return set.has(value);
  }
  values() { return planeSetState(this).values(); }
  keys() { return this.values(); }
  entries() { return planeSetState(this).entries(); }
  forEach(callback: (value: XRPlane, key: XRPlane, set: XRPlaneSet) => void, thisArg: unknown = undefined) {
    const set = planeSetState(this);
    if (typeof callback !== 'function') throw new TypeError('Expected callable callback.');
    for (const value of set.values()) Reflect.apply(callback, thisArg, [value,value,this]);
  }
  [Symbol.iterator]() { return this.values(); }
}
Object.defineProperties(XRPlaneSet.prototype, {
  keys: {value: XRPlaneSet.prototype.values, writable: true, configurable: true, enumerable: true},
  [Symbol.iterator]: {value: XRPlaneSet.prototype.values, writable: true, configurable: true},
  [Symbol.toStringTag]: {value: 'XRPlaneSet', configurable: true},
});
const meshBindings = interfaceBrands.meshAllocations;
function meshState(value: XRMesh) {
  const state = meshBindings.meshes.get(value);
  if (!state) throw new TypeError('Expected XRMesh.');
  return state;
}
function meshSetState(value: XRMeshSet) {
  const state = meshBindings.sets.get(value);
  if (!state) throw new TypeError('Expected XRMeshSet.');
  return state;
}
export class XRMeshSet implements Iterable<XRMesh> {
  constructor(_values?: Iterable<XRMesh>) { throw new TypeError('Illegal constructor.'); }
  get size() { return meshSetState(this).size; }
  has(value: XRMesh) {
    const set = meshSetState(this);
    if (!arguments.length) throw new TypeError('XRMesh is required.');
    meshState(value);
    return set.has(value);
  }
  values() { return meshSetState(this).values(); }
  keys() { return this.values(); }
  entries() { return meshSetState(this).entries(); }
  forEach(callback: (value: XRMesh, key: XRMesh, set: XRMeshSet) => void, thisArg: unknown = undefined) {
    const set = meshSetState(this);
    if (typeof callback !== 'function') throw new TypeError('Expected callable callback.');
    for (const value of set.values()) Reflect.apply(callback, thisArg, [value, value, this]);
  }
  [Symbol.iterator]() { return this.values(); }
}
Object.defineProperties(XRMeshSet.prototype, {
  keys: {value: XRMeshSet.prototype.values, writable: true, configurable: true, enumerable: true},
  [Symbol.iterator]: {value: XRMeshSet.prototype.values, writable: true, configurable: true},
  [Symbol.toStringTag]: {value: 'XRMeshSet', configurable: true},
});

export class XRPlane {
  constructor(_session?: XRSession) { throw new TypeError('Illegal constructor.'); }
  get planeSpace() { return planeState(this).space; }
  get polygon() { return planeState(this).polygon; }
  get orientation() { return planeState(this).orientation; }
  get lastChangedTime() { return planeState(this).changed; }
  get semanticLabel() { planeState(this); return null; }
}
Object.defineProperty(XRPlane, 'length', {value: 0});
Object.defineProperty(XRPlaneSet, 'length', {value: 0});
Object.defineProperty(XRPlane.prototype, Symbol.toStringTag, {value: 'XRPlane', configurable: true});
for (const prototype of [XRPlane.prototype, XRPlaneSet.prototype]) {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name !== 'constructor') Object.defineProperty(prototype, name, {enumerable: true});
  }
}
export class XRMesh {
  constructor(_session?: XRSession) { throw new TypeError('Illegal constructor.'); }
  get meshSpace() { return meshState(this).space; }
  get vertices() { return meshState(this).vertices(); }
  get indices() { return meshState(this).indices(); }
  get lastChangedTime() { return meshState(this).changed(); }
  get semanticLabel() { meshState(this); return null; }
}
Object.defineProperty(XRMesh.prototype, Symbol.toStringTag, {value: 'XRMesh', configurable: true});
for (const C of [XRMesh, XRMeshSet]) {
  Object.defineProperty(C, 'length', {value: 0});
  for (const name of Object.getOwnPropertyNames(C.prototype)) {
    if (name !== 'constructor') Object.defineProperty(C.prototype, name, {enumerable: true});
  }
}

/** Session-owned identities; frame sets copy membership, never the mutable map. */
export class EnvironmentTracker {
  private planes: InstanceType<typeof interfaceBrands.planeAllocations.PlaneTracker>;
  private meshes: InstanceType<typeof interfaceBrands.meshAllocations.MeshTracker>;
  constructor(session: XRSession) {
    this.planes = new interfaceBrands.planeAllocations.PlaneTracker(session, XRPlane.prototype, XRPlaneSet.prototype);
    this.meshes = new interfaceBrands.meshAllocations.MeshTracker(session, XRMesh.prototype, XRMeshSet.prototype);
  }
  update(time: number) { this.meshes.update(time); this.planes.update(time); }
  snapshot() { return {planes: this.planes.snapshot(), meshes: this.meshes.snapshot()}; }
  clear() { this.planes.clear(); this.meshes.clear(); }
}
