import {Matrix4, Mesh, Vector3} from 'three';
import type {Surface} from './environment';

const epsilon = 1e-5;
interface Region {ids: number[]; points: Vector3[]; normal: Vector3; area: number; axis?: Vector3}
const canonical = (e: Vector3) => { const first=e.toArray().find(v=>Math.abs(v)>epsilon) ?? 1; return first<0 ? e.negate() : e; };
const edgeKey = (a: Vector3,b: Vector3) => [a,b].map(p=>p.toArray().map(v=>Math.round(v/epsilon)).join(',')).sort().join(':');

/** Decompose edge-connected coplanar triangles into convex vertical strips.
 * Cancel internal edges first: triangulation never becomes overlapping boxes.
 * Slice the actual boundary, including holes, at its vertex coordinates; even/
 * odd crossings preserve disconnected regions and openings. Most authored hall
 * strips are rectangles; oblique boundaries remain exact trapezoids/triangles.
 * All decisions use mesh coordinates, so rigid motion cannot rotate the axes.
 * The number of strips is bounded by boundary vertices times boundary edges. */
export function planeRegions(mesh: Mesh): Surface[] {
  const attribute = mesh.geometry.getAttribute('position');
  if (!attribute) return [];
  const indices = mesh.geometry.index, triangles: Region[] = [];
  for (let i = 0; i + 2 < (indices?.count ?? attribute.count); i += 3) {
    const points = [0,1,2].map(j => new Vector3().fromBufferAttribute(attribute, indices ? indices.getX(i+j) : i+j));
    if (!points.every(p => p.toArray().every(Number.isFinite))) continue;
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    const area = normal.length()/2;
    if (area < 1e-10) continue;
    triangles.push({ids: [i], points, normal: normal.normalize(), area});
  }
  const groups: Region[][] = [];
  const pending = new Set(triangles);
  for (const seed of triangles) {
    if (!pending.delete(seed)) continue;
    const group=[seed], edges=new Set<string>();
    const addEdges=(r:Region)=>r.points.forEach((p,i)=>edges.add(edgeKey(p,r.points[(i+1)%3])));
    addEdges(seed);
    for(let changed=true;changed;) {
      changed=false;
      for(const candidate of pending) {
        if(seed.normal.dot(candidate.normal)<1-1e-8 || candidate.points.some(p=>Math.abs(p.clone().sub(seed.points[0]).dot(seed.normal))>epsilon)) continue;
        if(!candidate.points.some((p,i)=>edges.has(edgeKey(p,candidate.points[(i+1)%3])))) continue;
        pending.delete(candidate);group.push(candidate);addEdges(candidate);changed=true;
      }
    }
    groups.push(group);
  }
  const regions: Region[]=[];
  for(const group of groups) {
    const edges=new Map<string,{a:Vector3;b:Vector3;count:number}>();
    for(const triangle of group) triangle.points.forEach((p,i)=>{
      const q=triangle.points[(i+1)%3], key=edgeKey(p,q), edge=edges.get(key);
      if(edge) edge.count++; else edges.set(key,{a:p,b:q,count:1});
    });
    const boundary=[...edges.values()].filter(e=>e.count===1);
    const directions=boundary.map(e=>canonical(e.b.clone().sub(e.a)));
    directions.sort((a,b)=>Math.abs(b.lengthSq()-a.lengthSq())>epsilon ? b.lengthSq()-a.lengthSq() : b.x-a.x || b.y-a.y || b.z-a.z);
    if(!directions.length) continue;
    const x=directions[0].normalize(), normal=group[0].normal, z=x.clone().cross(normal);
    const projected=boundary.map(e=>({a:[e.a.dot(x),e.a.dot(z)],b:[e.b.dot(x),e.b.dot(z)]}));
    const coordinates=projected.flatMap(e=>[e.a[0],e.b[0]]).sort((a,b)=>a-b);
    const cuts=coordinates.filter((v,i)=>!i || v-coordinates[i-1]>epsilon);
    const distance=group[0].points[0].dot(normal);
    const point=(u:number,v:number)=>x.clone().multiplyScalar(u).addScaledVector(z,v).addScaledVector(normal,distance);
    const at=(e:typeof projected[number],u:number)=>e.a[1]+(e.b[1]-e.a[1])*(u-e.a[0])/(e.b[0]-e.a[0]);
    let part=0;
    for(let i=0;i+1<cuts.length;i++) {
      const left=cuts[i], right=cuts[i+1], mid=(left+right)/2;
      const hits=projected.filter(e=>mid>Math.min(e.a[0],e.b[0]) && mid<Math.max(e.a[0],e.b[0])).sort((a,b)=>at(a,mid)-at(b,mid));
      for(let j=0;j+1<hits.length;j+=2) {
        const a=hits[j],b=hits[j+1];
        const points=[point(left,at(a,left)),point(right,at(a,right)),point(right,at(b,right)),point(left,at(b,left))];
        const unique=points.filter((p,k)=>p.distanceTo(points[(k+1)%4])>epsilon);
        if(unique.length<3) continue;
        regions.push({ids:[group[0].ids[0],part++],points:unique,normal,area:0,axis:x});
      }
    }
  }
  return regions.map(region => {
    // Keep the strip axis even for triangular ends; a diagonal axis would
    // enlarge the pinned consumer's rectangle and overlap neighboring strips.
    const axis = region.axis!;
    const origin = region.points[0].clone().applyMatrix4(mesh.matrixWorld);
    const x = region.points[0].clone().add(axis).applyMatrix4(mesh.matrixWorld).sub(origin).normalize();
    const normalMatrix = new Matrix4().copy(mesh.matrixWorld).invert().transpose();
    const y = region.normal.clone().transformDirection(normalMatrix);
    const z = x.clone().cross(y).normalize();
    const points = region.points.map(p=>p.clone().applyMatrix4(mesh.matrixWorld).sub(origin));
    const xs=points.map(p=>p.dot(x)), zs=points.map(p=>p.dot(z));
    const cx=(Math.min(...xs)+Math.max(...xs))/2, cz=(Math.min(...zs)+Math.max(...zs))/2;
    const center = origin.addScaledVector(x,cx).addScaledVector(z,cz);
    return {key: `${mesh.uuid}:${region.ids.join(',')}`, matrix: new Float32Array(new Matrix4().makeBasis(x,y,z).setPosition(center).elements),
      vertices: points.flatMap((p,i)=>[xs[i]-cx,0,zs[i]-cz]),
      orientation: Math.abs(y.y)>0.999 ? 'horizontal' : Math.abs(y.y)<0.001 ? 'vertical' : null};
  });
}
