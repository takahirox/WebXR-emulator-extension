/** Observation only. All wrapped calls keep their receiver, arguments, return
 * value and exceptions. No capabilities, requests or input are replaced. */
export function observeXR() {
  const w = window as any;
  const probe = w.firefoxXR = {frames: 0, hits: 0, ends: 0, events: [] as string[], inputModes: [] as string[], requests: [] as unknown[], views: [] as unknown[]};
  const request = w.navigator.xr.requestSession;
  w.navigator.xr.requestSession = function (...args: any[]) {
    probe.requests.push(args);
    const result = Reflect.apply(request, this, args) as Promise<any>;
    // Return the original promise. Observe fulfillment independently.
    void result.then(session => {
      if (args[0] === 'inline') return;
      w.firefoxSession = session;
      session.addEventListener('end', () => { probe.ends++; });
      for (const type of ['selectstart','select','selectend','squeezestart','squeeze','squeezeend']) {
        session.addEventListener(type, (event: any) => { probe.events.push(type); probe.inputModes.push(event.inputSource.targetRayMode); });
      }
    }, () => {});
    return result;
  };
  const raf = w.XRSession.prototype.requestAnimationFrame;
  w.XRSession.prototype.requestAnimationFrame = function (callback: any) {
    if (this._mode === 'inline') return Reflect.apply(raf, this, [callback]);
    return Reflect.apply(raf, this, [function (this: any, ...args: any[]) {
      probe.frames++;
      w.firefoxRetainedFrame = args[1];
      return Reflect.apply(callback, this, args);
    }]);
  };
  const pose = w.XRFrame.prototype.getViewerPose;
  w.XRFrame.prototype.getViewerPose = function (...args: any[]) {
    const value: any = Reflect.apply(pose, this, args);
    if (value && this.session._mode !== 'inline') {
      probe.views = value.views.map((view: any) => ({eye:view.eye,width:0,height:0}));
      // The layer compositor also asks for viewer-relative poses (identity).
      // Keep the application's world/local reference-space observation.
      if (args[0]._type !== 'viewer') w.firefoxViewer = Array.from(value.transform.matrix).slice(12, 15);
    }
    return value;
  };
  const viewport = w.XRWebGLLayer.prototype.getViewport;
  w.XRWebGLLayer.prototype.getViewport = function (...args: any[]) {
    const result: any = Reflect.apply(viewport, this, args);
    const view: any = probe.views.find((v: any) => v.eye === args[0].eye);
    if (view) {view.width=result.width;view.height=result.height;}
    return result;
  };
  const subImage = w.XRWebGLBinding.prototype.getViewSubImage;
  w.XRWebGLBinding.prototype.getViewSubImage = function (...args: any[]) {
    const result: any = Reflect.apply(subImage, this, args);
    const view: any = probe.views.find((v: any) => v.eye === args[1].eye);
    if (view) {view.width=result.viewport.width;view.height=result.viewport.height;}
    return result;
  };
  const hits = w.XRFrame.prototype.getHitTestResults;
  w.XRFrame.prototype.getHitTestResults = function (...args: any[]) {
    const value: any = Reflect.apply(hits, this, args);
    probe.hits = Math.max(probe.hits, value.length);
    return value;
  };
}

export function applicationPixels() {
  const w = window as any;
  const s = w.firefoxSession;
  const layer = s.renderState.baseLayer ?? s.renderState.layers[0]._binding._presentation;
  const canvas = layer._presentationCanvas;
  const gl = canvas.getContext('2d');
  const data = gl.getImageData(0, 0, canvas.width, canvas.height).data;
  const halves = s._device.handheld ? 1 : 2;
  const regions = Array.from({length: halves}, (_, eye) => {
    let colored = 0, transparent = 0;
    const colors = new Set<number>();
    const x0 = Math.floor(eye * canvas.width / halves), x1 = Math.floor((eye + 1) * canvas.width / halves);
    for (let y = 0; y < canvas.height; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (data[offset + 3] === 0) transparent++;
      else { colored++; colors.add((data[offset] << 16) + (data[offset + 1] << 8) + data[offset + 2]); }
    }
    return {width: x1-x0, height: canvas.height, colored, transparent, colors: colors.size};
  });
  return {width: canvas.width, height: canvas.height, regions, layer: s.renderState.baseLayer ? 'base' : 'projection'};
}

/** Sample the actual AR display on its next natural render. Match opaque app
 * texels in the final compositor, and verify transparent texels retain the room. */
export function presentedPixels() {
  const w = window as any, s = w.firefoxSession;
  const layer = s.renderState.baseLayer ?? s.renderState.layers[0]._binding._presentation;
  const canvas = layer._presentationCanvas;
  if (!s._device.arScene) return {connected: canvas.isConnected, width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height};
  const ar = s._device.arScene, renderer = ar.renderer;
  const image = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
  const count = s._device.handheld ? 1 : 2;
  const source: any[] = [];
  for(let eye=0;eye<count;eye++) {
    const start=Math.floor(eye*image.width/count), end=Math.floor((eye+1)*image.width/count);
    let opaque: any;
    for(let y=1;y<image.height-1;y++) for(let x=start+1;x<end-1;x++) {
      const i=(y*image.width+x)*4;
      if(image.data[i+3]!==255 || image.data[i-4+3]!==255 || image.data[i+4+3]!==255 || image.data[i-image.width*4+3]!==255 || image.data[i+image.width*4+3]!==255) continue;
      const score=image.data[i]+image.data[i+1]+image.data[i+2];
      if(!opaque || score>opaque.score)opaque={x,y,score,expected:Array.from(image.data.slice(i,i+4))};
    }
    if(!opaque) throw new Error('No solid application texel in eye '+eye);
    let neighbor;
    for(let radius=4;radius<=64&&!neighbor;radius+=4)for(const [dx,dy] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){const x=opaque.x+dx,y=opaque.y+dy;if(x>=start&&x<end&&y>=0&&y<image.height&&image.data[(y*image.width+x)*4+3]===0){neighbor={x,y};break;}}
    if(!neighbor)throw new Error('No transparent neighbor for application texel');
    source.push({opaque,neighbor,transparent:{x:start+Math.floor((end-start)*0.2),y:Math.floor(image.height*0.2)}});
  }
  return new Promise((resolve,reject)=>{
    const original=renderer.render;
    const timeout=setTimeout(()=>{renderer.render=original;reject(new Error('No natural presentation render'));},5000);
    renderer.render=function(...args:any[]) {
      const result=Reflect.apply(original,this,args);
      if(renderer.getRenderTarget()!==null)return result;
      renderer.render=original;clearTimeout(timeout);
      try {
      const gl=renderer.getContext();
      function displayPoint(point:any) {
        if(!s._device.handheld)return {x:Math.floor(point.x*gl.drawingBufferWidth/image.width),y:Math.floor((1-point.y/image.height)*gl.drawingBufferHeight)};
        const geometry=ar.screen.geometry;geometry.computeBoundingBox();const box=geometry.boundingBox;
        const p=ar.camera.position.clone().set(box.min.x+(box.max.x-box.min.x)*(point.x/image.width),box.min.y+(box.max.y-box.min.y)*(1-point.y/image.height),0);
        ar.screen.localToWorld(p).project(ar.camera);
        return {x:Math.floor((p.x+1)*gl.drawingBufferWidth/2),y:Math.floor((p.y+1)*gl.drawingBufferHeight/2)};
      }
      function read(point:any) {
        const {x,y}=displayPoint(point), values=[];
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
          const pixel=new Uint8Array(4);gl.readPixels(x+dx,y+dy,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);values.push(Array.from(pixel));
        }
        return values;
      }
      resolve(source.map(({opaque,transparent,neighbor})=>{
        const pixels=read(opaque);
        const distances=pixels.map(pixel=>Math.max(...pixel.slice(0,3).map((v,i)=>Math.abs(v-opaque.expected[i]))));
        const closest=pixels[distances.indexOf(Math.min(...distances))],nearbyRoom=read(neighbor)[12];
        const delta=closest.slice(0,3).map((v,i)=>v-nearbyRoom[i]);
        const correlation=delta.reduce((sum,v,i)=>sum+v*(opaque.expected[i]-nearbyRoom[i]),0);
        return {expected:opaque.expected,closest,difference:Math.min(...distances),nearbyRoom,foregroundContrast:Math.max(...delta.map(Math.abs)),correlation,room:read(transparent)[12]};
      }));
      } catch(error) {reject(error);}
      return result;
    };
  });
}
