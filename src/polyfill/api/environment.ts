import {Matrix4, Mesh, Object3D, Vector3} from 'three';
import {mat4} from 'gl-matrix';
import {XRSpace} from './geometry';
import type {XRSession} from './runtime';

/** The room's triangle patches are shared by detection, hit testing and depth.
 * The decorative sky is not a sensed surface. No camera/recognition is used. */
export function roomMeshes(room: Object3D | null) {
  const meshes: Mesh[] = [];
  room?.traverse(object => { if (object instanceof Mesh && object.name !== 'sky') meshes.push(object); });
  return meshes;
}
interface Surface {
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
export class XRPlaneSet extends ReadonlyDetectionSet<XRPlane> {}
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
export class XRPlane extends TrackedSurface {
  private polygonValue: readonly DOMPointReadOnly[] = Object.freeze([]);
  get planeSpace() { return this.space; }
  get polygon() { return this.polygonValue; }
  get orientation() { return this.orientationValue; }
  override _update(surface: Surface, time: number) {
    super._update(surface, time);
    this.polygonValue = Object.freeze([0, 3, 6].map(i => new DOMPointReadOnly(surface.vertices[i], 0, surface.vertices[i + 2], 1)));
  }
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
    const keys = new Set(surfaces.map(surface => surface.key));
    this.reconcile(this.planes, keys); this.reconcile(this.meshes, keys);
    for (const surface of surfaces) {
      if (this.session.enabledFeatures.includes('plane-detection')) {
        let plane = this.planes.get(surface.key);
        if (!plane) this.planes.set(surface.key, plane = new XRPlane(this.session));
        plane._update(surface, time);
      }
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
  snapshot() { return {planes: new XRPlaneSet(this.planes.values()), meshes: new XRMeshSet(this.meshes.values())}; }
  clear() { this.reconcile(this.planes, new Set()); this.reconcile(this.meshes, new Set()); }
}
