import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Box3, Mesh, MeshBasicMaterial, Triangle, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HALL_PLAY_AREA} from '../src/polyfill/virtual-play-area';
import {roomMeshes} from '../src/polyfill/api/environment';

// Clip projected floor triangles to the authored rectangle. Their total area
// must cover its 4 m²; a vertical prism checks for walls/obstacles above it.
function clippedArea(points: Vector3[]) {
  let polygon = points.map(p => [p.x, p.z]);
  for (const [axis, sign] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
    const output: number[][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = 1 - sign * a[axis], db = 1 - sign * b[axis];
      if (da >= 0) output.push(a);
      if ((da >= 0) !== (db >= 0)) output.push(a.map((v, j) => v + (b[j] - v) * da / (da - db)));
    }
    polygon = output;
  }
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}

test('authored hall play area is clockwise, floor-covered and clear of obstacles', async () => {
  assert.deepEqual(HALL_PLAY_AREA, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]);
  assert(Object.isFrozen(HALL_PLAY_AREA) && HALL_PLAY_AREA.every(Object.isFrozen));
  const points = HALL_PLAY_AREA.map(p => new Vector3(...p));
  assert(new Triangle(points[0], points[1], points[2]).getNormal(new Vector3()).y < 0, 'clockwise from +Y');
  const buffer = await readFile(new URL('../assets/hall_empty.glb', import.meta.url));
  // Use the actual asset and node/world transforms; texture decoding is irrelevant.
  const loader = new GLTFLoader().register(() => ({name: 'test_material', loadMaterial: async () => new MeshBasicMaterial()}));
  const {scene} = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  scene.updateWorldMatrix(true, true);
  let floorArea = 0, floorTriangles = 0;
  const clearPrism = new Box3(new Vector3(-1, 0.01, -1), new Vector3(1, 1.8, 1));
  for (const mesh of roomMeshes(scene)) {
    assert(mesh instanceof Mesh);
    const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const vertices = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(positions, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      if (vertices.every(p => Math.abs(p.y) < 1e-5)) { floorArea += clippedArea(vertices); floorTriangles++; }
      assert(!clearPrism.intersectsTriangle(new Triangle(...vertices as [Vector3, Vector3, Vector3])), 'no hall triangle intrudes into the usable prism');
    }
  }
  assert.equal(floorTriangles, 6);
  assert(Math.abs(floorArea - 4) < 1e-5, `entire 4 m² region lies on the hall floor (covered ${floorArea})`);
});
