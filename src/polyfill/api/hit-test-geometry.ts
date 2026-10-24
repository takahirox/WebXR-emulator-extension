import {Matrix4, Ray, Vector3} from 'three';
import {roomMeshes, roomSurfaces, type Surface} from './environment';
import {planeRegions} from './plane-regions';
import type {Object3D} from 'three';

export interface HitTestGeometry {planes: Surface[]; meshes: Surface[]}
export function roomHitTestGeometry(room: Object3D | null): HitTestGeometry {
  room?.updateWorldMatrix(true, true);
  return {planes: roomMeshes(room).flatMap(planeRegions), meshes: roomSurfaces(room)};
}
/** Native candidates retain the representation used to compute each hit.
 * Plane regions and mesh triangles may coincide; neither is relabeled as the
 * other, and point requests have no candidates until point data exists. */
export function intersectHitTestGeometry(origin: ArrayLike<number>, direction: ArrayLike<number>, geometry: HitTestGeometry, types: readonly string[]) {
  const ray = new Ray(new Vector3().fromArray(origin), new Vector3().fromArray(direction).normalize());
  const hits: {point: Vector3; normal: Vector3; distance: number; entityType: 'plane' | 'mesh'}[] = [];
  if (![...ray.origin.toArray(), ...ray.direction.toArray()].every(Number.isFinite) || !ray.direction.lengthSq()) return hits;
  for (const [entityType, surfaces] of [['plane', geometry.planes], ['mesh', geometry.meshes]] as const) {
    if (!types.includes(entityType)) continue;
    for (const surface of surfaces) {
      const matrix = new Matrix4().fromArray(surface.matrix);
      const points = Array.from({length: surface.vertices.length / 3}, (_, i) => new Vector3().fromArray(surface.vertices, i * 3).applyMatrix4(matrix));
      for (let i = 1; i + 1 < points.length; i++) {
        const point = ray.intersectTriangle(points[0], points[i], points[i + 1], false, new Vector3());
        if (!point) continue;
        const normal = new Vector3(0, 1, 0).transformDirection(matrix);
        hits.push({point, normal, distance: point.distanceTo(ray.origin), entityType});
        break; // A triangulated convex plane is one native candidate.
      }
    }
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
