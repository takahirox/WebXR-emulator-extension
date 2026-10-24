import type {SessionMode} from '../src/types/contracts';

/** Bounded Issue #49 cases shared by the actual Chromium/Firefox drivers. */
export async function poseViewCases(mode: SessionMode) {
  const w = window as any, passed: string[] = [], rendering: any[] = [], adaptations: string[] = [];
  function check(value: unknown, label: string) { if (!value) throw new Error(`${mode}: ${label}`); passed.push(label); w.rigidTransformProgress = label; }
  function near(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string) {
    check(actual.length === expected.length && Array.from(actual).every((n, i) => Math.abs(n - expected[i]) < 0.0001), label);
  }
  function throws(action: () => unknown, expected: string, label: string) {
    let error: any; try { action(); } catch (e) { error = e; }
    check(error?.name === expected, label);
  }
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const popup = window.open('/frame', 'pose-view-realm') as any;
  check(popup, 'real popup opened');
  const iframe = document.createElement('iframe'); iframe.src = '/frame';
  const ready = new Promise<void>(resolve => { iframe.onload = () => resolve(); }); document.body.append(iframe);
  const sessions: any[] = [], canvases: HTMLCanvasElement[] = [], retained: any[] = [];
  let session: any, peer: any, gl: WebGL2RenderingContext, layer: any, binding: any, projection: any;
  try {
    await ready;
    const deadline = Date.now() + 10000;
    while (!popup.XRView) { if (Date.now() > deadline) throw new Error('popup injection timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
    const child = iframe.contentWindow as any;
    // Retain actual injection constructors/operations before closing documents.
    const realms = [w, child, popup].map(realm => Object.fromEntries([
      'XRFrame','XRPose','XRViewerPose','XRView','XRViewport','XRWebGLLayer','XRWebGLBinding','XRRigidTransform','XRReferenceSpace','XRSpace','XRDepthInformation', 'Array','Object','Float32Array','navigator','document',
    ].map(name => [name,realm[name]]).concat([['focus',()=>realm.focus()],['hasViewGeometryInterface','XRViewGeometry' in realm]])) as any);
    const borrowedViewport = popup.XRWebGLLayer.prototype.getViewport;
    const borrowedSubImage = popup.XRWebGLBinding.prototype.getViewSubImage;
    const script = document.createElement('script'); script.src = '/transform-sloppy.js';
    await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = reject; document.head.append(script); });
    const members: Record<string, string[]> = {
      XRFrame: ['session','predictedDisplayTime'], XRPose: ['transform','emulatedPosition','linearVelocity','angularVelocity'],
      XRViewerPose: ['views'], XRView: ['eye','index','recommendedViewportScale','isFirstPersonObserver','transform','projectionMatrix'],
      XRViewport: ['x','y','width','height'],
    };
    function attributes(value: any, name: string, owner: any) {
      check(Object.getPrototypeOf(value) === owner[name].prototype, `${name}: owner realm prototype`);
      for (const member of members[name]) {
        const original = value[member];
        for (const lender of realms) {
          const d = Object.getOwnPropertyDescriptor(lender[name].prototype, member)!;
          check(!!d?.get && !d.set && d.enumerable && d.configurable && !('value' in d), `${name}.${member}: readonly prototype descriptor`);
          check(!Object.prototype.hasOwnProperty.call(value, member), `${name}.${member}: no own property`);
          check(d.get!.call(value) === original, `${name}.${member}: borrowed getter stable`);
          for (const bad of [undefined,null,{},lender[name].prototype,Object.create(lender[name].prototype),new Proxy(value,{})]) {
            throws(() => d.get!.call(bad), 'TypeError', `${name}.${member}: wrong receiver rejected`);
          }
        }
        throws(() => { 'use strict'; value[member] = 99; }, 'TypeError', `${name}.${member}: strict write rejected`);
        w.assignTransformSloppy(value,member,99); check(value[member] === original, `${name}.${member}: sloppy write ignored`);
      }
    }
    function snapshots(frame: any, base: any, owner: any, ownLayer: any) {
      attributes(frame,'XRFrame',owner);
      for (const lender of realms) {
        const pose = lender.XRFrame.prototype.getPose.call(frame,base,base);
        attributes(pose,'XRPose',owner); near(pose.transform.matrix, identity, 'self-relative identity');
        check(!pose.emulatedPosition && pose.linearVelocity === null && pose.angularVelocity === null, 'known virtual position and unsupported velocities');
        const viewer = lender.XRFrame.prototype.getViewerPose.call(frame,base);
        attributes(viewer,'XRViewerPose',owner);
        check(viewer instanceof owner.XRPose && !viewer.emulatedPosition, 'viewer inherits pose with known position');
        check(viewer.transform === viewer.transform && Object.getPrototypeOf(viewer.transform) === owner.XRRigidTransform.prototype, 'viewer transform SameObject and session realm');
        check(Object.isFrozen(viewer.views) && Object.getPrototypeOf(viewer.views) === owner.Array.prototype, 'views frozen in session realm');
        const second = lender.XRFrame.prototype.getViewerPose.call(frame,base);
        check(viewer !== second && viewer.views !== second.views && viewer.views[0] !== second.views[0], 'separate viewer queries produce fresh snapshots');
        check(pose !== lender.XRFrame.prototype.getPose.call(frame,base,base), 'individual pose queries fresh');
        viewer.views.forEach((view: any, index: number) => {
          attributes(view,'XRView',owner); check(view.index === index, 'consecutive view index');
          check(Object.getPrototypeOf(owner.XRView.prototype) === owner.Object.prototype && !(owner === w ? 'XRViewGeometry' in w : owner.hasViewGeometryInterface), 'view geometry mixed directly into XRView');
          const getViewport = lender.XRWebGLLayer.prototype.getViewport;
          const viewport = getViewport.call(ownLayer,view); attributes(viewport,'XRViewport',owner);
          check(viewport === getViewport.call(ownLayer,view) && viewport === getViewport.call(ownLayer,second.views[index]), 'viewport identity follows underlying view');
          const getProjection = Object.getOwnPropertyDescriptor(lender.XRView.prototype,'projectionMatrix')!.get!;
          const a = getProjection.call(view), original = Array.from(a) as number[];
          check(Object.getPrototypeOf(a) === owner.Float32Array.prototype && a === view.projectionMatrix, 'attached projection cached in view realm');
          a.fill(77); check(view.projectionMatrix[0] === 77, 'projection elements mutable');
          near(second.views[index].projectionMatrix, original, 'other snapshot projection independent');
          structuredClone(a.buffer,{transfer:[a.buffer]}); check(a.length === 0, 'actual projection transfer detaches buffer');
          const fresh = getProjection.call(view);
          check(fresh !== a && fresh === view.projectionMatrix && Object.getPrototypeOf(fresh) === owner.Float32Array.prototype, 'detached projection regenerates stably in view realm');
          near(fresh,original,'projection regenerated from independent calibration');
          near(lender.XRFrame.prototype.getViewerPose.call(frame,base).views[index].projectionMatrix, original, 'later projection calculation unaffected');
          retained.push({frame,pose,viewer,view,viewport,projection:original,base});
        });
      }
    }
    function canvasFor(realm: any) {
      const canvas = realm.document.createElement('canvas') as HTMLCanvasElement; canvas.width = 640; canvas.height = 480;
      realm.document.body.append(canvas); canvases.push(canvas); return canvas;
    }
    function next(ownSession: any, action: (frame: any) => void) {
      return new Promise<void>((resolve,reject) => ownSession.requestAnimationFrame((_time: number,frame: any) => { try { action(frame); resolve(); } catch (error) { reject(error); } }));
    }
    for (const realm of realms) {
      for (const name of Object.keys(members)) {
        throws(() => new realm[name](), 'TypeError', `${name}: public construction rejected`);
        throws(() => Reflect.construct(realm[name],[{},0,0,0,0,0,0]), 'TypeError', `${name}: arbitrary internal-shaped arguments rejected`);
        throws(() => realm[name](), 'TypeError', `${name}: ordinary call rejected`);
      }
    }
    // Render foreign inline frames before starting an immersive session, which
    // would correctly suspend them. Genuine foreign values flow both directions.
    for (const [realmIndex,realm] of realms.entries()) {
      w.poseViewRealm = realmIndex === 2 ? 'popup' : 'main';
      const ownSession = await realm.navigator.xr.requestSession('inline'); sessions.push(ownSession);
      const base = await ownSession.requestReferenceSpace('viewer');
      const ownGL = canvasFor(realm).getContext('webgl2')!;
      const ownLayer = new realm.XRWebGLLayer(ownSession,ownGL); ownSession.updateRenderState({baseLayer:ownLayer});
      realm.focus();
      await next(ownSession,frame => snapshots(frame,base,realm,ownLayer));
      await ownSession.end();
    }
    w.poseViewRealm = 'main';
    popup.close(); iframe.remove(); window.focus();
    function start() {
      return new Promise<any>((resolve,reject) => {
        const button = document.createElement('button'); button.id='reference-space-session'; button.textContent='Start pose/view case';
        button.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';
        button.onclick=()=>{button.remove();w.navigator.xr.requestSession(mode,mode === 'inline' ? {} : {requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking','depth-sensing'],depthSensing:{usagePreference:['cpu-optimized'],dataFormatPreference:['float32']}}).then(resolve,reject);};
        document.body.append(button);
      });
    }
    session=await start();sessions.push(session);
    const base=await session.requestReferenceSpace('viewer');
    const navigation=base.getOffsetReferenceSpace(new w.XRRigidTransform({x:.6}));
    peer=await w.navigator.xr.requestSession('inline');sessions.push(peer);
    const foreign=await peer.requestReferenceSpace('viewer');
    gl=canvasFor(w).getContext('webgl2',{alpha:true,preserveDrawingBuffer:true})!;check(gl,'WebGL2 available');await (gl as any).makeXRCompatible();
    layer=new w.XRWebGLLayer(session,gl,{antialias:false});session.updateRenderState({baseLayer:layer});
    if(session.enabledFeatures.includes('depth-sensing')){
      const roomDeadline=Date.now()+15000;
      while(!session._device.arScene?.room){if(Date.now()>roomDeadline)throw new Error('virtual room readiness timeout');await next(session,()=>{});}
    }
    let held: any, oldView: any;
    const getPose=w.XRFrame.prototype.getPose,getViewer=w.XRFrame.prototype.getViewerPose,getViewport=w.XRWebGLLayer.prototype.getViewport;
    function badBindings(frame: any) {
      let traps=0;const poison=new Proxy({}, {get(){traps++;throw new Error('unexpected property read');}});
      for (const bad of [undefined,null,{},w.XRFrame.prototype,Object.create(w.XRFrame.prototype),new Proxy(frame,{}),poison]) {
        throws(()=>getPose.call(bad,poison,poison),'TypeError','getPose receiver checked first');
        throws(()=>getViewer.call(bad,poison),'TypeError','getViewerPose receiver checked first');
      }
      for (const args of [[],[base],[base,undefined],[null,base],[{},base],[base,{}],[new Proxy(base,{}),base],[base,new Proxy(base,{})]]) {
        throws(()=>Reflect.apply(getPose,frame,args),'TypeError','getPose argument conversion before state');
      }
      for (const args of [[],[undefined],[null],[{}],[new Proxy(base,{})],[Object.create(w.XRReferenceSpace.prototype)],[session.inputSources[0]?.targetRaySpace]]) {
        throws(()=>Reflect.apply(getViewer,frame,args),'TypeError','viewer reference interface conversion before state');
      }
      check(traps===0,'receiver/argument brands do not inspect properties');
    }
    await next(session,frame=>{
      held=frame;snapshots(frame,base,w,layer);badBindings(frame);
      oldView=frame.getViewerPose(base).views[0];
      for (const args of [[foreign,base],[base,foreign]]) throws(()=>getPose.call(frame,...args),'InvalidStateError','valid foreign-session pose spaces');
      throws(()=>getViewer.call(frame,foreign),'InvalidStateError','valid foreign-session viewer reference');
      const unavailable=new w.XRSpace(session,()=>null);
      check(frame.getPose(unavailable,base)===null,'unavailable provider returns null');
      throws(()=>frame.getPose(unavailable,foreign),'InvalidStateError','foreign base validated before tracking-null');
      throws(()=>frame.getPose(unavailable,{}),'TypeError','invalid base validated before tracking-null');
      near(frame.getPose(unavailable,unavailable).transform.matrix,identity,'self relationship known during tracking loss');
      const estimated=new w.XRSpace(session,()=>base._update());estimated._emulatedPosition=true;
      check(frame.getPose(estimated,base).emulatedPosition,'explicit estimated provider metadata propagated');
      check(!frame.getPose(estimated,estimated).emulatedPosition,'estimated origin self relationship exact');
      const estimatedReference=new w.XRReferenceSpace(session,'local',()=>base._update());
      const estimatedOffset=estimatedReference.getOffsetReferenceSpace(new w.XRRigidTransform({x:1}));
      estimatedReference._emulatedPosition=true;
      check(frame.getPose(estimatedOffset,base).emulatedPosition,'offset inherits live estimated-origin metadata');
      check(!frame.getPose(estimatedOffset,estimatedReference).emulatedPosition,'shared estimated origin has exact relative offset');
      check(frame.getViewerPose(estimatedReference).emulatedPosition,'viewer relative query propagates supplied estimated position');
      const matrices=new Float32Array(32);check(frame.fillPoses([base,navigation],base,matrices),'bulk poses available');
      near(matrices.slice(16),frame.getPose(navigation,base).transform.matrix,'individual/bulk geometry agrees');
      const view=oldView;
      throws(()=>layer.getViewport(retained[0].view),'InvalidStateError','genuine foreign-session view rejected');
      for (const bad of [undefined,null,{},w.XRWebGLLayer.prototype,Object.create(w.XRWebGLLayer.prototype),new Proxy(layer,{})]) throws(()=>getViewport.call(bad,view),'TypeError','getViewport receiver brand');
      for (const args of [[],[undefined],[null],[{}],[Object.create(w.XRView.prototype)],[new Proxy(view,{})]]) throws(()=>Reflect.apply(getViewport,layer,args),'TypeError','getViewport view binding');
      const scale=w.XRView.prototype.requestViewportScale;
      check(scale.length===1,'viewport scale required arity');
      throws(()=>scale.call({}, {valueOf(){throw new Error('must not convert');}}),'TypeError','scale receiver precedes numeric conversion');
      throws(()=>scale.call(view),'TypeError','scale missing argument');
      for (const value of [NaN,Infinity,-Infinity,'NaN','Infinity',Symbol(),BigInt(1)]) throws(()=>scale.call(view,value),'TypeError','scale rejects nonfinite/non-number conversion');
      for (const value of [null,undefined,0,-1,2,.5,'0.5',false,1e100]) check(scale.call(view,value)===undefined,'fixed resolution nullable-double no-op');
      let conversions=0;scale.call(view,{valueOf(){conversions++;return .5;}});check(conversions===1,'scale converted once');
      const sentinel={sentinel:true};let error;try{scale.call(view,{valueOf(){throw sentinel;}});}catch(e){error=e;}check(error===sentinel,'scale conversion exception preserved');
      check(view.recommendedViewportScale===null,'no unsupported scaling recommendation');
      check(layer.getViewport(view)===layer.getViewport(view),'scale calls preserve cached viewport');
    });
    if(mode==='inline'){
      const canvas=gl.canvas as HTMLCanvasElement;let viewport:any;
      await next(session,frame=>{
        const view=frame.getViewerPose(base).views[0];viewport=layer.getViewport(view);
        canvas.width=320;
        check(layer.getViewport(view)===viewport && layer.getViewport(frame.getViewerPose(base).views[0])===viewport,'inline viewport locked through resize within frame');
      });
      await next(session,frame=>{
        const resized=layer.getViewport(frame.getViewerPose(base).views[0]);
        check(resized!==viewport && resized.width===320 && viewport.width===640,'inline resize updates next frame without mutating retained viewport');
        canvas.width=640;
      });
    }
    badBindings(held);
    throws(()=>held.getPose(base,base),'InvalidStateError','inactive frame getPose');
    throws(()=>held.getViewerPose(base),'InvalidStateError','inactive frame getViewerPose');
    throws(()=>layer.getViewport(oldView),'InvalidStateError','viewport outside animation frame');
    check(oldView.requestViewportScale(.5)===undefined,'retained view scaling has no invented lifetime gate');
    await next(session,frame=>{
      throws(()=>layer.getViewport(oldView),'InvalidStateError','stale view in newer active frame');
      const source=session.inputSources[0];
      if(source?.hand){
        const joint=source.hand.get('wrist'),pose=frame.getJointPose(joint,base);
        check(pose && !pose.emulatedPosition && pose.transform===pose.transform,'joint pose inherits pose geometry');
        const slot=Object.getOwnPropertyDescriptor(session._device.gamepads,'0')!;
        try{delete session._device.gamepads[0];check(frame.getPose(joint,base)===null && frame.getJointPose(joint,base)===null,'existing joint tracking-loss transition');}
        finally{Object.defineProperty(session._device.gamepads,'0',slot);}
        check(frame.getPose(joint,base)!==null,'joint tracking recovery');
      }
      if(session.enabledFeatures.includes('depth-sensing')){
        const view=frame.getViewerPose(base).views[0];view.projectionMatrix.fill(99);structuredClone(view.projectionMatrix.buffer,{transfer:[view.projectionMatrix.buffer]});
        const depth=frame.getDepthInformation(view);
        check(depth && Object.getPrototypeOf(w.XRDepthInformation.prototype)===w.Object.prototype,'CPU depth geometry uses mixin without extra public prototype');
        near(depth.projectionMatrix,view.projectionMatrix,'CPU depth calibration survives view writes/transfer');
        for(const realm of realms){
          const depthGet=Object.getOwnPropertyDescriptor(realm.XRDepthInformation.prototype,'projectionMatrix')!.get!;
          near(depthGet.call(depth),view.projectionMatrix,'borrowed depth geometry getter accepts genuine depth');
          throws(()=>depthGet.call(view),'TypeError','depth mixin getter rejects view receiver');
          const viewGet=Object.getOwnPropertyDescriptor(realm.XRView.prototype,'projectionMatrix')!.get!;
          throws(()=>viewGet.call(depth),'TypeError','view mixin getter rejects depth receiver');
        }
      }
    });
    if(mode!=='inline' && session.interactionMode!=='screen-space'){
      const source=session.inputSources[0],slot=session._device.gamepadInputSources[0],active=slot.active;
      try{
        slot.active=false;await next(session,frame=>check(frame.getPose(source.targetRaySpace,base)===null,'retired source tracking unavailable'));
        slot.active=true;await next(session,frame=>{
          check(session.inputSources[0]!==source,'source reacquisition creates fresh identity');
          check(frame.getPose(source.targetRaySpace,base)===null && frame.getPose(session.inputSources[0].targetRaySpace,base)!==null,'old space stays unavailable while reacquired source tracks');
        });
      }finally{slot.active=active;}
    }
    if(mode!=='inline'){
      let eventFrame:any,eventError:unknown;
      const onSelect=(event:any)=>{try{eventFrame=event.frame;check(eventFrame.getPose(event.inputSource.targetRaySpace,base)!==null,'real event frame permits getPose');throws(()=>eventFrame.getViewerPose(base),'InvalidStateError','real event frame rejects getViewerPose');throws(()=>eventFrame.getViewerPose({}),'TypeError','event frame binding errors precede animation state');}catch(e){eventError=e;}};
      session.addEventListener('selectstart',onSelect);
      try{session._device._updateInputButtonPressed(true,0,0);await next(session,()=>{});if(eventError)throw eventError;check(eventFrame,'real input event observed');throws(()=>eventFrame.getPose(base,base),'InvalidStateError','retained event frame inactive');}
      finally{session.removeEventListener('selectstart',onSelect);session._device._updateInputButtonPressed(false,0,0);}
    }else adaptations.push('Inline has no input/depth/hand features; immersive scenarios exercise their existing paths.');
    // One geometric triangle through both existing presentation paths. Projection
    // rendering deliberately requests no layers feature.
    const vertex=gl.createShader(gl.VERTEX_SHADER)!;gl.shaderSource(vertex,'#version 300 es\nuniform mat4 projection;uniform mat4 view;void main(){vec3 p=gl_VertexID==0?vec3(-.3,-.25,-2):gl_VertexID==1?vec3(.3,-.25,-2):vec3(0,.35,-2);gl_Position=projection*view*vec4(p,1);}');gl.compileShader(vertex);
    const fragment=gl.createShader(gl.FRAGMENT_SHADER)!;gl.shaderSource(fragment,'#version 300 es\nprecision mediump float;uniform vec4 color;out vec4 c;void main(){c=color;}');gl.compileShader(fragment);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),'render shaders link');
    const framebuffer=gl.createFramebuffer()!;
    async function render(label:string,reference:any,transfer:boolean,composition:boolean){
      await next(session,frame=>{
        const viewer=frame.getViewerPose(reference),views:any[]=[];
        check(viewer.views.length===(mode!=='inline'&&session.interactionMode!=='screen-space'?2:1),'expected mono/stereo views');
        gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);
        if(!composition){gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
        for(const view of viewer.views){
          const initial=Array.from(view.projectionMatrix) as number[];
          if(transfer){view.projectionMatrix.fill(91);structuredClone(view.projectionMatrix.buffer,{transfer:[view.projectionMatrix.buffer]});near(view.projectionMatrix,initial,'render uses regenerated projection');}
          let viewport:any;
          if(composition){
            const image=borrowedSubImage.call(binding,projection,view);viewport=image.viewport;
            check(Object.getPrototypeOf(viewport)===w.XRViewport.prototype,'borrowed subimage viewport allocated in binding realm');
            gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,image.colorTexture,0);
          }else viewport=borrowedViewport.call(layer,view);
          gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
          gl.uniformMatrix4fv(gl.getUniformLocation(program,'projection'),false,view.projectionMatrix);
          gl.uniformMatrix4fv(gl.getUniformLocation(program,'view'),false,view.transform.inverse.matrix);
          const color=view.eye==='left'?[1,0,0,1]:view.eye==='right'?[0,1,0,1]:[1,1,0,1];gl.uniform4fv(gl.getUniformLocation(program,'color'),color);gl.drawArrays(gl.TRIANGLES,0,3);
          const pixels=new Uint8Array(viewport.width*viewport.height*4);gl.readPixels(viewport.x,viewport.y,viewport.width,viewport.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let count=0,sum=0;for(let y=0;y<viewport.height;y++)for(let x=0;x<viewport.width;x++){const i=(y*viewport.width+x)*4;if(color.slice(0,3).every((n,j)=>Math.abs(pixels[i+j]-n*255)<3)&&pixels[i+3]>250){count++;sum+=x;}}
          check(count>100,`${label}/${view.eye}: rendered triangle pixels`);views.push({eye:view.eye,index:view.index,viewport:{x:viewport.x,y:viewport.y,width:viewport.width,height:viewport.height},pixels:count,centroidX:sum/count});
          // Retain a corrupt exported array through composition. Internal
          // calibration must remain independent of this application state.
          if(composition)view.projectionMatrix.fill(123);
        }
        check(gl.getError()===gl.NO_ERROR,`${label}: no rendering errors`);rendering.push({label,path:composition?'projection':'base',views});
      });
      const output=(composition?binding._presentation:layer)._presentationCanvas as HTMLCanvasElement;
      const rendered=rendering[rendering.length-1];
      if(mode!=='inline'){
        const pixels=output.getContext('2d')!.getImageData(0,0,output.width,output.height).data;
        for(const view of rendered.views){const color=view.eye==='left'?[255,0,0]:view.eye==='right'?[0,255,0]:[255,255,0];let count=0;
          for(let y=0;y<output.height;y++)for(let x=view.viewport.x;x<view.viewport.x+view.viewport.width;x++){const i=(y*output.width+x)*4;if(color.every((n,j)=>Math.abs(pixels[i+j]-n)<3)&&pixels[i+3]>250)count++;}
          check(count===view.pixels,`${label}/${view.eye}: presented pixels match source`);view.presentedPixels=count;}
      }
      rendered.png=output.toDataURL('image/png');
    }
    for(const composition of mode==='inline'?[false]:[false,true]){
      if(composition){binding=new w.XRWebGLBinding(session,gl);projection=binding.createProjectionLayer({depthFormat:0});session.updateRenderState({layers:[projection]});check(!session.enabledFeatures.includes('layers'),'projection path requires no layers request');}
      const prefix=composition?'projection':'base';
      await render(`${prefix}-before`,base,false,composition);await render(`${prefix}-transfer`,base,true,composition);await render(`${prefix}-navigation`,navigation,true,composition);
      const [a,b,c]=rendering.slice(-3);a.views.forEach((view:any,i:number)=>{check(view.pixels===b.views[i].pixels&&view.centroidX===b.views[i].centroidX,'projection transfer preserves rendered geometry');check(c.views[i].centroidX>view.centroidX+view.viewport.width*.05,'navigation visibly moves each eye');});
    }
    let ends=0,lateFrames=0;session.addEventListener('end',()=>ends++);session.requestAnimationFrame(()=>lateFrames++);await session.end();await new Promise(resolve=>setTimeout(resolve,80));
    check(ends===1&&lateFrames===0&&session.callbacks.size===0,'shutdown emits one end and cancels queued frames');
    for(const value of retained){
      check(value.frame.session&&Number.isFinite(value.frame.predictedDisplayTime)&&value.pose.transform&&Object.isFrozen(value.viewer.views)&&value.viewport.width>0,'retained readonly attributes readable after end');
      structuredClone(value.view.projectionMatrix.buffer,{transfer:[value.view.projectionMatrix.buffer]});near(value.view.projectionMatrix,value.projection,'ended view projection regenerates');
      throws(()=>value.frame.getPose(value.base,value.base),'InvalidStateError','ended queries remain lifetime checked');
    }
    throws(()=>layer.getViewport(oldView),'InvalidStateError','ended viewport query rejected');check(oldView.requestViewportScale(null)===undefined,'ended scale no-op remains usable');
    session=await start();sessions.push(session);const restartedBase=await session.requestReferenceSpace('viewer');layer=new w.XRWebGLLayer(session,gl,{antialias:false});session.updateRenderState({baseLayer:layer});
    await render('restart',restartedBase,true,false);await session.end();check(session.callbacks.size===0,'restart cleanup');
    gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.deleteFramebuffer(framebuffer);
    return {mode,assertions:passed.length,passed,rendering,adaptations,tolerance:0.0001};
  } finally {
    for(const owned of sessions)if(!owned.ended)await owned.end();popup?.close();iframe.remove();for(const canvas of canvases)canvas.remove();document.querySelector('#reference-space-session')?.remove();
  }
}
