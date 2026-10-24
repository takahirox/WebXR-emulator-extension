import {Matrix4, Mesh, Object3D, Vector3} from 'three';
import type {mat4} from 'gl-matrix';

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

