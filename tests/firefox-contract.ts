import assert from 'node:assert/strict';
import {observeXR} from './firefox-observation';
import {eventually, type launchFirefox} from './firefox-driver';

type Firefox = Awaited<ReturnType<typeof launchFirefox>>;
export async function activate(firefox: Firefox, script: string, args: unknown[] = []) {
  await firefox.evaluate(`const b=document.createElement('button');b.id='firefox-activate';b.textContent='Run XR check';b.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';b.onclick=()=>{window.firefoxAction=(async()=>{${script}})();b.remove();};document.body.append(b);`,args);
  const element = await firefox.request<Record<string, string>>('POST','/element',{using:'css selector',value:'#firefox-activate'});
  await firefox.request('POST',`/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`,{});
  return firefox.evaluate('return window.firefoxAction');
}
export async function configure(firefox: Firefox, device: string, mode: string) {
  await firefox.panel(`const d=document.querySelector('#deviceSelect');d.value=arguments[0];d.dispatchEvent(new Event('change'));const m=document.querySelector('#questModeSelect');m.value=arguments[1];m.dispatchEvent(new Event('change'));`, [device,mode]);
  await eventually(()=>firefox.panel<{deviceKey: string; questMode: string}>(`return window.browser.storage.local.get('webxr-extension').then(r=>JSON.parse(r['webxr-extension'] || '{"deviceKey":"Meta Quest 3","questMode":"immersive-vr"}'));`), value=>value?.deviceKey===device && value.questMode===mode,'saved selected configuration');


}
export const panelPose = `const scene=window.firefoxScenes[0].scene;let i=0;scene.traverse(o=>{const c=o.controls;if(!c?.object||c.getHelper()!==o)return;const p=c.object.position;if(Math.abs(p.x-arguments[0][0])>0.001||Math.abs(p.y-arguments[0][1])>0.001||Math.abs(p.z-arguments[0][2])>0.001)return;c.object.position.fromArray(arguments[1]);c.object.rotation.x=arguments[2]??0;c.dispatchEvent({type:'change'});i++;});return i;`;

export async function runFirefoxContract(firefox: Firefox, origin: string) {
  const passed: string[]=[];
  function check(value: unknown, name: string) {assert(value,name);passed.push(name);console.log('pass',name);}
  await configure(firefox,'Meta Quest 3','immersive-vr');
  await firefox.navigate(origin+'/csp');
  const startup=await firefox.evaluate<any>('return window.smoke.state');
  check(startup.synchronousXR && startup.synchronousGlobals && startup.overridesNativeXR,'first-script XR globals and navigator under restrictive CSP');
  check(startup.startupSessionError==='SecurityError','fresh immersive request without activation rejects SecurityError');
  check(await firefox.evaluate(`return !window.chrome?.runtime?.id`),'page cannot access privileged extension APIs');
  for (const [device,mode] of [['Meta Quest 3','immersive-vr'],['Meta Quest 3','immersive-ar'],['Generic Android Phone (ARCore)','immersive-ar']]) {
    await configure(firefox,device,mode);
    await firefox.navigate(origin+'/csp');
    const support=await firefox.evaluate(`return Promise.all(['inline','immersive-vr','immersive-ar'].map(m=>navigator.xr.isSessionSupported(m)))`);
    assert.deepEqual(support,[true,mode==='immersive-vr',mode==='immersive-ar']);passed.push(`${device} ${mode}: mode support`);
    const inline=await firefox.evaluate(`return (async()=>{const s=await navigator.xr.requestSession('inline');const c=document.createElement('canvas'),g=c.getContext('webgl');await g.makeXRCompatible();s.updateRenderState({baseLayer:new XRWebGLLayer(s,g)});const r=await s.requestReferenceSpace('viewer');const eyes=await new Promise(resolve=>s.requestAnimationFrame((t,f)=>resolve(f.getViewerPose(r).views.map(v=>v.eye))));await s.end();return eyes;})()`);
    assert.deepEqual(inline,['none']);passed.push(`${device} ${mode}: real inline animation and mono view`);
    const unavailable=mode==='immersive-vr'?'immersive-ar':'immersive-vr';
    const negotiation=await activate(firefox,`const outcomes=[];for(const [m,options] of [[${JSON.stringify(unavailable)},{}],[${JSON.stringify(mode)},{requiredFeatures:['unknown-firefox-test-feature']}],[${JSON.stringify(mode)},{optionalFeatures:['unknown-firefox-test-feature']}]]){try{const s=await navigator.xr.requestSession(m,options);outcomes.push(!s.enabledFeatures.includes('unknown-firefox-test-feature'));await s.end();}catch(e){outcomes.push(e.name);}}return outcomes;`);
    assert.deepEqual(negotiation,['NotSupportedError','NotSupportedError',true]);passed.push(`${device} ${mode}: unavailable mode/required feature rejection and optional omission with activation`);
  }
  await configure(firefox,'Meta Quest 3','immersive-vr');
  await firefox.navigate(origin+'/csp');
  await firefox.evaluate(`window.bridge=[];window.addEventListener('webxr-pose',e=>window.bridge.push(Array.from(e.detail.position)));const f=document.createElement('iframe');f.src='/frame';document.body.append(f);return new Promise(resolve=>f.onload=()=>resolve(true));`);
  check(await firefox.evaluate(`return !!document.querySelector('iframe').contentWindow.smoke.state.synchronousXR`),'injected child frame first-script XR');
  await firefox.evaluate(`const w=document.querySelector('iframe').contentWindow;w.bridge=[];w.addEventListener('webxr-pose',e=>w.bridge.push(Array.from(e.detail.position)));`);
  const inspected=await firefox.request<string>('GET','/window');
  const other=await firefox.request<{handle:string}>('POST','/window/new',{type:'tab'});
  await firefox.request('POST','/window',{handle:other.handle});await firefox.navigate(origin+'/csp');
  await firefox.evaluate(`window.bridge=[];window.addEventListener('webxr-pose',e=>window.bridge.push(Array.from(e.detail.position)));`);
  check(await firefox.panel<number>(panelPose,[[0,1.6,0],[0.2,1.7,-0.1]])===1,'real panel TransformControls moves viewer');
  await firefox.request('POST','/window',{handle:inspected});
  await eventually(()=>firefox.evaluate<any>(`return {main:window.bridge,child:document.querySelector('iframe').contentWindow.bridge}`),v=>v.main.some((p:number[])=>p[0]===0.2)&&v.child.some((p:number[])=>p[0]===0.2),'panel routes to inspected tab and injected frame');
  passed.push('cloneInto pose bridge reaches inspected page and injected child');
  await firefox.request('POST','/window',{handle:other.handle});
  check((await firefox.evaluate<unknown[]>('return window.bridge')).length===0,'panel input isolated from another tab');
  await firefox.request('DELETE','/window');await firefox.request('POST','/window',{handle:inspected});
  await firefox.evaluate(`(${observeXR.toString()})()`);
  await activate(firefox,`return window.smoke.start('immersive-vr')`);
  await eventually(()=>firefox.evaluate<number>('return window.smoke.state.frames'),n=>n>=30,'fixture frames');
  const inputBefore=await firefox.evaluate<any>('return window.smoke.state');
  check(await firefox.panel<number>(panelPose,[[0.5,1.5,-1],[0.65,1.4,-0.8]])===1,'real panel TransformControls moves tracked controller');
  await eventually(()=>firefox.evaluate<any>('return window.smoke.state.inputPositions.right'),p=>Math.abs(p?.[0]-0.65)<0.001,'application receives controller pose');
  for(const button of ['rightSelectButton','rightSqueezeButton']) for(let i=0;i<2;i++) {
    const before=await firefox.evaluate<number>('return window.smoke.state.frames');
    await firefox.panel(`document.getElementById(arguments[0]).click()`,[button]);
    await eventually(()=>firefox.evaluate<number>('return window.smoke.state.frames'),n=>n>before+1,'input frame');
  }
  const sequence=await firefox.evaluate<any>('return window.smoke.state.eventOrder');
  assert.deepEqual(sequence.filter((s:string)=>s!=='added'),['selectstart','select','selectend','squeezestart','squeeze','squeezeend']);passed.push('tracked select/squeeze sequencing');
  await firefox.evaluate('return window.smoke.stop()');
  const stopped=await firefox.evaluate<number>('return window.smoke.state.frames');
  await new Promise(resolve=>setTimeout(resolve,150));
  check(await firefox.evaluate<number>('return window.smoke.state.frames')===stopped,'explicit end stops XR callbacks');
  await activate(firefox,`return window.smoke.start('immersive-vr')`);
  await eventually(()=>firefox.evaluate<number>('return window.smoke.state.frames'),n=>n>2,'restart');
  check(await firefox.evaluate<boolean>(`return window.smoke.state.inputModes.every(m=>m==='tracked-pointer') && window.smoke.state.eventOrder.join(',')==='added'`),'restart has fresh unpressed inputs');
  await firefox.evaluate(`window.endCount=0;window.firefoxSession.addEventListener('end',()=>window.endCount++);`);
  await configure(firefox,'Meta Quest 3','immersive-ar');
  await eventually(()=>firefox.evaluate<boolean>('return window.smoke.state.ended'),Boolean,'profile switch ends active session');
  check(await firefox.evaluate<number>('return window.endCount')===1,'active mode switch ends prior presentation once');
  await firefox.panel('location.reload()');
  await eventually(()=>firefox.panel<string>(`return document.querySelector('#questModeSelect')?.value`),v=>v==='immersive-ar','panel reload configuration');
  await firefox.navigate(origin+'/csp');
  check(await firefox.evaluate<boolean>(`return navigator.xr.isSessionSupported('immersive-ar')`),'page reload retains selected mode');
  passed.push('panel reload retains selected configuration');
  await firefox.evaluate(`window.roomBridge=null;window.addEventListener('webxr-virtual-room-response',e=>window.roomBridge={bytes:e.detail.buffer.byteLength,magic:String.fromCharCode(...new Uint8Array(e.detail.buffer).slice(0,4))});`);
  await activate(firefox,`return window.smoke.start('immersive-ar')`);
  await eventually(()=>firefox.evaluate<number>('return window.smoke.state.hits'),n=>n>0,'virtual room hit');
  check(await firefox.evaluate<boolean>(`return window.roomBridge?.bytes>0 && window.roomBridge.magic==='glTF'`),'privileged virtual-room ArrayBuffer crosses cloneInto bridge');
  await firefox.evaluate('return window.smoke.stop()');
  // Session-owned spaces/resources and frame lifetime; only public XR methods.
  const ownership=await activate(firefox,`const a=await navigator.xr.requestSession('inline'),b=await navigator.xr.requestSession('inline');const r=await a.requestReferenceSpace('viewer'),foreign=await b.requestReferenceSpace('viewer');const c=document.createElement('canvas'),g=c.getContext('webgl');await g.makeXRCompatible();const layer=new XRWebGLLayer(a,g);a.updateRenderState({baseLayer:layer});let saved;const errors=[];await new Promise(resolve=>a.requestAnimationFrame((t,f)=>{saved=f;try{f.getPose(foreign,r);}catch(e){errors.push(e.name);}resolve();}));try{saved.getViewerPose(r);}catch(e){errors.push(e.name);}try{b.updateRenderState({baseLayer:layer});}catch(e){errors.push(e.name);}await a.end();await b.end();return errors;`);
  assert.deepEqual(ownership,['InvalidStateError','InvalidStateError','InvalidStateError']);passed.push('foreign-session spaces and retained inactive frame reject InvalidStateError');
  await firefox.navigate(origin+'/wpt/webxr/navigator_xr_sameObject.https.html');
  const wpt=await eventually<any>(()=>firefox.evaluate<any>('return window.wptResults'),Boolean,'adapted pinned WPT SameObject');
  check(wpt.status===0 && wpt.tests.length===1 && wpt.tests.every((t:any)=>t.status===0),'pinned navigator_xr_sameObject assertion');
  return {passed,wpt,inputBefore,sequence};
}
