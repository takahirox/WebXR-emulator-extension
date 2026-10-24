import {Matrix4, Mesh, Object3D, Vector3} from 'three';
import {mat4} from 'gl-matrix';
import {XRSpace} from './geometry';
import type {XRSession} from './runtime';
import {interfaceBrands} from './interface-brand';
import {planeRegions} from './plane-regions';

/** Detection, hit testing and depth share these sensed room meshes. Plane
 * regions have a separate partition; mesh sensing keeps the source triangles.
 * The decorative sky is excluded. No camera/recognition is used. */
export function roomMeshes(room: Object3D | null) {
  const meshes: Mesh[] = [];
  room?.traverse(object => { if (object instanceof Mesh && object.name !== 'sky') meshes.push(object); });
  return meshes;
}
export interface Surface {
  key: string;
  matrix: mat4;
  vertices: number[];
  orientation: 'horizontal' | 'vertical' | null;
}
export function roomSurfaces(room: Object3D | null): Surface[] {
  room?.updateWorldMatrix(true, true);
  const surfaces: Surface[] = [];
  for (const mesh of roomMeshes(room)) {
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) continue;
    const indices = mesh.geometry.index;
    const count = indices?.count ?? positions.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      const x = points[1].clone().sub(points[0]);
      const edge = points[2].clone().sub(points[0]);
      const y = x.clone().cross(edge);
      if (y.lengthSq() < 1e-12) continue;
      x.normalize(); y.normalize(); const z = x.clone().cross(y);
      const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3);
      const matrix = new Matrix4().makeBasis(x, y, z).setPosition(center);
      const vertices = points.flatMap(point => { const delta = point.clone().sub(center); return [delta.dot(x), 0, delta.dot(z)]; });
      surfaces.push({key: `${mesh.uuid}:${i}`, matrix: new Float32Array(matrix.elements), vertices,
        orientation: Math.abs(y.y) > 0.999 ? 'horizontal' : Math.abs(y.y) < 0.001 ? 'vertical' : null});
    }
  }
  return surfaces;
}

const planeAllocation = Symbol('plane allocation');
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
  constructor(values: Iterable<XRPlane>, token?: symbol) {
    if (token !== planeAllocation) throw new TypeError('Illegal constructor.');
    interfaceBrands.planeSets.set(this, new Set(values));
  }
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
    for (const value of set) Reflect.apply(callback, thisArg, [value,value,this]);
  }
  [Symbol.iterator]() { return this.values(); }
}
Object.defineProperties(XRPlaneSet.prototype, {
  keys: {value: XRPlaneSet.prototype.values, writable: true, configurable: true, enumerable: true},
  [Symbol.iterator]: {value: XRPlaneSet.prototype.values, writable: true, configurable: true},
  [Symbol.toStringTag]: {value: 'XRPlaneSet', configurable: true},
});
const meshAllocation = Symbol('mesh allocation');
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
export class XRMeshSet extends meshBindings.MeshSetAllocation implements Iterable<XRMesh> {
  constructor(values: Iterable<XRMesh>, token?: symbol) {
    if (token !== meshAllocation) throw new TypeError('Illegal constructor.');
    super(values);
  }
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
  constructor(session: XRSession, token?: symbol) {
    if (token !== planeAllocation) throw new TypeError('Illegal constructor.');
    const state = {space: null as unknown as XRSpace, polygon: Object.freeze([]) as readonly DOMPointReadOnly[],
      orientation: null as Surface['orientation'], changed: 0, matrix: null as mat4 | null, signature: [] as number[]};
    state.space = new XRSpace(session, () => session.ended ? null : state.matrix);
    interfaceBrands.planeValues.set(this, state);
  }
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
function updatePlane(plane: XRPlane, surface: Surface, time: number) {
  const state = planeState(plane);
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
type MeshTracking = {matrix: mat4 | null; vertices: Float32Array; indices: Uint32Array; changed: number};
const meshTracking = new WeakMap<XRMesh, MeshTracking>();
export class XRMesh extends meshBindings.MeshAllocation {
  constructor(session: XRSession, token?: symbol) {
    if (token !== meshAllocation) throw new TypeError('Illegal constructor.');
    const state: MeshTracking = {matrix: null, vertices: new Float32Array(), indices: new Uint32Array(), changed: 0};
    const space = new XRSpace(session, () => session.ended ? null : state.matrix);
    super(space, () => state);
    meshTracking.set(this, state);
  }
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
function updateMesh(mesh: XRMesh, surface: Surface, time: number) {
  const state = meshTracking.get(mesh)!;
  // Mesh 5397685's attribute-change prose excludes pose-only changes, despite
  // its update algorithm assigning timestamps unconditionally. Orientation is
  // not an XRMesh attribute. Compare with the last published Float32 shape at
  // 10 micrometres, retaining it until a change exceeds that tolerance.
  if (state.vertices.length !== surface.vertices.length || surface.vertices.some((v, i) => Math.abs(v - state.vertices[i]) > 1e-5)) {
    state.vertices = new Float32Array(surface.vertices);
    state.indices = new Uint32Array([0, 1, 2]);
    state.changed = time;
  }
  state.matrix = surface.matrix;
}

/** Session-owned identities; frame sets copy membership, never the mutable map. */
export class EnvironmentTracker {
  private planes = new Map<string, XRPlane>();
  private meshes = new Map<string, XRMesh>();
  constructor(private session: XRSession) {}
  update(time: number) {
    const surfaces = roomSurfaces(this.session._device.arScene?.room ?? null);
    const planeSurfaces = roomMeshes(this.session._device.arScene?.room ?? null).flatMap(planeRegions);
    const planeKeys = new Set(planeSurfaces.map(surface=>surface.key));
    for (const [key, plane] of this.planes) if (!planeKeys.has(key)) { planeState(plane).matrix=null; this.planes.delete(key); }
    const meshKeys = new Set(surfaces.map(surface => surface.key));
    for (const [key, mesh] of this.meshes) if (!meshKeys.has(key)) { meshTracking.get(mesh)!.matrix = null; this.meshes.delete(key); }
    if (this.session.enabledFeatures.includes('plane-detection')) for (const surface of planeSurfaces) {
      let plane = this.planes.get(surface.key);
      if (!plane) this.planes.set(surface.key, plane = new XRPlane(this.session, planeAllocation));
      updatePlane(plane, surface, time);
    }
    for (const surface of surfaces) {
      if (this.session.enabledFeatures.includes('mesh-detection')) {
        let mesh = this.meshes.get(surface.key);
        if (!mesh) this.meshes.set(surface.key, mesh = new XRMesh(this.session, meshAllocation));
        updateMesh(mesh, surface, time);
      }
    }
  }
  snapshot() { return {planes: new XRPlaneSet(this.planes.values(), planeAllocation), meshes: new XRMeshSet(this.meshes.values(), meshAllocation)}; }
  clear() { for (const plane of this.planes.values()) planeState(plane).matrix=null; this.planes.clear(); for (const mesh of this.meshes.values()) meshTracking.get(mesh)!.matrix = null; this.meshes.clear(); }
}
