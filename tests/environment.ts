import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3} from 'three';
import {mat4, vec3} from 'gl-matrix';
import {EnvironmentTracker, XRPlane, XRPlaneSet, XRMesh, XRMeshSet, roomSurfaces} from '../src/polyfill/api/environment';
import {interfaceBrands} from '../src/polyfill/api/interface-brand';
import type {XRSession} from '../src/polyfill/api/runtime';
import type {XRFrame} from '../src/polyfill/api/runtime';
import {XRCPUDepthInformation} from '../src/polyfill/api/sensing';
import {XRView, XRRigidTransform, geometryAllocation} from '../src/polyfill/api/geometry';

// Node lacks the browser's immutable geometry point. Browser conformance tests
// exercise the real DOMPointReadOnly and public XRFrame interfaces as well.
Object.defineProperty(globalThis, 'DOMPointReadOnly', {value: class {
  constructor(readonly x = 0, readonly y = 0, readonly z = 0, readonly w = 1) { Object.freeze(this); }
}});

// Mesh tracking accepts the same allocation brand as real runtime sessions.
function fixtureSession(fields: object): XRSession {
  return Object.assign(new interfaceBrands.SessionObject(), fields) as XRSession;
}

test('room patches preserve world geometry, identity, updates and removal', () => {
  const room = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const floor = new Mesh(geometry, new MeshBasicMaterial()); room.add(floor);
  const sky = floor.clone(); sky.name = 'sky'; room.add(sky);
  const device = {arScene: {room: room as Group | null}};
  const session = fixtureSession({_device: device, enabledFeatures: ['plane-detection', 'mesh-detection'], ended: false});
  const tracker = new EnvironmentTracker(session);
  tracker.update(10);
  const first = tracker.snapshot(), plane = [...first.planes][0], mesh = [...first.meshes][0];
  assert.equal(first.planes.size, 1, 'one rectangular floor; no decorative sky');
  assert.equal(first.meshes.size, 2);
  assert.equal(plane.orientation, 'horizontal');
  assert.equal(plane.lastChangedTime, 10);
  assert.deepEqual([...mesh.indices], [0, 1, 2]);
  const meshWorld=mesh.meshSpace._update()!;
  const meshPoints=[0,3,6].map(i=>vec3.transformMat4(vec3.create(),mesh.vertices.slice(i,i+3),meshWorld));
  for(const expected of [[-2,0,-2],[2,0,2],[2,0,-2]])assert(meshPoints.some(p=>vec3.distance(p,expected)<1e-5),'mesh reconstructs original source triangle');
  assert(Object.isFrozen(plane.polygon));
  assert(!('add' in first.planes));
  assert.deepEqual([...first.planes.entries()].map(([key, value]) => key === value), [true]);
  let iterations = 0;
  first.planes.forEach((value, key, set) => { assert.equal(value, key); assert.equal(set, first.planes); iterations++; });
  assert.equal(iterations, 1);
  // Reconstruct the known world-space fixture, independently of its local axes.
  const world = plane.planeSpace._update()!;
  const points = plane.polygon.map(p => vec3.transformMat4(vec3.create(), [p.x, p.y, p.z], world));
  for (const expected of [[-2, 0, -2], [-2, 0, 2], [2, 0, 2], [2, 0, -2]]) assert(points.some(p => vec3.distance(p, expected) < 1e-5));
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
  assert.equal(first.planes.size, 1, 'old frame membership is a snapshot');
  device.arScene.room = room; tracker.update(60);
  assert(!tracker.snapshot().planes.has(plane), 'reacquired surfaces have fresh identity');
  const current = [...tracker.snapshot().planes][0]; tracker.clear();
  assert.equal(current.planeSpace._update(), null);
  assert.equal(tracker.snapshot().planes.size, 0);
});

test('small cumulative shape changes eventually publish new polygon metadata',()=>{
  const room=new Group(),floor=rectangle(-2,-2,2,2);room.add(floor);
  const session=fixtureSession({_device:{arScene:{room}},enabledFeatures:['plane-detection'],ended:false});
  const tracker=new EnvironmentTracker(session);tracker.update(1);const plane=[...tracker.snapshot().planes][0],polygon=plane.polygon;
  for(let i=1;i<=30;i++){floor.scale.x=1+i*1e-6;tracker.update(i+1);}
  assert(plane.lastChangedTime>1 && plane.polygon!==polygon,'accumulated geometry changes cannot disappear below per-frame tolerance');
});

test('non-indexed, sloped and degenerate geometry; feature independence', () => {
  const room = new Group(); const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  room.add(new Mesh(geometry));
  const session = fixtureSession({_device: {arScene: {room}}, enabledFeatures: ['mesh-detection'], ended: false});
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
    const view = new XRView(frame, 'none', new XRRigidTransform(), new Float32Array(projection), mat4.create(), 0, geometryAllocation);
    const exported = view.projectionMatrix;
    exported.fill(99); structuredClone(exported.buffer, {transfer: [exported.buffer]});
    let info = new XRCPUDepthInformation(frame, view);
    assert.deepEqual(Array.from(info.projectionMatrix), Array.from(projection));
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

const fixtureMeasurements: unknown[]=[];

// The expected boundary and area are supplied by fixtures, independently of the
// extraction code. Proxy corners follow pinned XRPlanes' BoxGeometry formula.
function measure(room: Group) {
  const session = fixtureSession({_device: {arScene: {room}}, enabledFeatures: ['plane-detection'], ended: false});
  const tracker = new EnvironmentTracker(session); tracker.update(1);
  return [...tracker.snapshot().planes].map(plane => {
    const polygon = plane.polygon;
    const xs=polygon.map(p=>p.x), zs=polygon.map(p=>p.z);
    const width=Math.max(...xs)-Math.min(...xs), height=Math.max(...zs)-Math.min(...zs);
    const world=plane.planeSpace._update()!;
    const transform=(x:number,z:number)=>Array.from(vec3.transformMat4(vec3.create(),[x,0,z],world));
    let twiceArea=0;
    polygon.forEach((p,i)=>{const q=polygon[(i+1)%polygon.length]; twiceArea+=p.x*q.z-q.x*p.z; assert.equal(p.y,0); assert([p.x,p.z,p.w].every(Number.isFinite));});
    return {plane,world,boundary:polygon.map(p=>transform(p.x,p.z)),proxy:[transform(-width/2,-height/2),transform(width/2,-height/2),transform(width/2,height/2),transform(-width/2,height/2)],area:Math.abs(twiceArea)/2,proxyArea:width*height,
      displacement:Math.hypot((Math.max(...xs)+Math.min(...xs))/2,(Math.max(...zs)+Math.min(...zs))/2)};
  });
}
function rectangle(x0:number,z0:number,x1:number,z1:number) {
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([x0,0,z0,x1,0,z0,x1,0,z1,x0,0,z1],3));
  geometry.setIndex([0,2,1,0,3,2]); return new Mesh(geometry);
}
for (const [name, rotation, orientation] of [
  ['rectangle',[0,0,0],'horizontal'], ['rotated rectangle',[0,0.63,0],'horizontal'],
  ['sloped rectangle',[0.42,0.63,0.13],null], ['vertical rectangle',[Math.PI/2,0,0],'vertical'],
] as const) test(name+' polygon and pinned rectangular proxy agree within 1e-4 m',()=>{
  const room=new Group(), mesh=rectangle(-3,-1,3,1); room.add(mesh);
  room.position.set(2,3,-4); room.rotation.set(rotation[0],rotation[1],rotation[2]); room.updateWorldMatrix(true,true);
  const expected=[[-3,0,-1],[3,0,-1],[3,0,1],[-3,0,1]].map(p=>new Vector3(...p).applyMatrix4(mesh.matrixWorld));
  const results=measure(room); assert.equal(results.length,1);
  const result=results[0];
  assert.equal(result.plane.orientation,orientation);
  for(const points of [result.boundary,result.proxy]) for(const p of expected) assert(points.some(q=>p.distanceTo(new Vector3(...q))<1e-4));
  assert(Math.abs(result.area-12)<1e-4); assert(Math.abs(result.proxyArea-12)<1e-4); assert(result.displacement<1e-10);
  const normal=new Vector3(0,1,0).transformDirection(mesh.matrixWorld);
  const normalError=normal.distanceTo(new Vector3(result.world[4],result.world[5],result.world[6]));assert(normalError<1e-5);
  const error=(points:number[][])=>Math.max(...expected.map(p=>Math.min(...points.map(q=>p.distanceTo(new Vector3(...q))))));
  fixtureMeasurements.push({name,polygonBoundaryErrorMetres:error(result.boundary),proxyBoundaryErrorMetres:error(result.proxy),area:result.area,proxyArea:result.proxyArea,displacementMetres:result.displacement,normalError,orientation});
});

test('disconnected and opening regions have no gap fill or overlapping proxies',()=>{
  for(const opening of [false,true]) {
    const room=new Group();
    const parts=opening ? [[-3,-3,-1,3],[1,-3,3,3],[-1,1,1,3]] : [[-3,-1,-1,1],[1,-1,3,1]];
    // Put all triangles in ONE mesh: mesh boundaries cannot hide a bad merge.
    const positions:number[]=[], indices:number[]=[];
    for(const part of parts) {const mesh=rectangle(...part as [number,number,number,number]); const start=positions.length/3; positions.push(...mesh.geometry.getAttribute('position').array); indices.push(...Array.from(mesh.geometry.index!.array,n=>n+start));}
    const geometry=new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute(positions,3)); geometry.setIndex(indices); room.add(new Mesh(geometry));
    const results=measure(room); assert.equal(results.length,parts.length);
    const expectedArea=parts.reduce((n,[x0,z0,x1,z1])=>n+(x1-x0)*(z1-z0),0);
    assert(Math.abs(results.reduce((n,r)=>n+r.area,0)-expectedArea)<1e-5);
    assert(Math.abs(results.reduce((n,r)=>n+r.proxyArea,0)-expectedArea)<1e-5);
    for(let i=0;i<results.length;i++) for(let j=i+1;j<results.length;j++) {
      const bounds=(r:typeof results[number])=>[Math.min(...r.proxy.map(p=>p[0])),Math.min(...r.proxy.map(p=>p[2])),Math.max(...r.proxy.map(p=>p[0])),Math.max(...r.proxy.map(p=>p[2]))];
      const a=bounds(results[i]),b=bounds(results[j]);
      assert.equal(Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])),0);
    }
  }
});

test('connected coplanar hole survives internal-edge cancellation',()=>{
  const positions:number[]=[],indices:number[]=[];
  for(let x=0;x<3;x++)for(let z=0;z<3;z++) {
    if(x===1 && z===1)continue;
    const mesh=rectangle(-3+x*2,-3+z*2,-1+x*2,-1+z*2),start=positions.length/3;
    positions.push(...mesh.geometry.getAttribute('position').array);indices.push(...Array.from(mesh.geometry.index!.array,n=>n+start));
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  const room=new Group();room.add(new Mesh(geometry));const results=measure(room);
  assert.equal(results.length,4);assert.equal(results.reduce((n,r)=>n+r.area,0),32);assert.equal(results.reduce((n,r)=>n+r.proxyArea,0),32);
  for(const r of results) {
    const footprint=r.proxy.map(p=>[p[0],p[2]]);
    assert(intersectArea(footprint,[[-1,-1],[1,-1],[1,1],[-1,1]])<1e-8,'no proxy fills the opening');
  }
  fixtureMeasurements.push({name:'connected hole',triangles:16,planes:results.length,knownArea:32,polygonArea:32,proxyArea:32,holeExcess:0});
});

test('plane interfaces are nonconstructible, branded readonly setlikes',()=>{
  const room=new Group();room.add(rectangle(-1,-1,1,1));
  const session=fixtureSession({_device:{arScene:{room}},enabledFeatures:['plane-detection'],ended:false});
  const tracker=new EnvironmentTracker(session);tracker.update(1);const set=tracker.snapshot().planes, plane=[...set][0];
  assert.throws(()=>new XRPlane(session),TypeError);assert.throws(()=>new XRPlaneSet([]),TypeError);
  assert.equal(XRPlane.length,0);assert.equal(XRPlaneSet.length,0);assert.equal(set.forEach.length,1);
  assert.equal(set.keys,set.values);assert.equal(set.values,set[Symbol.iterator]);
  assert.equal(Object.prototype.toString.call(set.values()),'[object Set Iterator]');assert.equal(Object.prototype.toString.call(set.entries()),'[object Set Iterator]');
  for(const name of ['planeSpace','polygon','orientation','lastChangedTime','semanticLabel']) {
    const descriptor=Object.getOwnPropertyDescriptor(XRPlane.prototype,name)!;
    assert(descriptor.get && !descriptor.set && descriptor.enumerable && descriptor.configurable);
    for(const bad of [null,{},XRPlane.prototype,Object.create(XRPlane.prototype),new Proxy(plane,{})]) assert.throws(()=>descriptor.get!.call(bad),TypeError);
  }
  for(const bad of [null,{},XRPlaneSet.prototype,Object.create(XRPlaneSet.prototype),new Proxy(set,{})]) {
    for(const method of ['has','keys','values','entries','forEach'] as const) assert.throws(()=>Reflect.apply(XRPlaneSet.prototype[method],bad,[plane]),TypeError);
    assert.throws(()=>Object.getOwnPropertyDescriptor(XRPlaneSet.prototype,'size')!.get!.call(bad),TypeError);
  }
  for(const bad of [undefined,null,{},Object.create(XRPlane.prototype),new Proxy(plane,{})]) assert.throws(()=>set.has(bad as XRPlane),TypeError);
  tracker.clear(); const empty=tracker.snapshot().planes;
  for(const value of [undefined,null,42,{}]) assert.throws(()=>empty.forEach(value as never),TypeError);
  tracker.update(2); assert.equal(tracker.snapshot().planes.has(plane),false);
});

// Independent convex clipping in the measured plane's coordinates. Compare
// polygons and exact pinned box footprints against the original GLB triangles.
function intersectArea(subject:number[][], clip:number[][]) {
  const signed=clip.reduce((sum,p,i)=>{const q=clip[(i+1)%clip.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  const side=(a:number[],b:number[],p:number[])=>Math.sign(signed)*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  let polygon=subject;
  for(let i=0;i<clip.length;i++) {
    const a=clip[i],b=clip[(i+1)%clip.length],output:number[][]=[];
    for(let j=0;j<polygon.length;j++) {
      const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=side(a,b,p),dq=side(a,b,q);
      if(dp>=-1e-9)output.push(p);
      if((dp>=0)!==(dq>=0))output.push([p[0]+(q[0]-p[0])*dp/(dp-dq),p[1]+(q[1]-p[1])*dp/(dp-dq)]);
    }
    polygon=output;
  }
  return Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
}
test('packaged hall plane coverage and centered XRPlanes proxy measurements',async()=>{
  const buffer=await readFile(new URL('../assets/hall_empty.glb',import.meta.url));
  const loader=new GLTFLoader().register(()=>({name:'test_material',loadMaterial:async()=>new MeshBasicMaterial()}));
  const {scene}=await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
  const results=measure(scene);
  const triangles=roomSurfaces(scene);
  const area=(v:number[])=>new Vector3(v[3]-v[0],v[4]-v[1],v[5]-v[2]).cross(new Vector3(v[6]-v[0],v[7]-v[1],v[8]-v[2])).length()/2;
  const sourceArea=triangles.reduce((n,s)=>n+area(s.vertices),0);
  const triangleWorld=triangles.map(s=>[0,3,6].map(i=>vec3.transformMat4(vec3.create(),s.vertices.slice(i,i+3),s.matrix)));
  function project(points:ArrayLike<number>[],inverse:mat4) {return points.map(p=>Array.from(vec3.transformMat4(vec3.create(),p as vec3,inverse)));}
  let polygonCovered=0,proxyCovered=0,proxyOverlap=0,polygonOverlap=0;
  for(let i=0;i<results.length;i++) {
    const result=results[i],inverse=mat4.invert(mat4.create(),result.world)!;
    const polygon=result.plane.polygon.map(p=>[p.x,p.z]),proxy=project(result.proxy,inverse).map(p=>[p[0],p[2]]);
    for(const vertices of triangleWorld) {
      const local=project(vertices,inverse);
      if(local.some(p=>Math.abs(p[1])>1e-4))continue;
      const face=local.map(p=>[p[0],p[2]]);
      polygonCovered+=intersectArea(polygon,face);proxyCovered+=intersectArea(proxy,face);
    }
    for(let j=i+1;j<results.length;j++) {
      const local=project(results[j].boundary,inverse);
      if(local.some(p=>Math.abs(p[1])>1e-4))continue;
      polygonOverlap+=intersectArea(polygon,local.map(p=>[p[0],p[2]]));
      proxyOverlap+=intersectArea(proxy,project(results[j].proxy,inverse).map(p=>[p[0],p[2]]));
    }
  }

  const report={fixtures:fixtureMeasurements,triangles:triangles.length,planes:results.length,horizontal:results.filter(r=>r.plane.orientation==='horizontal').length,vertical:results.filter(r=>r.plane.orientation==='vertical').length,
    sourceArea,polygonCovered,proxyCovered,proxyOverlap,polygonOverlap,polygonArea:results.reduce((n,r)=>n+r.area,0),proxyArea:results.reduce((n,r)=>n+r.proxyArea,0),maxDisplacement:Math.max(...results.map(r=>r.displacement)),
    regions:results.map(r=>({orientation:r.plane.orientation,vertices:r.plane.polygon.length,area:r.area,proxyArea:r.proxyArea,world:r.world,boundary:r.boundary,proxy:r.proxy}))};
  assert(report.horizontal>0 && report.vertical>0);assert(results.length<triangles.length);
  assert(Math.abs(report.polygonArea-sourceArea)<1e-3,'partition preserves total room area');
  assert(report.maxDisplacement<1e-10);
  assert(Math.abs(polygonCovered-sourceArea)<1e-3,'known room triangles covered by exact polygons');
  assert(polygonOverlap<1e-3,'no coplanar polygon overlap');
  assert(Math.abs(proxyCovered-sourceArea)<1e-3,'box footprints cover all sensed polygons');
  await mkdir('test-results',{recursive:true});await writeFile('test-results/plane-room.json',JSON.stringify(report,null,2));
  console.log('hall measurements',JSON.stringify({...report,regions:undefined}));
});

test('hit testing filters independently classified plane and mesh fixtures', async () => {
  const {intersectHitTestGeometry} = await import('../src/polyfill/api/hit-test-geometry');
  // Independently authored, spatially separate native representations. They
  // deliberately do not derive one type by relabeling hits of the other.
  const surface = (z: number) => ({key: String(z), orientation: 'vertical' as const,
    matrix: new Float32Array([1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,z,1]),
    vertices: [-1,0,-1, 1,0,-1, 1,0,1, -1,0,1]});
  const geometry = {planes: [surface(-2)], meshes: [surface(-1), surface(-3)]};
  const cast = (types: string[], origin = [0,0,0]) => intersectHitTestGeometry(origin, [0,0,-1], geometry, types);
  assert.deepEqual(cast(['plane']).map(h => [h.entityType, h.distance]), [['plane',2]]);
  assert.deepEqual(cast(['mesh']).map(h => [h.entityType, h.distance]), [['mesh',1],['mesh',3]]);
  assert.deepEqual(cast(['point','mesh','plane']).map(h => [h.entityType,h.distance]), [['mesh',1],['plane',2],['mesh',3]]);
  assert.deepEqual(cast([]), []); assert.deepEqual(cast(['point']), []);
  assert.deepEqual(cast(['plane','mesh'], [4,0,0]), []);
  assert.deepEqual(cast(['plane','mesh'], [Infinity,0,0]), []);
  for (const hit of cast(['plane','mesh'])) assert.deepEqual(hit.normal.toArray(), [0,0,1]);
  geometry.meshes.push(surface(-2));
  assert.equal(cast(['plane','mesh']).filter(h => h.distance === 2).length, 2, 'coincident representations retain genuine classification');
});


test('unchanged mesh geometry at Float32 precision retains its publication timestamp', () => {
  const room = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 512, 0, 0, 0, 0, 512], 3));
  room.add(new Mesh(geometry));
  const session = fixtureSession({_device: {arScene: {room}}, enabledFeatures: ['mesh-detection'], ended: false});
  const tracker = new EnvironmentTracker(session);
  tracker.update(1);
  const mesh = [...tracker.snapshot().meshes][0];
  const vertices = mesh.vertices, indices = mesh.indices;
  assert(roomSurfaces(room)[0].vertices.some((value, i) => Math.abs(value - vertices[i]) > 1e-5),
    'fixture exercises rounding greater than the publication tolerance');
  for (let time = 2; time <= 10; time++) {
    tracker.update(time);
    assert.deepEqual(mesh.vertices, vertices);
    assert.deepEqual(mesh.indices, indices);
    assert.equal(mesh.lastChangedTime, 1, 'identical Float32 geometry must not notify a shape change');
  }
});

test('mesh publication retains the published baseline and isolates writable arrays', () => {
  const room=new Group(),floor=rectangle(-2,-2,2,2);room.add(floor);
  const session=fixtureSession({_device:{arScene:{room}},enabledFeatures:['mesh-detection'],ended:false});
  const tracker=new EnvironmentTracker(session),peer=new EnvironmentTracker(fixtureSession({...session}));tracker.update(1);peer.update(1);
  const first=tracker.snapshot(),mesh=[...first.meshes][0],space=mesh.meshSpace,initial=mesh.vertices,indices=mesh.indices;
  for(const field of ['space','matrix','signature','changed','verticesValue','indicesValue','_update','_remove']) assert(!Object.prototype.hasOwnProperty.call(mesh,field));
  const record=interfaceBrands.meshAllocations.meshes.get(mesh)!;
  assert(Object.isFrozen(record));assert(Object.isFrozen(interfaceBrands.meshAllocations.meshes));
  assert(!('set' in interfaceBrands.meshAllocations.meshes));assert(!('set' in interfaceBrands.meshAllocations.sets));
  assert.equal(Reflect.set(record,'changed',()=>99),false); // frozen reader rejects replacement
  const expected=initial.slice();initial.fill(999);indices.fill(999);
  structuredClone(initial.buffer,{transfer:[initial.buffer]});
  tracker.update(2);assert.equal(mesh.lastChangedTime,1);assert.deepEqual(mesh.vertices,expected);assert.deepEqual([...mesh.indices],[0,1,2]);
  assert.deepEqual([...peer.snapshot().meshes][0].vertices,expected,'another tracker/session has independent storage');
  room.position.set(2,3,4);room.rotation.set(Math.PI/2,0.4,0.2);tracker.update(3);
  assert.equal(mesh.lastChangedTime,1,'pitch crossing orientation classifications is pose-only');
  assert.deepEqual(mesh.vertices,expected);assert.equal(mesh.meshSpace,space);
  floor.scale.x=1+1e-6;tracker.update(4);
  assert.equal(mesh.lastChangedTime,1);assert.deepEqual(mesh.vertices,expected,'subthreshold geometry is not silently published');
  for(let i=2;i<=30;i++){floor.scale.x=1+i*1e-6;tracker.update(i+4);}
  assert(mesh.lastChangedTime>4);assert.notDeepEqual(mesh.vertices,expected,'cumulative deformation eventually publishes');
  const changed=mesh.lastChangedTime;tracker.update(99);assert.equal(mesh.lastChangedTime,changed);
  const sourceBefore=roomSurfaces(room).map(s=>s.vertices);mesh.vertices.fill(NaN);mesh.indices.fill(42);
  assert.deepEqual(roomSurfaces(room).map(s=>s.vertices),sourceBefore,'public arrays cannot corrupt room sensing');
  floor.geometry.setIndex([0,3,1]);tracker.update(100);
  assert.equal(tracker.snapshot().meshes.size,1,'topology removal retires a partition');
  assert(tracker.snapshot().meshes.has(mesh));assert.equal(mesh.lastChangedTime,100,'changed source connectivity publishes shape and timestamp');
  assert.equal(first.meshes.size,2,'prior membership snapshot retained');
  tracker.clear();assert.equal(space._update(),null);
  tracker.update(101);assert(!tracker.snapshot().meshes.has(mesh),'reacquisition has fresh identity');
});

test('mesh interfaces provide branded readonly setlike descriptors and conversion',()=>{
  const room=new Group();room.add(rectangle(-2,-2,2,2));
  const session=fixtureSession({_device:{arScene:{room}},enabledFeatures:['mesh-detection'],ended:false});
  const tracker=new EnvironmentTracker(session);tracker.update(1);const set=tracker.snapshot().meshes,mesh=[...set][0];
  assert.throws(()=>new XRMesh(session),TypeError);assert.throws(()=>new XRMeshSet([]),TypeError);
  const registry=interfaceBrands.meshAllocations;
  let reads=0, iterations=0;
  const shape=()=>{reads++;return {vertices:new Float32Array([1,2,3]),indices:new Uint32Array([0]),changed:42};};
  const values={*[Symbol.iterator](){iterations++;yield mesh;}};
  for(const [C,args,Interface] of [
    [Object.getPrototypeOf(XRMesh),[{},shape],XRMesh],
    [Object.getPrototypeOf(XRMeshSet),[values],XRMeshSet],
    [XRMesh,[mesh.meshSpace,shape],XRMesh],
    [XRMeshSet,[[]],XRMeshSet],
  ] as const) {
    for(const token of [undefined,Symbol('mesh allocation'),registry]) {
      const input=[...args,token];
      assert.throws(()=>Reflect.construct(C,input),TypeError);
      assert.throws(()=>Reflect.construct(C,input,Interface),TypeError);
      assert.throws(()=>Reflect.construct(C,input,class extends Interface {}),TypeError);
    }
  }
  assert.equal(reads,0,'unauthorized allocation never retains or reads caller state');
  assert.equal(iterations,0,'unauthorized set allocation rejects before iterating');
  assert.throws(()=>new registry.MeshTracker({} as XRSession, XRMesh.prototype, XRMeshSet.prototype),TypeError);
  assert.equal(XRMesh.length,0);assert.equal(XRMeshSet.length,0);assert.equal(set.forEach.length,1);
  assert.equal(set.keys,set.values);assert.equal(set.values,set[Symbol.iterator]);
  assert.equal(Object.prototype.toString.call(set.values()),'[object Set Iterator]');assert.equal(Object.prototype.toString.call(set.entries()),'[object Set Iterator]');
  assert.equal(Object.prototype.toString.call(mesh),'[object XRMesh]');assert.equal(Object.prototype.toString.call(set),'[object XRMeshSet]');
  for(const name of ['meshSpace','vertices','indices','lastChangedTime','semanticLabel']) {
    const d=Object.getOwnPropertyDescriptor(XRMesh.prototype,name)!;assert(d.get && !d.set && d.enumerable && d.configurable);assert(!Object.prototype.hasOwnProperty.call(mesh,name));
    for(const bad of [null,{},XRMesh.prototype,Object.create(XRMesh.prototype),new Proxy(mesh,{})])assert.throws(()=>d.get!.call(bad),TypeError);
  }
  for(const bad of [null,{},XRMeshSet.prototype,Object.create(XRMeshSet.prototype),new Proxy(set,{})]) {
    for(const method of ['has','keys','values','entries','forEach'] as const)assert.throws(()=>Reflect.apply(XRMeshSet.prototype[method],bad,[mesh]),TypeError);
    assert.throws(()=>Object.getOwnPropertyDescriptor(XRMeshSet.prototype,'size')!.get!.call(bad),TypeError);
  }
  for(const bad of [undefined,null,{},Object.create(XRMesh.prototype),new Proxy(mesh,{})])assert.throws(()=>set.has(bad as XRMesh),TypeError);
  const order=[...set],receiver={};let count=0;
  set.forEach(function(this:unknown,value,key,collection){assert.equal(this,receiver);assert.equal(value,order[count++]);assert.equal(key,value);assert.equal(collection,set);},receiver);
  assert.equal(count,order.length);assert.deepEqual([...set.entries()],order.map(m=>[m,m]));
  const error={};assert.throws(()=>set.forEach(()=>{throw error;}),e=>e===error);
  for(const name of ['add','delete','clear'])assert(!(name in set));
  tracker.clear();const empty=tracker.snapshot().meshes;
  for(const callback of [undefined,null,42,{}])assert.throws(()=>empty.forEach(callback as never),TypeError);
  assert.equal(empty.has(mesh),false);
  const meshBase=Object.getPrototypeOf(XRMesh),setBase=Object.getPrototypeOf(XRMeshSet);
  let intercepted=0;
  try {
    Object.setPrototypeOf(XRMesh,function(){intercepted++;});
    Object.setPrototypeOf(XRMeshSet,function(){intercepted++;});
    tracker.update(2);
    const fresh=tracker.snapshot().meshes;
    assert.equal(fresh.size,2);assert(fresh.has([...fresh][0]));
    assert.equal(intercepted,0,'internal allocation never invokes mutable public superclass chains');
  } finally {Object.setPrototypeOf(XRMesh,meshBase);Object.setPrototypeOf(XRMeshSet,setBase);}
});

// Reconstruct independently from source buffers and published indices; never
// use roomSurfaces to generate expected points, normals, areas or coverage.
function measureMeshes(room: Group) {
  room.updateWorldMatrix(true,true);
  const source:Vector3[][]=[];let degenerate=0;
  room.traverse(object=>{
    if(!(object instanceof Mesh)||object.name==='sky')return;
    const p=object.geometry.getAttribute('position'),index=object.geometry.index;
    for(let i=0;i+2<(index?.count??p.count);i+=3){
      const points=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld));
      if(points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).lengthSq()<1e-12){degenerate++;continue;}source.push(points);
    }
  });
  const session=fixtureSession({_device:{arScene:{room}},enabledFeatures:['mesh-detection'],ended:false});
  const tracker=new EnvironmentTracker(session);tracker.update(1);const meshes=[...tracker.snapshot().meshes];
  assert.equal(meshes.length,source.length);
  let maxError=0,maxNormalError=0,area=0,sourceArea=0;
  for(let n=0;n<meshes.length;n++){
    const mesh=meshes[n],v=mesh.vertices,index=mesh.indices,m=mesh.meshSpace._update()!;
    assert(v.every(Number.isFinite));assert(index.every(i=>Number.isInteger(i)&&i>=0&&i<v.length/3));assert.equal(index.length,3);
    const actual=Array.from(index,i=>new Vector3(v[i*3],v[i*3+1],v[i*3+2]).applyMatrix4({elements:Array.from(m)} as any));
    maxError=Math.max(maxError,...actual.map((p,i)=>p.distanceTo(source[n][i])));
    const cross=(p:Vector3[])=>p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
    const expectedCross=cross(source[n]);sourceArea+=expectedCross.length()/2;area+=cross(actual).length()/2;
    maxNormalError=Math.max(maxNormalError,new Vector3(m[4],m[5],m[6]).distanceTo(expectedCross.normalize()));
  }
  assert(maxError<1e-4);assert(maxNormalError<1e-5);assert(Math.abs(area-sourceArea)<1e-3);
  return {triangles:meshes.length,degenerate,sourceArea,publishedArea:area,coverage:area/sourceArea,maxErrorMetres:maxError,maxNormalError};
}

test('indexed and nonindexed rectangular/sloped/degenerate meshes reconstruct source geometry',()=>{
  for(const indexed of [true,false])for(const slope of [0,0.6]) {
    const room=new Group(),floor=rectangle(-3,-1,3,1);floor.rotation.set(slope,0.7,0.2);floor.position.set(2,1,-3);
    if(!indexed)floor.geometry=floor.geometry.toNonIndexed();room.add(floor);
    const bad=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));room.add(new Mesh(bad));
    const result=measureMeshes(room);assert.equal(result.triangles,2);assert.equal(result.degenerate,1);
  }
});

test('packaged hall mesh coverage independently matches source triangles',async()=>{
  const buffer=await readFile(new URL('../assets/hall_empty.glb',import.meta.url));
  const loader=new GLTFLoader().register(()=>({name:'test_material',loadMaterial:async()=>new MeshBasicMaterial()}));
  const {scene}=await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
  const report=measureMeshes(scene);await mkdir('test-results',{recursive:true});await writeFile('test-results/mesh-room.json',JSON.stringify(report,null,2));
  console.log('independent mesh coverage',JSON.stringify(report));
});
