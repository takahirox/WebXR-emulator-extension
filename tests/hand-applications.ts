import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serveFirefoxFixtures, revisions} from './firefox-upstream';
import {trackingBrowser} from './tracking-browser';
import {eventually} from './firefox-driver';

/** Preserve every original call/result/exception. Observe the application's
 * own WebXRController joints and XRHandPrimitiveModel instance matrices after
 * its rendering callback, without replacing geometry, material or app logic. */
function observeHands() {
  const w=window as any;
  const probe=w.handProbe={frames:0,calls:0,sessionFrames:0,hands:[] as any[],errors:[] as string[]};
  const consumed=new Map<any,any>();
  const original=w.XRFrame.prototype.getJointPose;
  w.XRFrame.prototype.getJointPose=function(...args:any[]) {
    const result=Reflect.apply(original,this,args) as any;
    if(result)consumed.set(args[0],{matrix:Array.from(result.transform.matrix),radius:result.radius});
    probe.calls++;
    return result;
  };
  const raf=w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame=function(callback:any) {
    return Reflect.apply(raf,this,[function(this:any,t:number,f:any) {
      const result=Reflect.apply(callback,this,[t,f]);
      if(f.session._mode!=='immersive-vr')return result;
      probe.frames++;
      const entry=w.firefoxScenes.find((e:any)=>e.renderer?.xr?.isPresenting);
      if(!entry)return result;
      const hands:any[]=[];
      entry.scene.traverse((model:any)=>{
        if(!model.xrInputSource?.hand||!model.motionController?.handMesh)return;
        const source=model.xrInputSource,controller=model.controller,motion=model.motionController,mesh=motion.handMesh;
        const hand:any={handedness:source.handedness,count:mesh.count,visible:controller.visible,geometry:mesh.geometry.type,joints:[],maxMatrixError:0,maxRadiusError:0,maxInstanceError:0};
        for(const name of motion.joints) {
          const space=source.hand.get(name),api=consumed.get(space),joint=controller.joints[name];
          if(!api||!joint){probe.errors.push('missing consumed joint '+name);continue;}
          const index=motion.joints.indexOf(name),instance=Array.from(mesh.instanceMatrix.array.slice(index*16,index*16+16)) as number[];
          hand.maxMatrixError=Math.max(hand.maxMatrixError,...api.matrix.map((v:number,i:number)=>Math.abs(v-joint.matrix.elements[i])));
          hand.maxRadiusError=Math.max(hand.maxRadiusError,Math.abs(api.radius-joint.jointRadius));
          const expected=joint.matrix.elements.map((v:number,i:number)=>i<12?v*api.radius:v);
          hand.maxInstanceError=Math.max(hand.maxInstanceError,...expected.map((v:number,i:number)=>Math.abs(v-instance[i])));
          hand.joints.push({name,radius:api.radius,matrix:api.matrix,instance,visible:joint.visible});
        }
        hands.push(hand);
      });
      probe.hands=hands;probe.sessionFrames=f.session===w.handLastSession?(probe.sessionFrames??0)+1:1;w.handLastSession=f.session;
      return result;
    }]);
  };
}

/** Presentation canvas readback, with each eye's actual subcamera projection.
 * Count bright sphere pixels near the original instances, and changed pixels
 * across the whole eye. Retain only bounded summaries in the report. */
function handPixels() {
  const w=window as any,s=w.firefoxSession,l=s.renderState.baseLayer??s.renderState.layers[0]._binding._presentation,c=l._presentationCanvas;
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  const entry=w.firefoxScenes.find((e:any)=>e.renderer?.xr?.isPresenting),cameras=entry.renderer.xr.getCamera().cameras;
  const previous=w.handPixelPrevious;w.handPixelPrevious=new Uint8ClampedArray(data);
  const apply=(m:number[],p:number[])=>[0,1,2,3].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]*p[3]);
  const regions=cameras.map((camera:any,eye:number)=>{
    const width=c.width/2;let bright=0,changed=0;
    for(let y=30;y<c.height;y++)for(let x=eye*width;x<(eye+1)*width;x++) {
      const i=(y*c.width+x)*4;
      if(data[i]>230&&data[i+1]>230&&data[i+2]>230)bright++;
      if(previous&&[0,1,2].some(n=>Math.abs(data[i+n]-previous[i+n])>5))changed++;
    }
    const hands=w.handProbe.hands.map((h:any)=>{
      let pixels=0;const locations:any[]=[];
      for(const joint of h.joints) {
        const view=apply(camera.matrixWorldInverse.elements,[...joint.matrix.slice(12,15),1]);
        const clip=apply(camera.projectionMatrix.elements,view);
        const x=Math.round(eye*width+(clip[0]/clip[3]+1)*width/2),y=Math.round((1-clip[1]/clip[3])*c.height/2);
        const radius=Math.max(2,Math.ceil(Math.abs(camera.projectionMatrix.elements[5]*joint.radius/view[2])*c.height/2));
        let near=0;
        for(let py=Math.max(30,y-radius);py<Math.min(c.height,y+radius+1);py++)for(let px=Math.max(eye*width,x-radius);px<Math.min((eye+1)*width,x+radius+1);px++){
          const i=(py*c.width+px)*4;if(data[i]>230&&data[i+1]>230&&data[i+2]>230)near++;
        }
        pixels+=near;locations.push({joint:joint.name,x,y,radius,bright:near});
      }
      return {handedness:h.handedness,brightNearJoints:pixels,locations};
    });
    return {eye:eye===0?'left':'right',bright,changed,hands};
  });
  return {width:c.width,height:c.height,connected:c.isConnected,regions,png:c.toDataURL()};
}

const browser=process.argv[2];assert(['chromium','firefox'].includes(browser));
const {origin,server,provenance}=await serveFirefoxFixtures();
const report:any={issue:61,browser,status:'running',startedAt:new Date().toISOString(),command:`npm run test:hand-applications:${browser}`,revisions,failures:[],skips:[],cycles:[],instrumentation:[
  'Unchanged upstream handinput HTML and all Three.js modules served byte-for-byte at the pinned revision. No application/dependency logic changes.',
  'Existing Three.js devtools observe event and original scene.onBeforeRender; request/frame/joint-pose wrappers preserve receivers, arguments, results and exceptions. Post-render inspection of both original hand joint groups, sphere instance transforms/radii and presentation canvas pixels projected separately in both eyes.',
  'Genuine unpacked extension and DevTools panel. Panel reset, stereo/Quest VR selection, retained TransformControls movement and real panel trigger clicks. No synthetic XR adapter, clocks, GL or production test API.',
],coverage:'Quest VR immersive-vr only. Unchanged VRButton does not request Quest MR immersive-ar.',unperformed:['optional popup borrowing','additional hand consumer','physical hardware','full suites']};
await mkdir('test-results',{recursive:true});let b:Awaited<ReturnType<typeof trackingBrowser>>|undefined;
const filename=`test-results/hand-applications-${browser}.json`;
const expression=(f:Function)=>`const __name=value=>value;return (${f.toString()})();`;
const delta=(a:number[],c:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-c[i])));
try {
  b=await trackingBrowser(browser,origin);report.versions=b.versions;
  await b.panel(`document.querySelector('#resetPoseButton').click();`);
  report.settings=await b.panel(`return {device:document.querySelector('#deviceSelect').value,mode:document.querySelector('#questModeSelect').value,stereo:document.querySelector('#stereoCheckbox').checked,overlay:document.querySelector('#domOverlayPreviewCheckbox').checked}`);
  assert.deepEqual(report.settings,{device:'Meta Quest 3',mode:'immersive-vr',stereo:true,overlay:false});
  await b.navigate(origin+'/three/examples/webxr_vr_handinput.html');
  await eventually(()=>b!.evaluate('return !!window.tracking&&!!document.querySelector("#VRButton")'),Boolean,'original hand example ready',60000);
  await b.evaluate(expression(observeHands));
  const controls=await b.panel(`const reset={right:[.5,1.5,-1],left:[-.5,1.5,-1]},all=[];window.firefoxScenes[0].scene.traverse(o=>{if(o.controls?.object&&o.controls.getHelper()===o)all.push(o.controls)});window.handControls={};return Object.fromEntries(Object.entries(reset).map(([hand,p])=>{const found=all.filter(c=>c.object.position.toArray().every((v,i)=>Math.abs(v-p[i])<.001));window.handControls[hand]=found[0];return [hand,found.length]}));`);
  assert.deepEqual(controls,{right:1,left:1});
  const current=()=>b!.evaluate<any>('return window.handProbe');
  const ready=(p:any)=>p.sessionFrames>12&&p.hands.length===2&&p.hands.every((h:any)=>h.count===25&&h.joints.length===25&&h.visible&&h.geometry==='SphereGeometry'&&h.maxMatrixError<1e-5&&h.maxRadiusError<1e-8&&h.maxInstanceError<1e-5&&h.joints.every((j:any)=>j.visible&&j.radius>0));
  async function capture(label:string) {
    const p=await current();assert(ready(p),JSON.stringify(p));assert.deepEqual(p.errors,[]);
    const pixels:any=await b!.evaluate(expression(handPixels));assert(pixels.connected&&pixels.regions.length===2);
    for(const eye of pixels.regions)for(const hand of eye.hands)assert(hand.brightNearJoints>10,'sphere pixels near '+hand.handedness+' joints in '+eye.eye+': '+JSON.stringify(eye));
    const file=`test-results/hands-${browser}-${label}.png`,presentation=file.replace('.png','-application.png');
    await writeFile(file,await b!.screenshot());const bytes=Buffer.from(pixels.png.replace(/^data:image\/png;base64,/,''),'base64');await writeFile(presentation,bytes);delete pixels.png;
    return {label,probe:p,pixels,textureSHA256:createHash('sha256').update(bytes).digest('hex'),captures:[file,presentation]};
  }
  async function pose(hand:string,position:number[],yaw=0,pitch=0) {
    const before=await current();await b!.panel(`const c=window.handControls[arguments[0]];c.object.position.fromArray(arguments[1]);c.object.rotation.set(arguments[3],arguments[2],0);c.dispatchEvent({type:'change'});`,[hand,position,yaw,pitch]);
    await eventually(current,p=>ready(p)&&p.frames>before.frames+12&&p.hands.find((h:any)=>h.handedness===hand)?.joints[0].matrix.slice(12,15).every((v:number,i:number)=>Math.abs(v-position[i])<1e-4),'panel movement consumed by original hand example',60000);
  }
  for(let cycle=0;cycle<2;cycle++) {
    console.log('hand application',browser,'cycle',cycle);
    await b.click('ENTER VR');await eventually(current,ready,'both original sphere models consume 25 joints',60000);
    if(cycle)assert(await b.evaluate(`return window.firefoxSession!==window.handOldSession && [...window.firefoxSession.inputSources].every(s=>[...s.hand.values()].every(j=>!window.handOldJoints.includes(j)))`),'restart replaces session and all joint identities');
    await pose('right',[.22,1.4,-.65]);await pose('left',[-.22,1.4,-.65]);
    const result:any={cycle,states:[]};report.cycles.push(result);
    result.states.push(await capture(`${cycle}-before`));
    for(const hand of ['right','left']) {
      const before=await current(),other=hand==='right'?'left':'right';
      await pose(hand,[hand==='right'?.32:-.32,1.43,-.6],hand==='right'?.2:-.2,-.15);
      const after=await current();
      assert(delta(before.hands.find((h:any)=>h.handedness===hand).joints[9].matrix,after.hands.find((h:any)=>h.handedness===hand).joints[9].matrix)>.01);
      assert(delta(before.hands.find((h:any)=>h.handedness===other).joints[9].matrix,after.hands.find((h:any)=>h.handedness===other).joints[9].matrix)<1e-5,'other hand independent');
      const moved=await capture(`${cycle}-${hand}-moved`);assert(moved.pixels.regions.every((r:any)=>r.changed>5),'movement changes actual pixels in both eyes');result.states.push(moved);
      await b.panel(`document.querySelector('#'+arguments[0]+'SelectButton').click();`,[hand]);
      await eventually(current,p=>ready(p)&&p.frames>after.frames+12&&delta(p.hands.find((h:any)=>h.handedness===hand).joints[9].matrix,after.hands.find((h:any)=>h.handedness===hand).joints[9].matrix)>.01,'trigger curl consumed',60000);
      const curled=await capture(`${cycle}-${hand}-curled`);assert(curled.pixels.regions.every((r:any)=>r.changed>5),'curl changes actual pixels in both eyes');
      assert(delta(curled.probe.hands.find((h:any)=>h.handedness===other).joints[9].matrix,after.hands.find((h:any)=>h.handedness===other).joints[9].matrix)<1e-5,'other hand independent of curl');result.states.push(curled);
      await b.panel(`document.querySelector('#'+arguments[0]+'SelectButton').click();`,[hand]);await eventually(current,p=>ready(p)&&p.frames>curled.probe.frames+12,'trigger release observed');
    }
    result.request=await b.evaluate('return window.tracking.sessions.at(-1)');
    assert.equal(result.request.mode,'immersive-vr');assert(result.request.options.requiredFeatures.includes('hand-tracking'));assert(result.request.enabled.includes('hand-tracking'));
    await b.evaluate(`window.handOldSession=window.firefoxSession;window.handOldJoints=[...window.firefoxSession.inputSources].flatMap(s=>[...s.hand.values()]);window.handOldCanvas=(window.firefoxSession.renderState.baseLayer??window.firefoxSession.renderState.layers[0]._binding._presentation)._presentationCanvas;`);
    await b.click('STOP|EXIT');await eventually(()=>b!.evaluate('return window.handOldSession.ended'),Boolean,'original VRButton end');
    const stopped=await current();await new Promise(r=>setTimeout(r,150));
    result.shutdown=await b.evaluate(`return {frames:window.handProbe.frames,callbacks:window.handOldSession.callbacks.size,layers:window.handOldSession._webglLayers.size,canvasConnected:!!window.handOldCanvas.isConnected,oldNull:window.handOldJoints.every(j=>j._update()===null),ends:window.tracking.sessions.at(-1).ends}`);
    assert.equal(result.shutdown.frames,stopped.frames);assert.equal(result.shutdown.callbacks,0);assert.equal(result.shutdown.layers,0);assert(!result.shutdown.canvasConnected&&result.shutdown.oldNull);assert.equal(result.shutdown.ends,1);
    if(cycle===0)await b.panel(`document.querySelector('#resetPoseButton').click();`);
    await writeFile(filename,JSON.stringify(report,null,2));
  }
  assert.deepEqual(await b.evaluate('return window.tracking.failures'),[]);
  report.runtimeErrors=b.logs.filter((v:any)=>v.level==='error');assert.deepEqual(report.runtimeErrors,[]);
  report.network=b.network;
  report.restoration=await b.panel(`for(const id of ['rightSelectButton','leftSelectButton']){const e=document.getElementById(id);if(e.classList.contains('pressed'))e.click();}document.querySelector('#resetPoseButton').click();return {buttonsReleased:['rightSelectButton','leftSelectButton'].every(id=>!document.getElementById(id).classList.contains('pressed')),posesReset:Object.entries(window.handControls).every(([hand,c])=>c.object.position.toArray().every((v,i)=>Math.abs(v-(hand==='right'?[.5,1.5,-1]:[-.5,1.5,-1])[i])<.001))};`);
  assert(report.restoration.buttonsReleased&&report.restoration.posesReset,'controlled panel state restored');
  report.status='passed';
} catch(error) {report.status='failed';report.failures.push(String(error));throw error;}
finally {
  if(b){await b.evaluate(`if(window.firefoxSession&&!window.firefoxSession.ended)return window.firefoxSession.end();`).catch(()=>{});await b.panel(`for(const id of ['rightSelectButton','leftSelectButton']){const e=document.getElementById(id);if(e?.classList.contains('pressed'))e.click();}document.querySelector('#resetPoseButton').click();`).catch(()=>{});await b.close();report.cleanup=b.cleanup;}
  server.close();report.servedSources=[...provenance.values()];report.sourceHashes={};
  for(const file of ['src/polyfill/api/hand-allocation.ts','src/polyfill/api/sensing.ts','src/polyfill/api/runtime.ts','src/polyfill/api/interface-brand.ts','src/polyfill/api/geometry.ts','src/polyfill/api/bulk-input.ts','src/polyfill/api/session-init.ts','src/polyfill/ARScene.ts','src/polyfill/DOMOverlay.ts', 'src/polyfill/EmulatedXRDevice.ts','src/polyfill/CustomWebXRPolyfill.ts','tests/hand-applications.ts','tests/tracking-browser.ts','tests/tracking-observation.ts','tests/firefox-upstream.ts','tests/firefox-scenes.js','polyfill/webxr-polyfill.js','build/firefox/polyfill/webxr-polyfill.js','package.json','package-lock.json'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  report.completedAt=new Date().toISOString();await writeFile(filename,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,browser,cycles:report.cycles.length,failures:report.failures,cleanup:report.cleanup}));
}
