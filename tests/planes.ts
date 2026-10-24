import type {SessionMode} from '../src/types/contracts';

/** WPT e185958 plane assertions adapted to the real extension, not WebXR Test
 * API fake-device setWorld. Additional bindings/geometry/lifecycle checks. */
export async function planeCases(mode: SessionMode) {
  const w=window as any, passed:string[]=[], measurements:any[]=[];
  function check(value:unknown,label:string) {if(!value) throw new Error(`${mode}: ${label}`);passed.push(label);}
  function throws(fn:()=>unknown,name:string,label:string) {let error:any;try{fn();}catch(e){error=e;}check(error?.name===name,label);}
  async function rejects(p:Promise<unknown>,name:string,label:string) {let error:any;try{await p;}catch(e){error=e;}check(error?.name===name,label);}
  function request(options:any) {return new Promise<any>((resolve,reject)=>{
    const b=document.createElement('button');b.id='reference-space-session';b.textContent='Start plane contract';b.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick=()=>{b.remove();w.navigator.xr.requestSession(mode,options).then(resolve,reject);};document.body.append(b);
  });}
  const sessions:any[]=[], child=document.createElement('iframe'); child.src='/frame';
  const ready=new Promise<void>(resolve=>{child.onload=()=>resolve();});document.body.append(child);await ready;
  const other=child.contentWindow as any;
  const frame=(s:any,fn:(f:any,t:number)=>any)=>new Promise<any>((resolve,reject)=>s.requestAnimationFrame((t:number,f:any)=>{try{resolve(fn(f,t));}catch(e){reject(e);}}));
  async function layer(s:any,realm:any=w) {const c=realm.document.createElement('canvas'); const g=c.getContext('webgl2')!;await g.makeXRCompatible();const l=new realm.XRWebGLLayer(s,g);s.updateRenderState({baseLayer:l});return l;}
  let session:any,room:any;
  try {
    for(const realm of [w,other]) for(const name of ['XRPlane','XRPlaneSet']) {throws(()=>new realm[name](),'TypeError',`${name} illegal constructor`);check(realm[name].length===0,'nonconstructible interface length');}
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
      check(Object.getPrototypeOf(empty)===other.XRPlaneSet.prototype,'genuine other-realm set');
      for(const realm of [w,other]) {check(Object.getOwnPropertyDescriptor(realm.XRPlaneSet.prototype,'size')!.get!.call(empty)===0,'borrowed cross-realm size');throws(()=>realm.XRPlaneSet.prototype.forEach.call(empty,42),'TypeError','empty callback conversion');}
    });
    const deadline=Date.now()+20000;
    while(!session._device.arScene?.room) {if(Date.now()>deadline)throw new Error('room timeout');await new Promise(r=>setTimeout(r,30));}
    room=session._device.arScene.room;
    const hit=await session.requestHitTestSource({space:await session.requestReferenceSpace('viewer')});
    const first=await frame(session,(f,t)=>{
      const set=f.detectedPlanes,planes=[...set],plane=planes.find((p:any)=>p.orientation==='horizontal');
      check(planes.length>0 && planes.some((p:any)=>p.orientation==='vertical'),'WPT plumbing: horizontal and vertical planes');
      for(const realm of [w,other]) {
        const proto=realm.XRPlaneSet.prototype;
        check(proto.keys===proto.values && proto.values===proto[Symbol.iterator],'setlike aliases');
        check([...proto.values.call(set)].every((p,i)=>p===planes[i]),'insertion order with borrowed values');
        check([...proto.entries.call(set)].every(([a,b],i)=>a===b && a===planes[i]),'paired entries');
        let count=0;const receiver={};proto.forEach.call(set,function(this:unknown,p:any,k:any,s:any){check(this===receiver && p===k && s===set && p===planes[count++],'callback receiver/arguments/order');},receiver);
        check(count===planes.length,'all callbacks');
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
      return {set,plane,space:plane.planeSpace,polygon:plane.polygon,changed:plane.lastChangedTime,frame:f,time:t};
    });
    for(const bad of [null,{},Object.create(w.XRFrame.prototype),new Proxy(first.frame,{})]) throws(()=>Object.getOwnPropertyDescriptor(w.XRFrame.prototype,'detectedPlanes')!.get!.call(bad),'TypeError','frame getter brand precedes state');
    throws(()=>first.frame.detectedPlanes,'InvalidStateError','WPT inactive plane frame');
    await frame(session,f=>{check(f.detectedPlanes.has(first.plane),'WPT same identity across frames');check(first.plane.planeSpace===first.space && first.plane.polygon===first.polygon,'space and unchanged polygon identity');check(first.plane.lastChangedTime===first.changed,'WPT unchanged timestamp');});
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
      check(first.set.has(first.plane),'old frame membership snapshot');
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
    const disabled=await request({});sessions.push(disabled);await layer(disabled);
    await frame(disabled,f=>check(f.detectedPlanes.size===0,'AR unenabled active collection empty'));
    await rejects(disabled.initiateRoomCapture(),'NotSupportedError','AR unenabled capture');await disabled.end();await rejects(disabled.initiateRoomCapture(),'InvalidStateError','AR ended unenabled precedence');
    return {mode,assertions:passed.length,passed,measurements};
  } finally {if(session?._device.arScene && room)session._device.arScene.room=room;for(const s of sessions)if(!s.ended)await s.end();child.remove();}
}
