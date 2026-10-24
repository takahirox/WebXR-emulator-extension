import type {SessionMode} from '../src/types/contracts';

/** WPT e185958 plane assertions adapted to the real extension, not WebXR Test
 * API fake-device setWorld. Additional bindings/geometry/lifecycle checks. */
export async function planeCases(mode: SessionMode) {
  const w=window as any, passed:string[]=[], measurements:any[]=[];
  function check(value:unknown,label:string) {if(!value) throw new Error(`${mode}: ${label}`);passed.push(label);}
  function throws(fn:()=>unknown,name:string,label:string) {let error:any;try{fn();}catch(e){error=e;}check(error?.name===name,label);}
  async function rejects(p:Promise<unknown>,name:string,label:string) {let error:any;try{await p;}catch(e){error=e;}check(error?.name===name,label);}
  function request(options:any,realm:any=w) {return new Promise<any>((resolve,reject)=>{
    const b=document.createElement('button');b.id='reference-space-session';b.textContent='Start plane contract';b.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick=()=>{b.remove();realm.navigator.xr.requestSession(mode,options).then(resolve,reject);};document.body.append(b);
  });}
  const sessions:any[]=[], child=document.createElement('iframe'); child.src='/frame';
  const ready=new Promise<void>(resolve=>{child.onload=()=>resolve();});document.body.append(child);await ready;
  const other=child.contentWindow as any;
  const frame=(s:any,fn:(f:any,t:number)=>any)=>new Promise<any>((resolve,reject)=>s.requestAnimationFrame((t:number,f:any)=>{try{resolve(fn(f,t));}catch(e){reject(e);}}));
  async function layer(s:any,realm:any=w) {const c=realm.document.createElement('canvas'); const g=c.getContext('webgl2')!;await g.makeXRCompatible();const l=new realm.XRWebGLLayer(s,g);s.updateRenderState({baseLayer:l});return l;}
  // Probe the original shared paths as well as the protected allocation readers.
  // Each operation actually attempts the mutation, so this fails with writable
  // WeakMaps/records/Sets even when the outer registry itself is frozen.
  function attackRegistry(set:any,plane?:any) {
    const shared=w[Symbol.for('WebXR-emulator.interface-brands')];
    const allocations=shared.planeAllocations;
    const values=shared.planeValues ?? allocations?.planes, sets=shared.planeSets ?? allocations?.sets;
    const fake=Object.create(w.XRPlane.prototype),fakeSet=Object.create(w.XRPlaneSet.prototype);
    const record={space:plane?.planeSpace,polygon:Object.freeze([]),orientation:'vertical',changed:999,matrix:new Float32Array(16),signature:[]};
    for(const [reader,key,replacement] of [[values,fake,record],[values,plane,record],[sets,fakeSet,new Set()],[sets,set,new Set()]]) {
      if(!key)continue;
      throws(()=>reader.set(key,replacement),'TypeError','registry registration/replacement unavailable');
      throws(()=>reader.delete(key),'TypeError','registry deletion unavailable');
      throws(()=>WeakMap.prototype.set.call(reader,key,replacement),'TypeError','native WeakMap writer cannot register');
      throws(()=>WeakMap.prototype.delete.call(reader,key),'TypeError','native WeakMap writer cannot delete');
    }
    throws(()=>Object.getOwnPropertyDescriptor(w.XRPlane.prototype,'polygon')!.get!.call(fake),'TypeError','registry cannot brand forged plane');
    throws(()=>Object.getOwnPropertyDescriptor(w.XRPlaneSet.prototype,'size')!.get!.call(fakeSet),'TypeError','registry cannot brand forged set');
    const membership=sets.get(set),before=[...set];
    check(Object.isFrozen(sets) && Object.isFrozen(membership),'frozen collection reader and protected view');
    for(const [name,args] of [['clear',[]],['delete',[plane]],['add',[fake]] ] as const) {
      throws(()=>membership[name](...args),'TypeError','backing collection writer unavailable');
      throws(()=>(Set.prototype as any)[name].apply(membership,args),'TypeError','native Set writer cannot mutate view');
    }
    for(const name of ['size','has','values','entries']) {
      check(!Reflect.set(membership,name,name==='size'?999:()=>new Set([fake])),'collection view replacement rejected');
      check(!Reflect.deleteProperty(membership,name),'collection view deletion rejected');
    }
    check(set.size===before.length && [...set].every((p,i)=>p===before[i]),'registry attacks preserve snapshot membership');
    if(plane) {
      const state=values.get(plane),polygon=plane.polygon,space=plane.planeSpace,changed=plane.lastChangedTime,orientation=plane.orientation;
      check(Object.isFrozen(values) && Object.isFrozen(state),'frozen plane reader and protected metadata view');
      check(!('matrix' in state) && !('signature' in state),'reader conceals pose matrix and geometry comparison state');
      for(const name of ['space','polygon','orientation','changed','matrix','signature']) {
        check(!Reflect.set(state,name,record[name as keyof typeof record]),'tracking record replacement rejected');
        if(name in state)check(!Reflect.deleteProperty(state,name),'tracking record deletion rejected');
      }
      throws(()=>state.polygon.push(new DOMPointReadOnly()),'TypeError','reader polygon cannot grow');
      check(!Reflect.set(state.polygon[0],'x',999),'reader polygon point readonly');
      check(plane.polygon===polygon && plane.planeSpace===space && plane.lastChangedTime===changed && plane.orientation===orientation,'registry attacks preserve plane metadata');
    }
  }
  let session:any,room:any;
  try {
    for(const realm of [w,other]) for(const name of ['XRPlane','XRPlaneSet']) {throws(()=>new realm[name](),'TypeError',`${name} illegal constructor`);check(realm[name].length===0,'nonconstructible interface length');}
    for(const realm of [w,other]) {
      const allocations=w[Symbol.for('WebXR-emulator.interface-brands')].planeAllocations;
      let reads=0,iterations=0;
      const record={get polygon(){reads++;return [];},get matrix(){reads++;return null;}};
      const callback=()=>{reads++;return record;}, values={*[Symbol.iterator](){iterations++;yield {};}};
      for(const [C,args,Interface] of [
        [Object.getPrototypeOf(realm.XRPlane),[{},record,callback],realm.XRPlane],
        [Object.getPrototypeOf(realm.XRPlaneSet),[values],realm.XRPlaneSet],
        [realm.XRPlane,[{},record,callback],realm.XRPlane],
        [realm.XRPlaneSet,[values],realm.XRPlaneSet],
      ]) for(const token of [undefined,Symbol('plane allocation'),allocations]) {
        throws(()=>Reflect.construct(C,[...args,token]),'TypeError','direct plane allocation rejected');
        for(const Target of [Interface,class extends Interface {}])throws(()=>Reflect.construct(C,[...args,token],Target),'TypeError','reflective plane allocation rejected');
      }
      check(reads===0 && iterations===0,'unauthorized allocation never reads records/callbacks/iterables');
      throws(()=>new allocations.PlaneTracker({}),'TypeError','plane tracker requires session brand');
      for(const name of ['allocatePlane','allocateSet','updatePlane'])check(!(name in allocations),'plane allocation and state writers private');
    }
    for(const bad of [undefined,null,{},w.XRSession.prototype,Object.create(w.XRSession.prototype)]) {
      const promise=w.XRSession.prototype.initiateRoomCapture.call(bad);check(Object.prototype.toString.call(promise)==='[object Promise]','capture binding errors return Promise');await rejects(promise,'TypeError','capture rejects unbranded receiver');
    }
    if(mode!=='immersive-ar') {
      await rejects(request({requiredFeatures:['plane-detection']}),'NotSupportedError','unsupported required plane negotiation');
      session=await request({optionalFeatures:['plane-detection']});sessions.push(session);await layer(session);
      check(!session.enabledFeatures.includes('plane-detection'),'unsupported optional plane omitted');
      await frame(session,f=>check(f.detectedPlanes.size===0,'unenabled active collection empty'));
      await rejects(session.initiateRoomCapture(),'NotSupportedError','unenabled capture');await session.end();
      await rejects(session.initiateRoomCapture(),'InvalidStateError','ended precedes unenabled');
      return {mode,assertions:passed.length,passed,measurements};
    }
    session=await request({requiredFeatures:['plane-detection','anchors','mesh-detection','hit-test']});sessions.push(session);const l=await layer(session);
    const reference=await session.requestReferenceSpace('local'), offset=reference.getOffsetReferenceSpace(new w.XRRigidTransform({x:1,y:2,z:3}));
    await other.navigator.xr.requestSession('inline').then(async(s:any)=>{sessions.push(s);await layer(s,other);const empty=await frame(s,f=>f.detectedPlanes);
      check(Object.getPrototypeOf(empty)===other.XRPlaneSet.prototype,'genuine other-realm set');attackRegistry(empty);
      for(const realm of [w,other]) {check(Object.getOwnPropertyDescriptor(realm.XRPlaneSet.prototype,'size')!.get!.call(empty)===0,'borrowed cross-realm size');throws(()=>realm.XRPlaneSet.prototype.forEach.call(empty,42),'TypeError','empty callback conversion');}
    });
    const deadline=Date.now()+20000;
    while(!session._device.arScene?.room) {if(Date.now()>deadline)throw new Error('room timeout');await new Promise(r=>setTimeout(r,30));}
    room=session._device.arScene.room;
    const hit=await session.requestHitTestSource({space:await session.requestReferenceSpace('viewer')});
    const first=await frame(session,(f,t)=>{
      const set=f.detectedPlanes,planes=[...set],plane=planes.find((p:any)=>p.orientation==='horizontal');
      check(planes.length>0 && planes.some((p:any)=>p.orientation==='vertical'),'WPT plumbing: horizontal and vertical planes');
      attackRegistry(set,plane);
      const allocations=w[Symbol.for('WebXR-emulator.interface-brands')].planeAllocations;
      const tracker=new allocations.PlaneTracker(session,w.XRPlane.prototype,w.XRPlaneSet.prototype);
      let reads=0;const caller={valueOf(){reads++;return 999;},get polygon(){reads++;return []}};
      throws(()=>tracker.update(caller),'TypeError','tracker cannot retain caller state as frame time');
      check(reads===0 && tracker.snapshot().size===0,'tracker rejects caller callbacks without reading');
      for(const realm of [w,other])for(const Interface of [realm.XRPlane,realm.XRPlaneSet]) {
        const disguised=Reflect.construct(allocations.PlaneTracker,[session,realm.XRPlane.prototype,realm.XRPlaneSet.prototype],Interface);
        const name=Interface===realm.XRPlane?'polygon':'size';
        throws(()=>Object.getOwnPropertyDescriptor(Interface.prototype,name)!.get!.call(disguised),'TypeError','reflective tracker construction cannot acquire plane/set brand');
      }
      const exported=plane.planeSpace._update();exported.fill(999);
      check(!Array.from(plane.planeSpace._update()).includes(999),'space pose exports cannot mutate private tracking buffer');
      tracker.update(t);const privateSet=tracker.snapshot();
      check(privateSet.size===set.size && [...privateSet].every((p:any)=>!set.has(p)),'tracker allocates independent backend identities');
      tracker.clear();check(set.size===planes.length && !!f.getPose(plane.planeSpace,reference),'independent tracker cannot clear session tracking');
      for(const realm of [w,other]) {
        const proto=realm.XRPlaneSet.prototype;
        check(proto.keys===proto.values && proto.values===proto[Symbol.iterator],'setlike aliases');
        check([...proto.values.call(set)].every((p,i)=>p===planes[i]),'insertion order with borrowed values');
        check([...proto.entries.call(set)].every(([a,b],i)=>a===b && a===planes[i]),'paired entries');
        let count=0;const receiver={};proto.forEach.call(set,function(this:unknown,p:any,k:any,s:any){check(this===receiver && p===k && s===set && p===planes[count++],'callback receiver/arguments/order');},receiver);
        check(count===planes.length,'all callbacks');
        const sentinel={};let caught;try{proto.forEach.call(set,()=>{throw sentinel;});}catch(error){caught=error;}check(caught===sentinel,'callback exceptions propagate unchanged');
        for(const name of ['has','values','keys','entries','forEach']){const d=Object.getOwnPropertyDescriptor(proto,name)!;check(d.enumerable && d.configurable && d.writable,'setlike method descriptors');}
        check(!('add' in set)&&!('delete' in set)&&!('clear' in set),'no collection mutators');
        check(Object.getOwnPropertyDescriptor(realm.XRFrame.prototype,'detectedPlanes')!.get!.call(f)===set,'borrowed frame getter accepts active parent AR frame');
        for(const p of planes) {
          for(const name of ['planeSpace','polygon','orientation','lastChangedTime','semanticLabel']) {
            const d=Object.getOwnPropertyDescriptor(realm.XRPlane.prototype,name)!;
            check(!!d.get && !d.set && d.enumerable && d.configurable && !Object.prototype.hasOwnProperty.call(p,name),'readonly branded prototype getter');
            check(d.get!.call(p)===p[name],'cross-realm borrowed plane getter');
            for(const bad of [null,{},realm.XRPlane.prototype,Object.create(realm.XRPlane.prototype),new Proxy(p,{})]) throws(()=>d.get!.call(bad),'TypeError','forged/proxied plane rejected');
          }
          check(Object.isFrozen(p.polygon) && p.polygon.every((q:any)=>q instanceof DOMPointReadOnly && Object.isFrozen(q) && q.y===0 && q.w===1 && Number.isFinite(q.x+q.z)),'frozen finite local metre polygon');
        }
        for(const bad of [null,{},realm.XRPlaneSet.prototype,Object.create(proto),new Proxy(set,{})]) {
          throws(()=>Object.getOwnPropertyDescriptor(proto,'size')!.get!.call(bad),'TypeError','size receiver');
          for(const name of ['has','values','keys','entries','forEach']) throws(()=>proto[name].call(bad,plane),'TypeError','setlike receiver');
        }
        for(const bad of [undefined,null,42,{},Object.create(realm.XRPlane.prototype),new Proxy(plane,{})]) throws(()=>proto.has.call(set,bad),'TypeError','has interface conversion');
        throws(()=>proto.has.call(set),'TypeError','has requires argument');
        for(const bad of [undefined,null,42,{}]) throws(()=>proto.forEach.call(set,bad),'TypeError','callback conversion');
      }
      const pose=f.getPose(plane.planeSpace,reference),shifted=f.getPose(plane.planeSpace,offset);
      check([1,2,3].every((v,i)=>Math.abs(pose.transform.matrix[12+i]-shifted.transform.matrix[12+i]-v)<1e-4),'plane offset poses');
      const hitPose=f.getHitTestResults(hit)[0]?.getPose(reference);
      check(!!hitPose,'actual room hit intersection');
      const point=hitPose.transform.position;
      const contains=planes.some((p:any)=>{
        const inv=f.getPose(p.planeSpace,reference).transform.inverse.matrix;
        const local=[0,1,2].map(i=>inv[i]*point.x+inv[4+i]*point.y+inv[8+i]*point.z+inv[12+i]);
        if(Math.abs(local[1])>1e-4)return false;
        const signs=p.polygon.map((a:any,i:number)=>{const b=p.polygon[(i+1)%p.polygon.length];return (b.x-a.x)*(local[2]-a.z)-(b.z-a.z)*(local[0]-a.x);});
        return signs.every((n:number)=>n>=-1e-4)||signs.every((n:number)=>n<=1e-4);
      });
      check(contains,'independent convex polygon test contains room hit point');
      const mesh=[...f.detectedMeshes][0];check(mesh.vertices.length===9 && mesh.indices.length===3 && !!f.getPose(mesh.meshSpace,reference),'mesh triangles retain calibrated pose');
      measurements.push({planes:set.size,meshes:f.detectedMeshes.size,polygon:plane.polygon.map((p:any)=>[p.x,p.y,p.z]),pose:Array.from(pose.transform.matrix)});
      return {set,plane,pose:Array.from(pose.transform.matrix),space:plane.planeSpace,polygon:plane.polygon,changed:plane.lastChangedTime,frame:f,time:t};
    });
    for(const bad of [null,{},Object.create(w.XRFrame.prototype),new Proxy(first.frame,{})]) throws(()=>Object.getOwnPropertyDescriptor(w.XRFrame.prototype,'detectedPlanes')!.get!.call(bad),'TypeError','frame getter brand precedes state');
    throws(()=>first.frame.detectedPlanes,'InvalidStateError','WPT inactive plane frame');
    await frame(session,f=>{check(f.detectedPlanes.has(first.plane),'WPT same identity across frames');check(first.plane.planeSpace===first.space && first.plane.polygon===first.polygon,'space and unchanged polygon identity');check(first.plane.lastChangedTime===first.changed,'WPT unchanged timestamp');check(Array.from(f.getPose(first.space,reference).transform.matrix).every((v,i)=>v===first.pose[i]),'registry attacks preserve future pose publications');check(f.detectedPlanes.size===first.set.size,'registry attacks preserve future membership');});
    for(const bad of [new Proxy(session,{}),Object.create(session)])await rejects(w.XRSession.prototype.initiateRoomCapture.call(bad),'TypeError','capture rejects proxy/forgery');
    await other.XRSession.prototype.initiateRoomCapture.call(session);check(true,'borrowed capture first resolves');
    await rejects(session.initiateRoomCapture(),'InvalidStateError','repeated capture');
    const transform=room.position.clone();room.position.x+=0.2;
    await frame(session,f=>{check(f.detectedPlanes.has(first.plane) && first.plane.lastChangedTime===first.changed,'pose-only timestamp stability');});room.position.copy(transform);
    const scale=room.scale.clone();room.scale.multiplyScalar(1.1);
    await frame(session,f=>{check(f.detectedPlanes.has(first.plane) && first.plane.lastChangedTime>first.changed,'shape change updates same plane');check(first.plane.polygon!==first.polygon && Object.isFrozen(first.polygon),'retained frozen old polygon');});room.scale.copy(scale);
    const provider=first.space.matrixProvider;first.space.matrixProvider=()=>null;
    await frame(session,f=>{check(f.detectedPlanes.has(first.plane) && f.getPose(first.space,reference)===null,'tracked membership with unavailable pose');});first.space.matrixProvider=provider;
    const peer=sessions.find(s=>s!==session),foreign=await peer.requestReferenceSpace('viewer');
    session._device.arScene.room=null;
    await frame(session,f=>{
      check(f.detectedPlanes.size===0 && f.getPose(first.space,reference)===null,'WPT removal/incomplete world: empty and null old pose');
      throws(()=>f.getPose(first.space,foreign),'InvalidStateError','foreign base rejected before null tracking');
      check(first.set.has(first.plane),'old frame membership snapshot');attackRegistry(f.detectedPlanes);
      throws(()=>f.detectedPlanes.forEach(null),'TypeError','empty removal callback validated');
    });
    session._device.arScene.room=room;
    const fresh=await frame(session,f=>{check(f.detectedPlanes.size>0 && !f.detectedPlanes.has(first.plane),'WPT reacquisition fresh identity/nonmember false');return [...f.detectedPlanes][0];});
    const anchor=await frame(session,f=>f.createAnchor(new w.XRRigidTransform(),fresh.planeSpace));
    await frame(session,f=>{const p=f.getPose(anchor.anchorSpace,fresh.planeSpace).transform.position;check(Math.hypot(p.x,p.y,p.z)<1e-4,'anchor placement at measured plane origin');});
    await session.end();
    check(session._environment.snapshot().planes.size===0 && fresh.planeSpace._update()===null,'shutdown retires tracking');
    check(l._presentationCanvas===null || !l._presentationCanvas.isConnected,'shutdown releases presentation');
    check(first.plane.polygon.length>=3 && first.plane.semanticLabel===null,'retained metadata readable after end');
    await rejects(other.XRSession.prototype.initiateRoomCapture.call(session),'InvalidStateError','ended capture state precedence');
    const childSession=await request({requiredFeatures:['plane-detection','mesh-detection']},other);sessions.push(childSession);
    const childLayer=await layer(childSession,other),childReference=await childSession.requestReferenceSpace('local');
    const childDeadline=Date.now()+20000;
    while(!childSession._device.arScene?.room) {if(Date.now()>childDeadline)throw new Error('child room timeout');await new Promise(r=>setTimeout(r,30));}
    const childFirst=await frame(childSession,f=>{
      const set=f.detectedPlanes,planes=[...set];
      check(planes.length===first.set.size && f.detectedMeshes.size>0,'populated child AR planes and interoperable meshes');
      check(Object.getPrototypeOf(f)===other.XRFrame.prototype && Object.getPrototypeOf(set)===other.XRPlaneSet.prototype,'child frame and set realm-local prototypes');
      attackRegistry(first.set,first.plane);attackRegistry(set,planes[0]);
      for(const realm of [w,other]) {
        const proto=realm.XRPlaneSet.prototype,get=Object.getOwnPropertyDescriptor(realm.XRFrame.prototype,'detectedPlanes')!.get!;
        check(get.call(f)===set,'borrowed frame getter accepts active child AR frame');
        check(Object.getOwnPropertyDescriptor(proto,'size')!.get!.call(set)===planes.length,'borrowed populated child size');
        check([...proto.values.call(set)].every((p,i)=>p===planes[i]),'borrowed child insertion order');
        check([...proto.entries.call(set)].every(([a,b],i)=>a===b && a===planes[i]),'borrowed child paired entries');
        let count=0;const receiver={};proto.forEach.call(set,function(this:unknown,p:any,k:any,s:any){check(this===receiver && p===k && s===set && p===planes[count++],'borrowed child callback arguments and order');},receiver);
        check(count===planes.length,'borrowed child callbacks visit all planes');
        for(const plane of planes) {
          check(Object.getPrototypeOf(plane)===other.XRPlane.prototype,'child plane realm-local prototype');
          check(proto.has.call(set,plane) && !proto.has.call(set,first.plane),'child membership and foreign genuine nonmember');
          for(const name of ['planeSpace','polygon','orientation','lastChangedTime','semanticLabel']) {
            const read=Object.getOwnPropertyDescriptor(realm.XRPlane.prototype,name)!.get!;
            check(read.call(plane)===plane[name],'borrowed getter accepts child plane');
            for(const bad of [Object.create(realm.XRPlane.prototype),new Proxy(plane,{})])throws(()=>read.call(bad),'TypeError','borrowed child getter rejects forgery/proxy');
          }
          check(!!realm.XRFrame.prototype.getPose.call(f,plane.planeSpace,childReference),'borrowed pose resolves child plane');
          throws(()=>realm.XRFrame.prototype.getPose.call(f,plane.planeSpace,reference),'InvalidStateError','child plane rejects foreign base');
          throws(()=>realm.XRFrame.prototype.getPose.call(f,first.space,childReference),'InvalidStateError','child frame rejects foreign plane space');
        }
        for(const bad of [Object.create(realm.XRPlaneSet.prototype),new Proxy(set,{})])throws(()=>proto.values.call(bad),'TypeError','child set rejects forgery/proxy');
        for(const bad of [Object.create(realm.XRFrame.prototype),new Proxy(f,{})])throws(()=>get.call(bad),'TypeError','child frame brand precedes activity');
      }
      measurements.push({realm:'child',planes:set.size,meshes:f.detectedMeshes.size});
      return {frame:f,plane:planes[0],set,polygon:planes[0].polygon,changed:planes[0].lastChangedTime};
    });
    for(const realm of [w,other])throws(()=>Object.getOwnPropertyDescriptor(realm.XRFrame.prototype,'detectedPlanes')!.get!.call(childFirst.frame),'InvalidStateError','borrowed inactive child frame rejected');
    await frame(childSession,f=>{check(f.detectedPlanes.has(childFirst.plane) && childFirst.plane.polygon===childFirst.polygon && childFirst.plane.lastChangedTime===childFirst.changed,'attacks leave another session and future publications intact');});
    await childSession.end();
    check(childSession._environment.snapshot().planes.size===0 && childFirst.plane.planeSpace._update()===null,'child shutdown retires planes');
    check(childLayer._presentationCanvas===null || !childLayer._presentationCanvas.isConnected,'child shutdown releases presentation');
    const restart=await request({requiredFeatures:['plane-detection']});sessions.push(restart);await layer(restart);
    const restartDeadline=Date.now()+20000;
    while(!restart._device.arScene?.room) {if(Date.now()>restartDeadline)throw new Error('restart room timeout');await new Promise(r=>setTimeout(r,30));}
    await frame(restart,f=>{check(f.detectedPlanes.size===first.set.size && !f.detectedPlanes.has(first.plane) && !f.detectedPlanes.has(childFirst.plane),'restart receives fresh complete plane tracking');attackRegistry(f.detectedPlanes,[...f.detectedPlanes][0]);});
    await restart.end();
    const disabled=await request({});sessions.push(disabled);await layer(disabled);
    await frame(disabled,f=>check(f.detectedPlanes.size===0,'AR unenabled active collection empty'));
    await rejects(disabled.initiateRoomCapture(),'NotSupportedError','AR unenabled capture');await disabled.end();await rejects(disabled.initiateRoomCapture(),'InvalidStateError','AR ended unenabled precedence');
    return {mode,assertions:passed.length,passed,measurements};
  } finally {if(session?._device.arScene && room)session._device.arScene.room=room;for(const s of sessions)if(!s.ended)await s.end();child.remove();}
}
