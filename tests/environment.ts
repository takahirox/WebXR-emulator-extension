import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial} from 'three';
import {mat4, vec3} from 'gl-matrix';
import {EnvironmentTracker} from '../src/polyfill/api/environment';
import type {XRSession} from '../src/polyfill/api/runtime';
import type {XRFrame} from '../src/polyfill/api/runtime';
import {XRCPUDepthInformation} from '../src/polyfill/api/sensing';
import {XRView, XRRigidTransform} from '../src/polyfill/api/geometry';

// Node lacks the browser's immutable geometry point. Browser conformance tests
// exercise the real DOMPointReadOnly and public XRFrame interfaces as well.
Object.defineProperty(globalThis, 'DOMPointReadOnly', {value: class {
  constructor(readonly x = 0, readonly y = 0, readonly z = 0, readonly w = 1) { Object.freeze(this); }
}});

test('room patches preserve world geometry, identity, updates and removal', () => {
  const room = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const floor = new Mesh(geometry, new MeshBasicMaterial()); room.add(floor);
  const sky = floor.clone(); sky.name = 'sky'; room.add(sky);
  const device = {arScene: {room: room as Group | null}};
  const session = {_device: device, enabledFeatures: ['plane-detection', 'mesh-detection'], ended: false} as unknown as XRSession;
  const tracker = new EnvironmentTracker(session);
  tracker.update(10);
  const first = tracker.snapshot(), plane = [...first.planes][0], mesh = [...first.meshes][0];
  assert.equal(first.planes.size, 2, 'two actual triangles; no decorative sky');
  assert.equal(first.meshes.size, 2);
  assert.equal(plane.orientation, 'horizontal');
  assert.equal(plane.lastChangedTime, 10);
  assert.deepEqual([...mesh.indices], [0, 1, 2]);
  assert(Object.isFrozen(plane.polygon));
  assert(!('add' in first.planes));
  assert.deepEqual([...first.planes.entries()].map(([key, value]) => key === value), [true, true]);
  let iterations = 0;
  first.planes.forEach((value, key, set) => { assert.equal(value, key); assert.equal(set, first.planes); iterations++; });
  assert.equal(iterations, 2);
  // Reconstruct the known world-space fixture, independently of its local axes.
  const world = plane.planeSpace._update()!;
  const points = plane.polygon.map(p => vec3.transformMat4(vec3.create(), [p.x, p.y, p.z], world));
  for (const expected of [[-2, 0, -2], [2, 0, 2], [2, 0, -2]]) assert(points.some(p => vec3.distance(p, expected) < 1e-5));
  assert(Math.abs(world[5] - 1) < 1e-5, '+Y follows the surface normal');
  tracker.update(20);
  assert(tracker.snapshot().planes.has(plane));
  assert.equal(plane.lastChangedTime, 10);
  room.position.set(3, 4, 5); room.rotation.y = 0.7;
  tracker.update(30);
  assert.equal(plane.lastChangedTime, 10, 'rigid motion does not change polygon time');
  assert.equal(mesh.lastChangedTime, 10);
  assert(vec3.distance(mat4.getTranslation(vec3.create(), plane.planeSpace._update()!), mat4.getTranslation(vec3.create(), world)) > 1);
  floor.scale.x = 2; tracker.update(40);
  assert.equal(plane.lastChangedTime, 40, 'shape changes update existing objects');
  assert.equal(mesh.lastChangedTime, 40);
  assert(tracker.snapshot().meshes.has(mesh));
  device.arScene.room = null; tracker.update(50);
  assert.equal(tracker.snapshot().planes.size, 0);
  assert.equal(tracker.snapshot().meshes.size, 0);
  assert.equal(plane.planeSpace._update(), null);
  assert.equal(mesh.meshSpace._update(), null);
  assert.equal(first.planes.size, 2, 'old frame membership is a snapshot');
  device.arScene.room = room; tracker.update(60);
  assert(!tracker.snapshot().planes.has(plane), 'reacquired surfaces have fresh identity');
  const current = [...tracker.snapshot().planes][0]; tracker.clear();
  assert.equal(current.planeSpace._update(), null);
  assert.equal(tracker.snapshot().planes.size, 0);
});

test('non-indexed, sloped and degenerate geometry; feature independence', () => {
  const room = new Group(); const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  room.add(new Mesh(geometry));
  const session = {_device: {arScene: {room}}, enabledFeatures: ['mesh-detection'], ended: false} as unknown as XRSession;
  const tracker = new EnvironmentTracker(session); tracker.update(1);
  assert.equal(tracker.snapshot().planes.size, 0);
  assert.equal(tracker.snapshot().meshes.size, 1, 'degenerate triangle omitted');
  const mesh = [...tracker.snapshot().meshes][0];
  assert(mesh.vertices.every(Number.isFinite));
  const world = mesh.meshSpace._update()!;
  assert(Math.abs(Math.hypot(world[4], world[5], world[6]) - 1) < 1e-5);
  (session as unknown as {ended: boolean}).ended = true;
  assert.equal(mesh.meshSpace._update(), null);
});

test('depth formats encode a known plane in meters, quantize and never wrap', () => {
  for (const format of ['float32', 'unsigned-short', 'luminance-alpha']) {
    let distance = 2.3456;
    // Independent analytic plane at z=-distance. Off-axis ray length varies,
    // while the expected camera-plane depth is constant for every pixel.
    const frame = {session: {depthDataFormat: format, _device: {arScene: {
      getHitTestResults: (_origin: unknown, direction: vec3) => [{distance: distance / -direction[2]}],
    }}}, _assertActive() {}} as unknown as XRFrame;
    const projection = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 1000);
    const view = new XRView(frame, 'none', new XRRigidTransform(), new Float32Array(projection), mat4.create());
    let info = new XRCPUDepthInformation(frame, view);
    const floating = format === 'float32';
    const samples = floating ? new Float32Array(info.data) : new Uint16Array(info.data);
    const expected = floating ? 2.3456 : 2346;
    assert(samples.every(value => Math.abs(value - expected) < 1e-4));
    assert(Math.abs(info.getDepthInMeters(0.5, 0.5) - (floating ? 2.3456 : 2.346)) < 1e-5);
    assert.throws(() => info.getDepthInMeters(NaN, 0), TypeError);
    assert.throws(() => info.getDepthInMeters(1.01, 0), RangeError);
    distance = 100; info = new XRCPUDepthInformation(frame, view);
    assert.equal(info.getDepthInMeters(0, 0), floating ? 100 : 0, 'out-of-range Uint16 data is unknown');
    distance = 0; info = new XRCPUDepthInformation(frame, view);
    assert.equal(info.getDepthInMeters(1, 1), 0);
  }
});
