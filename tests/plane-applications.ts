import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {eventually} from './firefox-driver';
import {observeXR,applicationPixels} from './firefox-observation';
import {panelPose} from './firefox-contract';

interface Driver {
  browser:string; origin:string;
  navigate(url:string):Promise<void>; configure(device:string):Promise<void>;
  evaluate<T=any>(script:string,args?:unknown[]):Promise<T>;
  panel<T=any>(script:string,args?:unknown[]):Promise<T>;
  clickEntry():Promise<void>; screenshot():Promise<Buffer>; phoneSelect(point:{x:number;y:number}):Promise<void>;
}

/** Observation only: retain original results/arguments; measure application
 * scene meshes after natural rendering and observe select-created anchors. */
export function observePlanes() {
  const w=window as any;
  w.planeProbe={frames:0,planes:0,alignment:[],anchors:[],reticle:null};
  const multiply=(m:ArrayLike<number>,p:number[])=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
  const getter=w.XRFrame.prototype.getViewerPose;
  w.XRFrame.prototype.getViewerPose=function(...args:any[]) {
    const result=Reflect.apply(getter,this,args);
    if(result && args[0]._type!=='viewer') w.planeReference=args[0];
    return result;
  };
  const create=w.XRFrame.prototype.createAnchor;
  w.XRFrame.prototype.createAnchor=function(...args:any[]) {
    const result=Reflect.apply(create,this,args) as Promise<any>;
    const reference=w.planeReference, pose=this.getPose(args[1],reference);
    const local=[args[0].position.x,args[0].position.y,args[0].position.z];
    const requested=pose && multiply(pose.transform.matrix,local);
    const reticle=w.planeProbe.reticle?.slice();
    const base=this.session._device.getBasePoseMatrix();
    const hits=this.session._device.arScene.getHitTestResults([base[12],base[13],base[14]],[-base[8],-base[9],-base[10]]);
    const roomHit=hits[0]?.point.toArray();
    const referenceWorld=reference._update();
    void result.then(anchor=>w.planeProbe.anchors.push({anchor,session:this.session,local,requested,reticle,roomHit,referenceWorld}),()=>{});
    return result;
  };
  const raf=w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame=function(callback:any) {
    return Reflect.apply(raf,this,[function(this:any,t:number,f:any) {
      const result=Reflect.apply(callback,this,[t,f]);
      if(f.session._mode!=='immersive-ar' || !w.planeReference) return result;
      const probe=w.planeProbe;probe.frames++;probe.planes=f.detectedPlanes.size;
      const scene=w.firefoxScenes?.find((e:any)=>e.scene.children.some((o:any)=>o.geometry?.type==='RingGeometry' || o.children?.some((m:any)=>m.geometry?.type==='BoxGeometry')))?.scene;
      if(!scene) return result;
      const planes=[...f.detectedPlanes];
      const objects:any[]=[];scene.traverse((o:any)=>{if(o.isMesh)objects.push(o);});
      const ring=objects.find(o=>o.geometry.type==='RingGeometry');
      probe.reticle=ring?.visible ? Array.from(ring.matrix.elements).slice(12,15) : null;
      if(probe.frames%10===0) {
        let matched=0,maxError=0;
        for(const plane of planes) {
          const pose=f.getPose(plane.planeSpace,w.planeReference);if(!pose)continue;
          const m=pose.transform.matrix;
          const mesh=objects.filter(o=>o.geometry.type!=='RingGeometry' && o.geometry.type!=='CylinderGeometry' && Math.hypot(o.matrixWorld.elements[12]-m[12],o.matrixWorld.elements[13]-m[13],o.matrixWorld.elements[14]-m[14])<1e-4).sort((a,b)=>a.matrixWorld.elements.reduce((sum:number,v:number,i:number)=>sum+Math.abs(v-m[i]),0)-b.matrixWorld.elements.reduce((sum:number,v:number,i:number)=>sum+Math.abs(v-m[i]),0))[0];
          if(!mesh)continue;
          const xs=plane.polygon.map((p:any)=>p.x),zs=plane.polygon.map((p:any)=>p.z);
          if(mesh.geometry.type==='BoxGeometry') {
            maxError=Math.max(maxError,Math.abs(mesh.geometry.parameters.width-(Math.max(...xs)-Math.min(...xs))),Math.abs(mesh.geometry.parameters.depth-(Math.max(...zs)-Math.min(...zs))));
          } else {
            const positions=mesh.geometry.getAttribute('position');
            if(positions.count!==plane.polygon.length)throw new Error('sample polygon vertex count');
            for(let i=0;i<positions.count;i++)maxError=Math.max(maxError,Math.abs(positions.getX(i)-plane.polygon[i].x),Math.abs(positions.getZ(i)-plane.polygon[i].z));
          }
          for(let i=0;i<16;i++)maxError=Math.max(maxError,Math.abs(mesh.matrixWorld.elements[i]-m[i]));matched++;
        }
        probe.alignment=[{matched,planes:planes.length,maxError,viewer:w.firefoxViewer,centers:planes.slice(0,3).map((p:any)=>Array.from(f.getPose(p.planeSpace,w.planeReference).transform.matrix).slice(12,15))}];
      }
      for(const record of probe.anchors) {
        if(record.session!==f.session)continue;
        const pose=f.getPose(record.anchor.anchorSpace,w.planeReference);
        if(pose){record.actual=Array.from(pose.transform.matrix).slice(12,15);record.world=multiply(record.referenceWorld,record.actual);}
      }
      return result;
    }]);
  };
}

export async function runPlaneApplications(driver:Driver) {
  const results:any[]=[];
  for(const [profile,device] of [['quest','Meta Quest 3'],['android','Generic Android Phone (ARCore)']]) for(const app of ['sample','three']) {
    console.log('plane application',driver.browser,profile,app);
    await driver.configure(device);
    await driver.panel(panelPose,[[0.15,1.65,0],[0,1.6,0],0]);
    if(profile==='android')await driver.panel(`window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0,1.6,-0.2);c.object.rotation.x=0;c.dispatchEvent({type:'change'});});`);
    await driver.navigate(driver.origin+(app==='sample'?'/samples/proposals/plane-detection.html':'/three/examples/webxr_ar_plane_detection.html'));
    await eventually(()=>driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`),Boolean,'pinned application ready',60000);
    await driver.evaluate(`const __name=value=>value;(${observeXR.toString()})();(${observePlanes.toString()})();const overlay=document.querySelector('#useDomOverlay');if(overlay)overlay.checked=false;`);
    await driver.clickEntry();
    await eventually(()=>driver.evaluate('return window.planeProbe'),p=>p.frames>=30 && p.planes>0 && p.alignment[0]?.matched===p.planes,'all plane meshes aligned',60000);
    const before=await driver.evaluate('return window.planeProbe.alignment[0]');
    const captures:string[]=[];
    const beforeCapture=`test-results/planes-${driver.browser}-${profile}-${app}-before.png`;await writeFile(beforeCapture,await driver.screenshot());captures.push(beforeCapture);
    console.log('alignment',JSON.stringify(before));
    assert(before.maxError<1e-4,'application geometry and pose agree with returned planes');
    const pixels=await driver.evaluate(`return (${applicationPixels.toString()})()`);
    assert.equal(pixels.regions.length,profile==='quest'?2:1);
    for(const eye of pixels.regions)assert(eye.colored>100 && eye.colors>5,'identifiable application pixels in every eye');
    const start=await driver.evaluate('return window.firefoxXR.frames');
    assert.equal(await driver.panel(panelPose,[[0,1.6,0],[0.15,1.65,0],-0.25]),1,'genuine panel viewer control');
    if(profile==='android') {
      // The phone's tracked pose is a separate panel control from its observer.
      assert.equal(await driver.panel(`let n=0;window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0.15,1.65,-0.075);c.object.rotation.x=-0.25;c.dispatchEvent({type:'change'});n++;});return n;`),1);
    }
    await eventually(()=>driver.evaluate('return {frames:window.firefoxXR.frames,alignment:window.planeProbe.alignment[0]}'),v=>v.frames>start+20 && v.alignment?.viewer?.[0]>0.14,'moved viewer reaches application');
    const moved=await driver.evaluate('return window.planeProbe.alignment[0]');
    assert(Math.hypot(...moved.viewer.map((v:number,i:number)=>v-before.viewer[i]))>0.1,'measured viewer movement');
    assert(moved.maxError<1e-4 && moved.matched===moved.planes);
    assert.deepEqual(moved.centers,before.centers,'surface geometry stays room aligned under viewer movement');
    let placement:any=null;
    if(app==='sample') {
      await eventually(()=>driver.evaluate('return window.planeProbe.reticle'),Boolean,'sample visible reticle');
      if(profile==='quest') {
        await driver.panel(`document.querySelector('#rightSelectButton').click()`);
        await eventually(()=>driver.evaluate('return window.firefoxXR.events'),events=>events.includes('selectstart'),'panel selectstart');
        await driver.panel(`document.querySelector('#rightSelectButton').click()`);
      } else {
        const point=await driver.evaluate(`let result;for(const e of window.firefoxScenes){if(!e.renderer)continue;e.scene.traverse(o=>{if(o.material?.customProgramCacheKey()!=='ar-screen-composite-v1')return;o.geometry.computeBoundingBox();const box=o.geometry.boundingBox;const p=e.camera.position.clone().set(box.min.x+(box.max.x-box.min.x)*0.5,box.min.y+(box.max.y-box.min.y)*0.5,0);o.localToWorld(p).project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();result={x:Math.round(r.left+(p.x+1)*r.width/2),y:Math.round(r.top+(1-p.y)*r.height/2)};});}return result;`);
        assert(point,'phone display selected through real screen projection');await driver.phoneSelect(point);
      }
      await eventually(()=>driver.evaluate('return window.planeProbe.anchors[0]?.actual'),Boolean,'sample select-created anchor tracked');
      placement=await driver.evaluate(`const p=window.planeProbe.anchors[0];return {local:p.local,requested:p.requested,reticle:p.reticle,actual:p.actual,world:p.world,roomHit:p.roomHit,cylinders:window.firefoxScenes.flatMap(e=>e.scene.children).filter(o=>o.geometry?.type==='CylinderGeometry').map(o=>({visible:o.visible,position:o.matrix.elements.slice(12,15)}))};`);
      assert(placement.roomHit && Math.hypot(...placement.world.map((n:number,i:number)=>n-placement.roomHit[i]))<1e-4,'sample placement matches independent original-room ray intersection');
      assert(placement.cylinders.some((c:any)=>c.visible),'original sample cylinder visible');
      assert(Math.hypot(...placement.actual.map((n:number,i:number)=>n-placement.requested[i]))<1e-4,'anchor tracks requested plane point');
      assert(Math.hypot(...placement.reticle.map((n:number,i:number)=>n-0.001-placement.requested[i]))<1e-4,'anchor agrees with measured reticle point (sample adds 1 mm per axis)');
    }
    await mkdir('test-results',{recursive:true});
    const capture=`test-results/planes-${driver.browser}-${profile}-${app}.png`;await writeFile(capture,await driver.screenshot());captures.push(capture);
    const texture=await driver.evaluate(`const s=window.firefoxSession,l=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation;return l._presentationCanvas.toDataURL()`);
    const textureFile=`test-results/planes-${driver.browser}-${profile}-${app}-application.png`;await writeFile(textureFile,Buffer.from(texture.replace(/^data:image\/png;base64,/,''),'base64'));captures.push(textureFile);
    const sessionState=await driver.evaluate(`const s=window.firefoxSession;window.planeOldSession=s;window.planeOldPlanes=[...s._environment.snapshot().planes];window.planeOldLayer=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation;return {requests:window.firefoxXR.requests.map(([mode,o])=>({mode,requiredFeatures:o.requiredFeatures,optionalFeatures:o.optionalFeatures})),views:window.firefoxXR.views,frames:window.firefoxXR.frames};`);
    await driver.evaluate('return window.firefoxSession.end()');
    const stopped=await driver.evaluate('return window.firefoxXR.frames');
    await new Promise(r=>setTimeout(r,150));
    const shutdown=await driver.evaluate(`return {frames:window.firefoxXR.frames,ends:window.firefoxXR.ends,planes:window.planeOldSession._environment.snapshot().planes.size,oldNull:window.planeOldPlanes.every(p=>p.planeSpace._update()===null),callbacks:window.planeOldSession.callbacks.size,canvasConnected:!!window.planeOldLayer._presentationCanvas?.isConnected}`);
    assert.equal(shutdown.frames,stopped);assert.equal(shutdown.ends,1);assert.equal(shutdown.planes,0);assert(shutdown.oldNull);assert.equal(shutdown.callbacks,0);assert(!shutdown.canvasConnected);
    await eventually(()=>driver.evaluate(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled)`),Boolean,'original application restart entry');
    await driver.clickEntry();
    await eventually(()=>driver.evaluate('return {frames:window.firefoxXR.frames,alignment:window.planeProbe.alignment[0]}'),v=>v.frames>stopped+30 && v.alignment?.planes>0 && v.alignment?.matched===v.alignment?.planes,'restarted application planes',60000);
    const restart=await driver.evaluate(`return {freshSession:window.firefoxSession!==window.planeOldSession,oldAbsent:window.planeOldPlanes.every(p=>!window.firefoxSession._environment.snapshot().planes.has(p)),freshInputs:[...window.firefoxSession.inputSources].every(i=>!i.gamepad||i.gamepad.buttons.every(b=>!b.pressed)),alignment:window.planeProbe.alignment[0]}`);
    assert(restart.freshSession && restart.oldAbsent && restart.freshInputs);assert(restart.alignment.maxError<1e-4);
    const restartCapture=`test-results/planes-${driver.browser}-${profile}-${app}-restart.png`;await writeFile(restartCapture,await driver.screenshot());captures.push(restartCapture);
    await driver.evaluate('return window.firefoxSession.end()');
    const finalShutdown=await driver.evaluate(`return {ends:window.firefoxXR.ends,planes:window.firefoxSession._environment.snapshot().planes.size,callbacks:window.firefoxSession.callbacks.size,presentationLayers:window.firefoxSession._webglLayers.size,canvasConnected:!!window.firefoxSession.presentation?._presentationCanvas.isConnected}`);
    assert.equal(finalShutdown.ends,2);assert.equal(finalShutdown.planes,0);assert.equal(finalShutdown.callbacks,0);assert.equal(finalShutdown.presentationLayers,0);assert(!finalShutdown.canvasConnected);
    const dependencies=await driver.evaluate(`return Promise.all(performance.getEntriesByType('resource').map(e=>e.name).filter(url=>url.startsWith('https://unpkg.com/three@0.127.0/') || url.includes('c684bbda37e44099c273c3e5274fae6fccee293c')).filter((url,i,urls)=>urls.indexOf(url)===i).map(async url=>{const response=await fetch(url,{cache:'force-cache'}),bytes=await response.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);return {url,status:response.status,bytes:bytes.byteLength,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),evidence:'browser force-cache reread of immutable pinned dependency'};}));`);
    const result={profile,device,app,dependencies,before,moved,pixels,placement,captures,sessionState,shutdown,restart,finalShutdown};results.push(result);
    await writeFile(`test-results/planes-applications-${driver.browser}-progress.json`,JSON.stringify(results,null,2));
  }
  return results;
}
