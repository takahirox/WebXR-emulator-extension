import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {launchFirefox, eventually} from './firefox-driver';

import {serveFirefoxFixtures} from './firefox-upstream';
import {runFirefoxContract, configure, panelPose, activate} from './firefox-contract';
import {observeXR, applicationPixels, presentedPixels} from './firefox-observation';
const {origin, server, provenance} = await serveFirefoxFixtures();
const report: Record<string, any> = {status:'running',startedAt:new Date().toISOString(),results:[]};
await mkdir('test-results',{recursive:true});
await writeFile('test-results/firefox-applications.json',JSON.stringify(report,null,2));
let firefox: Awaited<ReturnType<typeof launchFirefox>> | undefined;
try {
  firefox = await launchFirefox();
  report.versions=firefox.versions;
  console.log('versions', firefox.versions);
  await firefox.bidi('script.addPreloadScript', {functionDeclaration: (await readFile('tests/firefox-scenes.js', 'utf8')) + '\n'});
  await firefox.navigate(origin + '/csp');
  console.log('startup', await firefox.evaluate('return window.smoke?.state'));
  await firefox.openPanel();
  console.log('panel',await firefox.panel(`return {url:location.href, tab:window.chrome.devtools.inspectedWindow.tabId, probe:!!window.firefoxScenes?.length};`));
  console.log('contract checks');
  const contract=report.contract=await runFirefoxContract(firefox,origin);
  console.log('contract',JSON.stringify(contract));
  const results=report.results;
  for (const [profile, device, mode, app] of [
    ['quest-vr','Meta Quest 3','immersive-vr','/samples/immersive-vr-session.html'],
    ['quest-vr','Meta Quest 3','immersive-vr','/three/examples/webxr_xr_ballshooter.html'],
    ['quest-mr','Meta Quest 3','immersive-ar','/samples/hit-test.html'],
    ['quest-mr','Meta Quest 3','immersive-ar','/three/examples/webxr_ar_hittest.html'],
    ['android-ar','Generic Android Phone (ARCore)','immersive-ar','/samples/hit-test.html'],
    ['android-ar','Generic Android Phone (ARCore)','immersive-ar','/three/examples/webxr_ar_hittest.html'],
  ]) {
    console.log('scenario',profile,app);
    const logStart=firefox.logs.length;
    await configure(firefox,device,mode);
    await firefox.navigate(origin+app);
    await firefox.evaluate(`(${observeXR.toString()})()`);
    await eventually(()=>firefox!.evaluate(`return [...document.querySelectorAll('button')].filter(b=>!b.disabled).map(b=>b.textContent)`), value=>(value as string[]).some(text=>/START|ENTER/.test(text)), 'application entry button',60000);
    const button=await firefox.evaluate(`return [...document.querySelectorAll('button')].find(b=>/START|ENTER/.test(b.textContent) && !b.disabled);`);
    await firefox.request('POST',`/element/${(button as Record<string,string>)['element-6066-11e4-a52e-4f735466cecf']}/click`,{});
    await eventually(()=>firefox!.evaluate<number>(`return window.firefoxXR.frames`),n=>n>=30,'30 application frames',60000);
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(mode==='immersive-ar') await eventually(()=>firefox!.evaluate<number>('return window.firefoxXR.hits'),n=>n>0,'room hit');
    const reticlePixels=mode==='immersive-ar'?await firefox.evaluate<ReturnType<typeof applicationPixels>>(`return (${applicationPixels.toString()})()`):null;
    if(reticlePixels)assert(reticlePixels.regions.every(r=>r.colored>0),'application reticle renders before selection');
    if(app==='/samples/hit-test.html') console.log('clone observer',await firefox.bidi('script.evaluate',{expression:`import(${JSON.stringify(origin+'/samples/js/render/core/node.js')}).then(({Node})=>{window.firefoxPlacements=0;const clone=Node.prototype.clone;Node.prototype.clone=function(...args){const result=Reflect.apply(clone,this,args);window.firefoxPlacements++;return result;};return true;})`,target:{context:await firefox.request('GET','/window')},awaitPromise:true}));
    if(app.includes('ballshooter')) {
      assert.equal(await firefox.panel(panelPose,[[0,1.6,0],[0.15,1.65,0]]),1);
      assert.equal(await firefox.panel(panelPose,[[0.5,1.5,-1],[0.7,1.4,-0.8]]),1);
      await eventually(()=>firefox!.evaluate<any>(`return {viewer:window.firefoxViewer,device:Array.from(window.firefoxSession._device.position),frames:window.firefoxXR.frames,ended:window.firefoxSession.ended,visibility:document.visibilityState,requests:window.firefoxXR.requests}`),p=>Math.abs(p.viewer[0]-0.15)<0.001,'ballshooter viewer pose');
      const observed: {type:string}=await firefox.bidi<{type:string}>('script.evaluate',{expression:`import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3').then(({default:R})=>{window.firefoxShots=[];const original=R.RigidBody.prototype.setTranslation;R.RigidBody.prototype.setTranslation=function(...args){const result=Reflect.apply(original,this,args);window.firefoxShots.push([args[0].x,args[0].y,args[0].z]);return result;};return true;})`,target:{context:await firefox.request('GET','/window')},awaitPromise:true});
      assert.equal(observed.type,'success','observe the original Rapier dependency in the application realm');
    }
    if(profile==='android-ar') {
      assert.equal(await firefox.panel(`let moved=0;window.firefoxScenes[0].scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o||c.object.children[0]?.geometry?.type!=='BoxGeometry'||c.object.position.z>=0)return;c.object.position.set(0,1.6,-0.075);c.dispatchEvent({type:'change'});moved++;});return moved;`),1,'move actual phone for a legible presented view');
      await new Promise(resolve=>setTimeout(resolve,100));
      const point=await firefox.evaluate<{x:number;y:number}>(`let result;for(const e of window.firefoxScenes){if(!e.renderer)continue;e.scene.traverse(o=>{if(o.material?.customProgramCacheKey()!=='ar-screen-composite-v1')return;const box=o.geometry.boundingBox || (o.geometry.computeBoundingBox(),o.geometry.boundingBox);const p=e.camera.position.clone().set(box.min.x+(box.max.x-box.min.x)*0.3,box.min.y+(box.max.y-box.min.y)*0.65,0);o.localToWorld(p).project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();result={x:Math.round(r.left+(p.x+1)*r.width/2),y:Math.round(r.top+(1-p.y)*r.height/2)};});}return result;`);
      assert(point,'phone screen in actual rendered scene');
      await firefox.request('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:100,origin:'viewport',...point},{type:'pointerDown',button:2},{type:'pause',duration:150},{type:'pointerUp',button:2}]}]});
    } else {
      await firefox.panel(`document.querySelector('#rightSelectButton').click()`);
      await eventually(()=>firefox!.evaluate<string[]>('return window.firefoxXR.events'),e=>e.includes('selectstart'),'selectstart');
      if(app.includes('ballshooter')) await eventually(()=>firefox!.evaluate<number[][]>('return window.firefoxShots'),shots=>shots.some(p=>Math.abs(p[0]-0.7)<0.001 && Math.abs(p[2]+0.8)<0.001),'ballshooter fires from moved controller');
      await firefox.panel(`document.querySelector('#rightSelectButton').click()`);
    }
    if(app==='/samples/hit-test.html') await eventually(()=>firefox!.evaluate<number>('return window.firefoxPlacements'),n=>n>0,'sample flower placement');
    if(app.includes('webxr_ar_hittest')) await eventually(()=>firefox!.evaluate<number>(`return window.firefoxScenes.reduce((n,e)=>n+e.scene.children.filter(o=>o.geometry?.type==='CylinderGeometry').length,0)`),n=>n>0,'Three cylinder placement');
    const inputEffect: unknown=await firefox.evaluate(`return {sampleCloneCalls:window.firefoxPlacements??null,cylinders:window.firefoxScenes.reduce((n,e)=>n+e.scene.children.filter(o=>o.geometry?.type==='CylinderGeometry').length,0),shots:window.firefoxShots?.slice(0,3)??null,viewer:window.firefoxViewer};`);
    const pixels: ReturnType<typeof applicationPixels>=await firefox.evaluate<ReturnType<typeof applicationPixels>>(`return (${applicationPixels.toString()})()`);
    assert.equal(pixels.layer,app.includes('three')?'projection':'base');
    assert.equal(pixels.regions.length,profile==='android-ar'?1:2);
    for(const region of pixels.regions) {assert(region.width>0&&region.height>0&&region.colored>0,'positive view and rendered application pixels');if(mode==='immersive-ar')assert(region.transparent>0,'AR texture retains transparent regions');else assert(region.colors>100,'identifiable VR scene color variation');}
    const presented: any=await firefox.evaluate<any>(`const __name=value=>value;return (${presentedPixels.toString()})()`);
    console.log('presented',JSON.stringify(presented));
    if(Array.isArray(presented)) for(const eye of presented){if(profile==='android-ar')assert(eye.foregroundContrast>=12&&eye.correlation>0,'resampled application foreground reaches the phone display');else assert(eye.difference<=2,'opaque application texel reaches both MR eyes');assert(eye.room[3]===255&&eye.room.slice(0,3).some((v:number)=>v>30),'transparent texel retains the virtual room');}else assert(presented.connected&&presented.width>0&&presented.height>0,'VR output is actually presented');
    const probe: any=await firefox.evaluate<any>(`return {...window.firefoxXR,enabledFeatures:[...window.firefoxSession.enabledFeatures],requests:window.firefoxXR.requests.map(([mode,options])=>({mode,requiredFeatures:options?.requiredFeatures??[],optionalFeatures:options?.optionalFeatures??[],depthSensing:options?.depthSensing??null,domOverlayRoot:options?.domOverlay?.root?.tagName??null}))};`);
    console.log('result',JSON.stringify({profile,app,pixels,presented,inputEffect,probe}));
    await writeFile(`test-results/firefox-${profile}-${app.includes('three')?'three':'sample'}.png`,Buffer.from(await firefox.request<string>('GET','/screenshot'),'base64'));
    assert(probe.frames>=30);
    assert.deepEqual(probe.views.map((v:any)=>v.eye),profile==='android-ar'?['none']:['left','right']);
    assert(probe.views.every((v:any)=>v.width>0&&v.height>0));
    assert(probe.inputModes.every((m:string)=>m===(profile==='android-ar'?'screen':'tracked-pointer')));
    assert.deepEqual(probe.events,['selectstart','select','selectend']);
    assert(!probe.enabledFeatures.includes('dom-overlay'));
    if(app.includes('ballshooter'))assert(!probe.enabledFeatures.includes('depth-sensing'));
    const logs: typeof firefox.logs=firefox.logs.slice(logStart);
    assert.deepEqual(logs.filter(entry=>entry.level==='error'),[],'no application runtime errors');
    const result: any={profile,app,reticlePixels,pixels,presented,inputEffect,probe,logs};
    results.push(result);
    await firefox.evaluate(`return window.firefoxSession.end()`);
    const endedFrames: number=await firefox.evaluate<number>('return window.firefoxXR.frames');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await firefox.evaluate('return window.firefoxXR.ends'),1);
    assert.equal(await firefox.evaluate('return window.firefoxXR.frames'),endedFrames,'application end stops XR callbacks');
    result.shutdown={endEvents:1,frames:endedFrames,callbacksStopped:true};
    await eventually(()=>firefox!.evaluate<boolean>(`return [...document.querySelectorAll('button')].some(b=>/START|ENTER/.test(b.textContent)&&!b.disabled);`),Boolean,'application restart button');
    const restartButton: Record<string,string>=await firefox.evaluate(`return [...document.querySelectorAll('button')].find(b=>/START|ENTER/.test(b.textContent)&&!b.disabled);`);
    await firefox.request('POST',`/element/${restartButton['element-6066-11e4-a52e-4f735466cecf']}/click`,{});
    await eventually(()=>firefox!.evaluate<number>('return window.firefoxXR.frames'),n=>n>=endedFrames+30,'30 restarted application frames');
    assert(await firefox.evaluate(`return [...window.firefoxSession.inputSources].every(i=>!i.gamepad||i.gamepad.buttons.every(b=>!b.pressed))`),'restart has no stale pressed inputs');
    if(profile==='android-ar')assert.equal(await firefox.evaluate('return window.firefoxSession.inputSources.length'),0,'restart has no stale transient source');
    result.restart={frames:await firefox.evaluate<number>('return window.firefoxXR.frames')-endedFrames,freshInputs:true};
    await firefox.evaluate('return window.firefoxSession.end()');
    assert.equal(await firefox.evaluate('return window.firefoxXR.ends'),2,'each session ends once');

  }
  await firefox.navigate(origin+'/csp');
  await activate(firefox,`return window.smoke.start('immersive-ar')`);
  await eventually(()=>firefox!.evaluate<number>('return window.smoke.state.frames'),n=>n>=3,'unload presentation');
  await firefox.uninstall();
  await eventually(()=>firefox!.evaluate<boolean>('return window.smoke.state.ended'),Boolean,'extension unload ends presentation',7000);
  const unloadFrames: number=await firefox.evaluate<number>('return window.smoke.state.frames');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await firefox.evaluate('return window.smoke.state.frames'),unloadFrames,'unload stops callbacks');
  report.extensionUnload={ended:true,frames:unloadFrames,callbacksStopped:true};
  console.log('unload passed');
  report.status='passed';
} catch(error) {report.status='failed';report.failure=String(error);throw error;}
finally {
  await firefox?.close();server.close();
  report.cleanup=firefox?.cleanup;
  report.provenance=[...provenance.values()];
  report.browserFetches=firefox?.network;
  report.completedAt=new Date().toISOString();
  const wasPassed=report.status==='passed';
  if(wasPassed&&!Object.values(firefox!.cleanup).every(Boolean)){report.status='failed';report.failure='Incomplete browser/driver/profile/addon cleanup';}
  await writeFile('test-results/firefox-applications.json',JSON.stringify(report,null,2));
  if(wasPassed) assert(Object.values(firefox!.cleanup).every(Boolean),'browser, driver, profile and temporary addon cleanup');
}
