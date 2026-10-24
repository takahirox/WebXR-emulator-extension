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

class ReadonlyDetectionSet<T> implements Iterable<T> {
  private readonly set: Set<T>;
  constructor(values: Iterable<T>) { this.set = new Set(values); }
  get size() { return this.set.size; }
  has(value: T) { return this.set.has(value); }
  values() { return this.set.values(); }
  keys() { return this.set.keys(); }
  entries() { return this.set.entries(); }
  forEach(callback: (value: T, key: T, set: this) => void, thisArg?: unknown) { for (const value of this) callback.call(thisArg, value, value, this); }
  [Symbol.iterator]() { return this.values(); }
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
export class XRMeshSet extends ReadonlyDetectionSet<XRMesh> {}

class TrackedSurface {
  private matrix: mat4 | null = null;
  private signature: number[] = [];
  protected changed = 0;
  protected orientationValue: Surface['orientation'] = null;
  readonly space: XRSpace;
  constructor(session: XRSession) { this.space = new XRSpace(session, () => session.ended ? null : this.matrix); }
  get lastChangedTime() { return this.changed; }
  get semanticLabel() { return null; }
  _remove() { this.matrix = null; }
  _update(surface: Surface, time: number) {
    if (this.signature.length !== surface.vertices.length || surface.vertices.some((v, i) => Math.abs(v - this.signature[i]) > 1e-5) || surface.orientation !== this.orientationValue) this.changed = time;
    this.signature = surface.vertices.slice(); this.orientationValue = surface.orientation; this.matrix = surface.matrix;
  }
}
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
export class XRMesh extends TrackedSurface {
  private verticesValue = new Float32Array();
  private indicesValue = new Uint32Array();
  get meshSpace() { return this.space; }
  get vertices() { return this.verticesValue; }
  get indices() { return this.indicesValue; }
  override _update(surface: Surface, time: number) {
    super._update(surface, time);
    this.verticesValue = new Float32Array(surface.vertices); this.indicesValue = new Uint32Array([0, 1, 2]);
  }
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
    this.reconcile(this.meshes, new Set(surfaces.map(surface=>surface.key)));
    if (this.session.enabledFeatures.includes('plane-detection')) for (const surface of planeSurfaces) {
      let plane = this.planes.get(surface.key);
      if (!plane) this.planes.set(surface.key, plane = new XRPlane(this.session, planeAllocation));
      updatePlane(plane, surface, time);
    }
    for (const surface of surfaces) {
      if (this.session.enabledFeatures.includes('mesh-detection')) {
        let mesh = this.meshes.get(surface.key);
        if (!mesh) this.meshes.set(surface.key, mesh = new XRMesh(this.session));
        mesh._update(surface, time);
      }
    }
  }
  private reconcile<T extends TrackedSurface>(map: Map<string, T>, keys: Set<string>) {
    for (const [key, value] of map) if (!keys.has(key)) { value._remove(); map.delete(key); }
  }
  snapshot() { return {planes: new XRPlaneSet(this.planes.values(), planeAllocation), meshes: new XRMeshSet(this.meshes.values())}; }
  clear() { for (const plane of this.planes.values()) planeState(plane).matrix=null; this.planes.clear(); this.reconcile(this.meshes, new Set()); }
}
