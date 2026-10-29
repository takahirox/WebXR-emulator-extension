import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {serveFirefoxFixtures} from './firefox-upstream';

// Focused Chromium regression for the shared MAIN/ISOLATED lifetime bridge.
const {origin,server} = await serveFirefoxFixtures();
try {
  for(const [deviceKey,questMode] of [['Meta Quest 3','immersive-vr'],['Meta Quest 3','immersive-ar'],['Generic Android Phone (ARCore)','immersive-ar']]) {
    const profile=await mkdtemp(path.join(tmpdir(),'webxr-lifetime-'));
    const context=await chromium.launchPersistentContext(profile,{
      ...(process.env.WEBXR_CHROMIUM_EXECUTABLE?{executablePath:process.env.WEBXR_CHROMIUM_EXECUTABLE}:{channel:'chromium'}),
      headless:false,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${process.cwd()}`,`--load-extension=${process.cwd()}`,'--enable-unsafe-swiftshader'],
    });
    try {
      const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const extensionURL=new URL(worker.url());const extensionOrigin=extensionURL.protocol+'//'+extensionURL.host;
      await worker.evaluate(async config=>chrome.storage.local.set({'webxr-extension':JSON.stringify(config)}),{deviceKey,questMode,stereoEffect:true,domOverlayPreview:false});
      const page=await context.newPage();await page.goto(origin+'/csp');
      await page.evaluate(() => {
        const w=window as any, original=w.navigator.xr.requestSession;
        w.navigator.xr.requestSession=function(...args:unknown[]) {return (Reflect.apply(original,this,args) as Promise<any>).then((s:any)=>{w.lifetimeSession=s;return s;});};
      });
      await page.mouse.click(10,10);
      await page.evaluate(mode=>(window as any).smoke.start(mode),questMode);
      await page.waitForFunction(()=>(window as any).smoke.state.frames>=30);
      const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
      await page.waitForTimeout(2200);
      assert.equal(await page.evaluate(()=>(window as any).smoke.state.ended),false,'background suspension must not end presentation');
      const popup=await context.newPage();await popup.goto(extensionOrigin+'/src/extension/popup.html');
      await page.bringToFront();
      if (deviceKey === 'Meta Quest 3') await page.evaluate(() => {
        const w=window as any; w.lifetimeHaptics='pending';
        const g=w.lifetimeSession.inputSources[0].gamepad; w.retainedHapticGamepad=g;
        void g.vibrationActuator.playEffect('dual-rumble',{duration:5000,strongMagnitude:1}).then((result:string)=>{w.lifetimeHaptics=result;});
      });
      await popup.evaluate(()=>{setTimeout(()=>chrome.runtime.reload(),0);});
      await page.waitForFunction(()=>(window as any).smoke.state.ended,undefined,{timeout:7000});
      if (deviceKey === 'Meta Quest 3') {
        await page.waitForFunction(()=>(window as any).lifetimeHaptics === 'preempted');
        assert.equal(await page.evaluate(()=>(window as any).retainedHapticGamepad.connected),false,'extension unload disconnects retained haptic source');
      }
      const frames=await page.evaluate(()=>(window as any).smoke.state.frames);await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>(window as any).smoke.state.frames),frames,'unload stops XR callbacks');
      console.log(JSON.stringify({browser:context.browser()!.version(),deviceKey,questMode,frames,workerSuspension:'passed',unload:'passed'}));
    } finally {await context.close();await rm(profile,{recursive:true,force:true});}
  }
} finally {server.close();}
