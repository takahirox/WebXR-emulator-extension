import type {SessionMode} from '../src/types/contracts';

/** Mesh Detection 5397685 and WebIDL 622910c assertions through genuine
 * separately injected realms, actual frames, room and extension panel. */
export async function meshCases(mode: SessionMode) {
  const w=window as any, passed:string[]=[], measurements:any[]=[];
  function check(value:unknown,label:string) {if(!value) throw new Error(`${mode}: ${label}`);passed.push(label);}
  function throws(fn:()=>unknown,name:string,label:string) {let error:any;try{fn();}catch(e){error=e;}check(error?.name===name,label);}
  async function rejects(p:Promise<unknown>,name:string,label:string) {let error:any;try{await p;}catch(e){error=e;}check(error?.name===name,label);}
  function request(options:any) {return new Promise<any>((resolve,reject)=>{
    const b=document.createElement('button');b.id='reference-space-session';b.textContent='Start mesh contract';b.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick=()=>{b.remove();w.navigator.xr.requestSession(mode,options).then(resolve,reject);};document.body.append(b);
  });}
  const sessions:any[]=[], child=document.createElement('iframe'); child.src='/frame';
  const ready=new Promise<void>(resolve=>{child.onload=()=>resolve();});document.body.append(child);await ready;
  const other=child.contentWindow as any;
  const frame=(s:any,fn:(f:any,t:number)=>any)=>new Promise<any>((resolve,reject)=>s.requestAnimationFrame((t:number,f:any)=>{try{resolve(fn(f,t));}catch(e){reject(e);}}));
  async function layer(s:any,realm:any=w) {const c=realm.document.createElement('canvas'); const g=c.getContext('webgl2')!;await g.makeXRCompatible();const l=new realm.XRWebGLLayer(s,g);s.updateRenderState({baseLayer:l});return l;}
  let session:any,room:any;
  try {
    check(w.XRMesh!==other.XRMesh && w.XRMeshSet!==other.XRMeshSet,'realm-local mesh interface objects');
    for(const realm of [w,other]) for(const name of ['XRMesh','XRMeshSet']) {throws(()=>new realm[name](),'TypeError',`${name} illegal constructor`);check(realm[name].length===0,'nonconstructible interface length');}
    for(const realm of [w,other]) {
      const registry=w[Symbol.for('WebXR-emulator.interface-brands')].meshAllocations;
      let reads=0,iterations=0;
      const shape=()=>{reads++;return {vertices:new Float32Array([1,2,3]),indices:new Uint32Array([0]),changed:42};};
      const values={*[Symbol.iterator](){iterations++;yield {};}};
      for(const [C,args,Interface] of [
        [Object.getPrototypeOf(realm.XRMesh),[{},shape],realm.XRMesh],
        [Object.getPrototypeOf(realm.XRMeshSet),[values],realm.XRMeshSet],
        [realm.XRMesh,[{},shape],realm.XRMesh],
        [realm.XRMeshSet,[[]],realm.XRMeshSet],
      ]) for(const token of [undefined,Symbol('mesh allocation'),registry]) {
        const input=[...args,token];
        throws(()=>Reflect.construct(C,input),'TypeError','direct mesh allocation rejected');
        for(const Target of [Interface,class extends Interface {}])
          throws(()=>Reflect.construct(C,input,Target),'TypeError','reflective mesh allocation cannot acquire brand');
      }
      check(reads===0 && iterations===0,'unauthorized allocations reject before caller callbacks');
      throws(()=>new registry.MeshTracker({}),'TypeError','tracker requires session allocation brand');
    }
    if(mode!=='immersive-ar') {
      await rejects(request({requiredFeatures:['mesh-detection']}),'NotSupportedError','unsupported required mesh negotiation');
      session=await request({optionalFeatures:['mesh-detection']});sessions.push(session);await layer(session);
      check(!session.enabledFeatures.includes('mesh-detection'),'unsupported optional mesh omitted');
      await frame(session,f=>check(f.detectedMeshes.size===0,'unenabled active collection empty'));
      await session.end();
      return {mode,assertions:passed.length,passed,measurements};
    }
    session=await request({requiredFeatures:['mesh-detection','hit-test']});sessions.push(session);const l=await layer(session);
    const reference=await session.requestReferenceSpace('local'), offset=reference.getOffsetReferenceSpace(new w.XRRigidTransform({x:1,y:2,z:3}));
    await other.navigator.xr.requestSession('inline').then(async(s:any)=>{sessions.push(s);await layer(s,other);const empty=await frame(s,f=>f.detectedMeshes);
      check(Object.getPrototypeOf(empty)===other.XRMeshSet.prototype,'genuine other-realm set');
      for(const realm of [w,other]) {check(Object.getOwnPropertyDescriptor(realm.XRMeshSet.prototype,'size')!.get!.call(empty)===0,'borrowed cross-realm size');throws(()=>realm.XRMeshSet.prototype.forEach.call(empty,42),'TypeError','empty callback conversion');}
    });
    const deadline=Date.now()+20000;
    while(!session._device.arScene?.room) {if(Date.now()>deadline)throw new Error('room timeout');await new Promise(r=>setTimeout(r,30));}
    room=session._device.arScene.room;
    const hit=await session.requestHitTestSource({space:await session.requestReferenceSpace('viewer'),entityTypes:['mesh']});
    const first=await frame(session,(f,t)=>{
      const set=f.detectedMeshes,meshes=[...set],mesh=meshes[0];
      check(meshes.length>0,'populated room meshes');
      for(const realm of [w,other]) {
        const proto=realm.XRMeshSet.prototype;
        check(proto.keys===proto.values && proto.values===proto[Symbol.iterator],'setlike aliases');
        check(Object.prototype.toString.call(proto.values.call(set))==='[object Set Iterator]' && Object.prototype.toString.call(proto.entries.call(set))==='[object Set Iterator]','set iterator prototypes');
        check([...proto.values.call(set)].every((p,i)=>p===meshes[i]),'insertion order with borrowed values');
        check([...proto.entries.call(set)].every(([a,b],i)=>a===b && a===meshes[i]),'paired entries');
        let count=0;const receiver={};proto.forEach.call(set,function(this:unknown,p:any,k:any,s:any){check(this===receiver && p===k && s===set && p===meshes[count++],'callback receiver/arguments/order');},receiver);
        check(count===meshes.length,'all callbacks');
        const sentinel={};let caught;try{proto.forEach.call(set,()=>{throw sentinel;});}catch(error){caught=error;}check(caught===sentinel,'callback exceptions propagate unchanged');
        for(const name of ['has','values','keys','entries','forEach']){const d=Object.getOwnPropertyDescriptor(proto,name)!;check(d.enumerable && d.configurable && d.writable,'setlike method descriptors');}
        check(!('add' in set)&&!('delete' in set)&&!('clear' in set),'no collection mutators');
        for(const p of meshes) {
          for(const name of ['meshSpace','vertices','indices','lastChangedTime','semanticLabel']) {
            const d=Object.getOwnPropertyDescriptor(realm.XRMesh.prototype,name)!;
            check(!!d.get && !d.set && d.enumerable && d.configurable && !Object.prototype.hasOwnProperty.call(p,name),'readonly branded prototype getter');
            check(name==='vertices'||name==='indices'?Array.from(d.get!.call(p)).join()===Array.from(p[name]).join():d.get!.call(p)===p[name],'cross-realm borrowed mesh getter');
            for(const bad of [null,{},realm.XRMesh.prototype,Object.create(realm.XRMesh.prototype),new Proxy(p,{})]) throws(()=>d.get!.call(bad),'TypeError','forged/proxied mesh rejected');
          }
          check(p.vertices.length===9 && p.vertices.every(Number.isFinite) && p.indices.length===3 && p.indices.every((i:number)=>i>=0 && i<3),'finite indexed local metre triangles');
          check(Object.keys(p).length===0,'no public mutable tracking fields');
        }
        for(const bad of [null,{},realm.XRMeshSet.prototype,Object.create(proto),new Proxy(set,{})]) {
          throws(()=>Object.getOwnPropertyDescriptor(proto,'size')!.get!.call(bad),'TypeError','size receiver');
          for(const name of ['has','values','keys','entries','forEach']) throws(()=>proto[name].call(bad,mesh),'TypeError','setlike receiver');
        }
        for(const bad of [undefined,null,42,{},Object.create(realm.XRMesh.prototype),new Proxy(mesh,{})]) throws(()=>proto.has.call(set,bad),'TypeError','has interface conversion');
        throws(()=>proto.has.call(set),'TypeError','has requires argument');
        for(const bad of [undefined,null,42,{}]) throws(()=>proto.forEach.call(set,bad),'TypeError','callback conversion');
      }
      const pose=f.getPose(mesh.meshSpace,reference),shifted=f.getPose(mesh.meshSpace,offset);
      check([1,2,3].every((v,i)=>Math.abs(pose.transform.matrix[12+i]-shifted.transform.matrix[12+i]-v)<1e-4),'mesh offset poses');
      const hitPose=f.getHitTestResults(hit)[0]?.getPose(reference);
      check(!!hitPose,'actual room hit intersection');
      const point=hitPose.transform.position;
      const contains=meshes.some((p:any)=>{
        const inv=f.getPose(p.meshSpace,reference).transform.inverse.matrix;
        const q=[0,1,2].map(i=>inv[i]*point.x+inv[4+i]*point.y+inv[8+i]*point.z+inv[12+i]);
        if(Math.abs(q[1])>1e-4)return false;
        const v=p.vertices,idx=p.indices;
        const signs=Array.from(idx,(a:any,i:number)=>{const b=idx[(i+1)%idx.length];return (v[b*3]-v[a*3])*(q[2]-v[a*3+2])-(v[b*3+2]-v[a*3+2])*(q[0]-v[a*3]);});
        return signs.every((n:any)=>n>=-1e-4)||signs.every((n:any)=>n<=1e-4);
      });
      check(contains,'independent indexed triangle test contains mesh hit point');
      const registry=w[Symbol.for('WebXR-emulator.interface-brands')].meshAllocations;
      check(Object.isFrozen(registry) && Object.isFrozen(registry.meshes) && !registry.meshes.set && !registry.sets.set,'registry exposes frozen readers');
      check(Object.isFrozen(registry.meshes.get(mesh)) && Object.isFrozen(registry.sets.get(set)),'registry values cannot mutate tracking or membership');
      check(!Reflect.set(registry.meshes.get(mesh),'changed',()=>999),'registry record replacement rejected');
      const vertices=mesh.vertices,indices=mesh.indices;vertices.fill(999);indices.fill(999);
      check(mesh.vertices.every((v:number)=>v!==999) && mesh.indices.every((v:number)=>v!==999),'writable exports isolated');
      measurements.push({meshes:set.size,vertices:Array.from(mesh.vertices),pose:Array.from(pose.transform.matrix)});
      return {set,mesh,space:mesh.meshSpace,vertices:Array.from(mesh.vertices),changed:mesh.lastChangedTime,frame:f,time:t};
    });
    for(const bad of [null,{},Object.create(w.XRFrame.prototype),new Proxy(first.frame,{})]) throws(()=>Object.getOwnPropertyDescriptor(w.XRFrame.prototype,'detectedMeshes')!.get!.call(bad),'TypeError','frame getter brand precedes state');
    throws(()=>first.frame.detectedMeshes,'InvalidStateError','inactive mesh frame');
    await frame(session,f=>{check(f.detectedMeshes.has(first.mesh),'same identity across frames');check(first.mesh.meshSpace===first.space,'SameObject mesh space');check(Array.from(first.mesh.vertices).join()===first.vertices.join(),'unchanged published geometry');check(first.mesh.lastChangedTime===first.changed,'unchanged timestamp');});
    const transform=room.position.clone(),rotation=room.rotation.clone();room.position.x+=0.2;room.rotation.x+=Math.PI/2;
    await frame(session,f=>{check(f.detectedMeshes.has(first.mesh) && first.mesh.lastChangedTime===first.changed,'pose-only timestamp stability');});room.position.copy(transform);room.rotation.copy(rotation);
    const scale=room.scale.clone();room.scale.multiplyScalar(1.1);
    await frame(session,f=>{check(f.detectedMeshes.has(first.mesh) && first.mesh.lastChangedTime>first.changed,'shape change updates same mesh');check(Array.from(first.mesh.vertices).join()!==first.vertices.join(),'shape publication and timestamp agree');});room.scale.copy(scale);
    await frame(session,()=>{});
    const baseline=first.mesh.lastChangedTime,shape=Array.from(first.mesh.vertices);
    const step=2e-6/Math.max(...shape.map((v:any)=>Math.abs(v)));
    for(let i=1;i<=30;i++) {room.scale.copy(scale).multiplyScalar(1+i*step);await frame(session,()=>{});}
    check(first.mesh.lastChangedTime>baseline && Array.from(first.mesh.vertices).join()!==shape.join(),'small cumulative changes eventually publish with notification');room.scale.copy(scale);
    const provider=first.space.matrixProvider;first.space.matrixProvider=()=>null;
    await frame(session,f=>{check(f.detectedMeshes.has(first.mesh) && f.getPose(first.space,reference)===null,'tracked membership with unavailable pose');});first.space.matrixProvider=provider;
    const peer=sessions.find(s=>s!==session),foreign=await peer.requestReferenceSpace('viewer');
    session._device.arScene.room=null;
    await frame(session,f=>{
      check(f.detectedMeshes.size===0 && f.getPose(first.space,reference)===null,'removal/incomplete world: empty and null old pose');
      throws(()=>f.getPose(first.space,foreign),'InvalidStateError','foreign base rejected before null tracking');
      check(first.set.has(first.mesh),'old frame membership snapshot');
      throws(()=>f.detectedMeshes.forEach(null),'TypeError','empty removal callback validated');
    });
    session._device.arScene.room=room;
    const fresh=await frame(session,f=>{check(f.detectedMeshes.size>0 && !f.detectedMeshes.has(first.mesh),'reacquisition fresh identity/nonmember false');return [...f.detectedMeshes][0];});
    await session.end();
    check(session._environment.snapshot().meshes.size===0 && fresh.meshSpace._update()===null,'shutdown retires tracking');
    check(l._presentationCanvas===null || !l._presentationCanvas.isConnected,'shutdown releases presentation');
    check(first.mesh.vertices.length===9 && first.mesh.semanticLabel===null,'retained metadata readable after end');
    const disabled=await request({});sessions.push(disabled);await layer(disabled);
    await frame(disabled,f=>check(f.detectedMeshes.size===0,'AR unenabled active collection empty'));
    await disabled.end();
    return {mode,assertions:passed.length,passed,measurements};
  } finally {if(session?._device.arScene && room)session._device.arScene.room=room;for(const s of sessions)if(!s.ended)await s.end();child.remove();}
}
