import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {eventually} from './firefox-driver';
import {observeXR, applicationPixels} from './firefox-observation';
import {panelPose} from './firefox-contract';
import type {Driver} from './plane-applications';

/** Observe original Sample scene objects after its natural rendering callback.
 * Source-buffer world coordinates independently check returned and rendered
 * geometry. No application call, geometry, result or exception is replaced. */
export function observeMeshes() {
  const w=window as any;
  w.meshProbe={frames:0,count:0,matched:0,rebuilds:0,notifications:0,disposed:0};
  const records=new Map<any,any>();let session:any;
  const world=(m:ArrayLike<number>,p:number[])=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
  const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const viewer=w.XRFrame.prototype.getViewerPose;
  w.XRFrame.prototype.getViewerPose=function(...args:any[]) {
    const result=Reflect.apply(viewer,this,args);
    if(result && args[0]._type!=='viewer')w.meshReference=args[0];
    return result;
  };
  const raf=w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame=function(callback:any) {
    return Reflect.apply(raf,this,[function(this:any,t:number,f:any) {
      const result=Reflect.apply(callback,this,[t,f]);
      if(f.session._mode!=='immersive-ar'||!w.meshReference)return result;
      const p=w.meshProbe;p.frames++;
      if(session!==f.session){records.clear();session=f.session;}
      const meshes=[...f.detectedMeshes];p.count=meshes.length;
      const scene=w.firefoxScenes?.find((e:any)=>e.scene.children.some((o:any)=>o.geometry?.type==='SphereGeometry'))?.scene;
      if(!scene)return result;
      const objects=scene.children.filter((o:any)=>o.isMesh && o.geometry?.getAttribute('position')?.count===3 && o.geometry.index?.count===3 && !o.material.wireframe);
      p.objects=objects.length;
      if(p.frames%5!==0)return result;
      const room=f.session._device.arScene.room,source:number[][][]=[];
      room?.updateWorldMatrix(true,true);
      room?.traverse((o:any)=>{
        const pos=o.geometry?.getAttribute('position');if(!o.isMesh||o.name==='sky'||!pos)return;
        const idx=o.geometry.index;
        for(let i=0;i+2<(idx?.count??pos.count);i+=3)source.push([0,1,2].map(j=>{const n=idx?idx.getX(i+j):i+j;return world(o.matrixWorld.elements,[pos.getX(n),pos.getY(n),pos.getZ(n)]);}));
      });
      let matched=0,maxApiError=0,maxRoomError=0;
      for(const mesh of meshes) {
        const pose=f.getPose(mesh.meshSpace,w.meshReference);if(!pose)continue;
        const m=pose.transform.matrix,v=mesh.vertices,idx=mesh.indices;
        const object=objects.find((o:any)=>o.matrixWorld.elements.every((n:number,i:number)=>Math.abs(n-m[i])<1e-4));
        if(!object)continue;
        const positions=object.geometry.getAttribute('position'),indices=object.geometry.index;
        for(let i=0;i<v.length;i++)maxApiError=Math.max(maxApiError,Math.abs(positions.array[i]-v[i]));
        for(let i=0;i<idx.length;i++)maxApiError=Math.max(maxApiError,Math.abs(indices.array[i]-idx[i]));
        // Transform through reference-space native origin, rather than assuming
        // that the application's local origin is the room's world origin.
        const actual=Array.from(idx,(n:any)=>world(w.meshReference._update(),world(m,Array.from(v.slice(n*3,n*3+3)))));
        maxRoomError=Math.max(maxRoomError,Math.min(...source.map(triangle=>Math.max(...actual.map((point,i)=>distance(point,triangle[i]))))));
        const old=records.get(mesh);
        if(old) {
          if(old.changed!==mesh.lastChangedTime)p.notifications++;
          if(old.geometry!==object.geometry){p.rebuilds++;if(old.disposed)p.disposed++;}
        }
        const record={geometry:object.geometry,changed:mesh.lastChangedTime,disposed:false};
        if(!old||old.geometry!==object.geometry)object.geometry.addEventListener('dispose',()=>{record.disposed=true;});
        // Keep the disposal listener's record when geometry is unchanged.
        records.set(mesh,old?.geometry===object.geometry?Object.assign(old,{changed:mesh.lastChangedTime}):record);
        matched++;
      }
      p.matched=matched;p.maxApiError=maxApiError;p.maxRoomError=maxRoomError;p.viewer=w.firefoxViewer;
      p.centers=meshes.slice(0,3).map((mesh:any)=>Array.from(f.getPose(mesh.meshSpace,w.meshReference).transform.matrix).slice(12,15));
      p.geometryIds=objects.map((o:any)=>o.geometry.id);p.times=meshes.map((m:any)=>m.lastChangedTime);
      p.visible=objects.filter((o:any)=>o.visible).length;
      return result;
    }]);
  };
}

export async function runMeshApplications(driver:Driver) {
  const results:any[]=[];
  for(const [profile,device] of [['quest','Meta Quest 3'],['android','Generic Android Phone (ARCore)']]) {
    console.log('mesh application',driver.browser,profile);
    await driver.configure(device);
    await driver.panel(panelPose,[[0.15,1.65,0],[0,1.6,0],0]);
    if(profile==='android')await driver.panel(`window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0,1.6,-0.2);c.object.rotation.x=0;c.dispatchEvent({type:'change'});});`);
    await driver.navigate(driver.origin+'/samples/proposals/mesh-detection.html');
    await eventually(()=>driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`),Boolean,'pinned mesh Sample ready',60000);
    await driver.evaluate(`const __name=value=>value;(${observeXR.toString()})();(${observeMeshes.toString()})();document.querySelector('#useDomOverlay').checked=false;`);
    await driver.clickEntry();
    const aligned=()=>driver.evaluate('return window.meshProbe');
    const ready=(p:any)=>p.frames>=30 && p.count>0 && p.matched===p.count && p.objects===p.count;
    await eventually(aligned,ready,'all Sample mesh objects aligned',60000);
    const before=await aligned();console.log('mesh initial alignment',JSON.stringify({count:before.count,matched:before.matched,maxApiError:before.maxApiError,maxRoomError:before.maxRoomError}));assert(before.maxApiError<1e-4 && before.maxRoomError<1e-4);
    assert.equal(before.visible,before.count);
    const captures:string[]=[],rendering:any[]=[];
    async function capture(label:string) {
      const file=`test-results/meshes-${driver.browser}-${profile}-${label}.png`;await writeFile(file,await driver.screenshot());captures.push(file);
      const texture=await driver.evaluate(`const s=window.firefoxSession,l=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation;return l._presentationCanvas.toDataURL()`);
      const raw=file.replace('.png','-application.png');await writeFile(raw,Buffer.from(texture.replace(/^data:image\/png;base64,/,''),'base64'));captures.push(raw);
      // These five exact Sample material colors identify triangle interiors;
      // the red sphere reticle and neutral controllers cannot satisfy this.
      const meshPixels=await driver.evaluate(`const s=window.firefoxSession,l=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation,c=l._presentationCanvas,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,n=s._device.handheld?1:2;return Array.from({length:n},(_,eye)=>{let count=0;for(let y=0;y<c.height;y++)for(let x=Math.floor(eye*c.width/n);x<Math.floor((eye+1)*c.width/n);x++){const i=(y*c.width+x)*4,r=d[i],g=d[i+1],b=d[i+2];if(d[i+3] && ((r===0&&g===255&&b===0)||(r===0&&g===0&&b===255)||(r===255&&g===255&&b===0)||(r===0&&g===255&&b===255)||(r===255&&g===0&&b===255)))count++;}return {eye:n===1?'none':eye===0?'left':'right',meshInteriorPixels:count};});`);
      const evidence={label,meshPixels,textureSHA256:createHash('sha256').update(Buffer.from(texture.replace(/^data:image\/png;base64,/,''),'base64')).digest('hex')};rendering.push(evidence);
      if(label==='removed')assert(meshPixels.every((eye:any)=>eye.meshInteriorPixels<100),'mesh material pixels disappear after removal');
      else assert(meshPixels.every((eye:any)=>eye.meshInteriorPixels>100),'identifiable mesh triangle interiors in every eye');
    }
    const pixels=await driver.evaluate(`return (${applicationPixels.toString()})()`);
    assert.equal(pixels.regions.length,profile==='quest'?2:1);
    for(const eye of pixels.regions)assert(eye.colored>100 && eye.colors>5,'mesh Sample pixels in every eye');
    await capture('before');
    assert.equal(await driver.panel(panelPose,[[0,1.6,0],[0.15,1.65,0],-0.25]),1);
    if(profile==='android')assert.equal(await driver.panel(`let n=0;window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0.15,1.65,-0.075);c.object.rotation.x=-0.25;c.dispatchEvent({type:'change'});n++;});return n;`),1);
    await eventually(aligned,p=>p.frames>before.frames+20 && p.viewer?.[0]>0.14,'viewer movement reaches original Sample');
    const moved=await aligned();console.log('mesh phase','viewer moved');assert(Math.hypot(...moved.viewer.map((v:number,i:number)=>v-before.viewer[i]))>0.1);
    assert.deepEqual(moved.centers,before.centers);assert.deepEqual(moved.times,before.times);assert.deepEqual(moved.geometryIds,before.geometryIds);
    assert(moved.maxRoomError<1e-4);await capture('viewer-moved');
    // Disclosed virtual-backend controls: preserve original application calls
    // and let its timestamp-dependent processMeshes rebuild the actual scene.
    await driver.evaluate(`const room=window.firefoxSession._device.arScene.room;window.meshRoom=room;window.meshOriginal={position:room.position.clone(),rotation:room.rotation.clone(),scale:room.scale.clone()};room.position.x+=0.2;room.rotation.x+=0.05;`);
    await eventually(aligned,p=>p.frames>moved.frames+20,'backend rigid pose propagated');
    const poseOnly=await aligned();console.log('mesh phase','pose only');assert.deepEqual(poseOnly.times,moved.times);assert.deepEqual(poseOnly.geometryIds,moved.geometryIds);assert(poseOnly.maxRoomError<1e-4);
    assert.notDeepEqual(poseOnly.centers,moved.centers);await capture('pose-only');
    await driver.evaluate('window.meshRoom.scale.multiplyScalar(1.1)');
    await eventually(aligned,p=>p.frames>poseOnly.frames+20 && p.rebuilds>=p.count,'Sample rebuilt geometry after shape change',60000);
    const shape=await aligned();console.log('mesh phase','shape rebuilt');assert(shape.notifications>=shape.count && shape.disposed>=shape.count);assert(shape.maxApiError<1e-4 && shape.maxRoomError<1e-4);
    assert.notDeepEqual(shape.geometryIds,poseOnly.geometryIds);assert(shape.times.every((v:number,i:number)=>v>poseOnly.times[i]));await capture('shape');assert.notEqual(rendering.find(r=>r.label==='shape').textureSHA256,rendering.find(r=>r.label==='pose-only').textureSHA256,'rebuild changes actual rendered mesh pixels');
    await driver.evaluate(`window.meshOld=[...window.firefoxSession._environment.snapshot().meshes];window.firefoxSession._device.arScene.room=null;`);
    await eventually(aligned,p=>p.count===0 && p.objects===0,'original Sample removes retired meshes');
    const removed=await driver.evaluate('return {probe:window.meshProbe,oldNull:window.meshOld.every(m=>m.meshSpace._update()===null)}');assert(removed.oldNull);
    await capture('removed');
    await driver.evaluate('window.firefoxSession._device.arScene.room=window.meshRoom');
    await eventually(aligned,p=>p.frames>shape.frames+30 && ready(p),'original Sample reacquires mesh objects');
    const reacquired=await driver.evaluate('return {probe:window.meshProbe,fresh:window.meshOld.every(m=>!window.firefoxSession._environment.snapshot().meshes.has(m))}');assert(reacquired.fresh && reacquired.probe.maxRoomError<1e-4);await capture('reacquired');
    const sessionState=await driver.evaluate(`window.meshOldSession=window.firefoxSession;window.meshOldLayer=window.firefoxSession.renderState.baseLayer??window.firefoxSession.renderState.layers[0]._binding._presentation;window.meshAtEnd=[...window.firefoxSession._environment.snapshot().meshes];return {requests:window.firefoxXR.requests,views:window.firefoxXR.views};`);
    await driver.evaluate('return window.firefoxSession.end()');
    const stopped=await driver.evaluate('return window.meshProbe.frames');
    await new Promise(r=>setTimeout(r,150));
    const shutdown=await driver.evaluate(`return {frames:window.meshProbe.frames,ends:window.firefoxXR.ends,meshes:window.meshOldSession._environment.snapshot().meshes.size,oldNull:window.meshAtEnd.every(m=>m.meshSpace._update()===null),callbacks:window.meshOldSession.callbacks.size,layers:window.meshOldSession._webglLayers.size,canvasConnected:!!window.meshOldLayer._presentationCanvas?.isConnected}`);
    assert.equal(shutdown.frames,stopped);assert.equal(shutdown.ends,1);assert.equal(shutdown.meshes,0);assert(shutdown.oldNull);assert.equal(shutdown.callbacks,0);assert.equal(shutdown.layers,0);assert(!shutdown.canvasConnected);
    await eventually(()=>driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`),Boolean,'Sample restart entry');
    await driver.clickEntry();await eventually(aligned,p=>p.frames>stopped+30 && ready(p),'restarted Sample mesh rendering',60000);
    const restart=await driver.evaluate(`return {probe:window.meshProbe,freshSession:window.firefoxSession!==window.meshOldSession,fresh:window.meshAtEnd.every(m=>!window.firefoxSession._environment.snapshot().meshes.has(m))}`);
    assert(restart.freshSession && restart.fresh && restart.probe.maxRoomError<1e-4);await capture('restart');
    await driver.evaluate('return window.firefoxSession.end()');
    const finalShutdown=await driver.evaluate(`return {ends:window.firefoxXR.ends,meshes:window.firefoxSession._environment.snapshot().meshes.size,callbacks:window.firefoxSession.callbacks.size,layers:window.firefoxSession._webglLayers.size}`);
    assert.deepEqual(finalShutdown,{ends:2,meshes:0,callbacks:0,layers:0});
    const dependencies=await driver.evaluate(`return Promise.all([...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(url=>url.startsWith('https://cdn.jsdelivr.net/npm/three@0.152.2/')))].map(async url=>{const response=await fetch(url,{cache:'force-cache'}),bytes=await response.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);return {url,status:response.status,bytes:bytes.byteLength,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),evidence:'browser force-cache reread of immutable pinned dependency'};}));`);
    results.push({profile,device,app:'sample',before,moved,poseOnly,shape,removed,reacquired,pixels,sessionState,shutdown,restart,finalShutdown,dependencies,captures,rendering});
    await writeFile(`test-results/mesh-applications-${driver.browser}-progress.json`,JSON.stringify(results,null,2));
  }
  return results;
}
