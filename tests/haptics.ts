import type {SessionMode} from '../src/types/contracts';

/** Real injected runtime and timers. Backend controls only simulate retirement
 * and session visibility, restoring input configuration in finally. */
export async function hapticCases(mode: SessionMode) {
  'use strict';
  const w = window as any, passed: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); passed.push(label); w.rigidTransformProgress = label; };
  async function rejects(promise: Promise<unknown>, name: string, label: string) {
    check(promise instanceof w.Promise, label + ' returns Promise');
    let error: any; try { await promise; } catch (caught) { error = caught; }
    check(error?.name === name, `${label}: expected ${name}, got ${error}`);
  }
  const frame = (s: any) => new Promise<void>(resolve => s.requestAnimationFrame(() => resolve()));
  const request = (realm = w) => new Promise<any>((resolve, reject) => {
    w.rigidTransformProgress = 'request session ' + (realm === w ? 'parent' : 'child');
    const b = document.createElement('button'); b.id = 'reference-space-session'; b.textContent = 'Start haptics';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick = () => { b.remove(); realm.navigator.xr.requestSession(mode).then(resolve, reject); }; document.body.append(b);
  });
  async function setup(realm = w) {
    const s = await request(realm), gl = realm.document.createElement('canvas').getContext('webgl2');
    await gl.makeXRCompatible(); s.updateRenderState({baseLayer: new realm.XRWebGLLayer(s, gl)}); await frame(s); return s;
  }
  let s = await setup(), child: HTMLIFrameElement | undefined;
  try {
    if (mode === 'inline' || s._device.handheld) {
      check(s.inputSources.length === 0, 'inline/idle phone has no controllers');
      if (mode !== 'inline') {
        s._device.arScene.onTouch([0, 1.6, -0.2]); await frame(s);
        check(s.inputSources.length === 1, 'phone touch exposes one transient source');
        for (const input of s.inputSources) check(input.gamepad === null, 'phone screen has no Gamepad');
        s._device.arScene.onRelease(); await frame(s);
      }
      return {mode, assertions: passed.length, passed};
    }
    const left = [...s.inputSources].find((i: any) => i.handedness === 'left');
    const right = [...s.inputSources].find((i: any) => i.handedness === 'right');
    const a = left.gamepad.vibrationActuator, b = right.gamepad.vibrationActuator;
    check(a && b && a !== b, 'independent left/right actuators');
    check(left instanceof w.Object, 'source owner realm ancestry');
    check(a instanceof w.Object && a.effects instanceof w.Array, 'actuator and effects owner realm');
    check(a.playEffect.length === 1 && a.reset.length === 0, 'WebIDL operation arity');
    check(Object.isFrozen(a.effects) && a.effects.join() === 'dual-rumble' && a.effects === a.effects, 'stable supported effects');
    check(Object.prototype.toString.call(a) === '[object GamepadHapticActuator]', 'actuator tag');
    check(left.gamepad.hapticActuators.length === 0 && !a.pulse, 'legacy path unsupported');
    const gamepad = left.gamepad, axes = gamepad.axes, buttons = gamepad.buttons;
    await frame(s);
    check(left.gamepad === gamepad && gamepad.vibrationActuator === a && Object.isFrozen(axes) && Object.isFrozen(buttons), 'same source Gamepad/actuator and frozen snapshots');
    for (const type of [undefined, null, 'invalid', Symbol('dual-rumble')]) await rejects(a.playEffect(type), 'TypeError', 'invalid enum');
    await rejects(a.playEffect(), 'TypeError', 'missing type');
    for (const bad of [{}, Object.create(Object.getPrototypeOf(a)), new Proxy(a, {})]) {
      let reads = 0; await rejects(a.playEffect.call(bad, {toString() { reads++; return 'dual-rumble'; }}), 'TypeError', 'receiver brand');
      check(reads === 0, 'receiver checked before conversion');
      await rejects(a.reset.call(bad), 'TypeError', 'reset receiver brand');
      let error: any; try { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(a), 'effects')!.get!.call(bad); } catch (e) { error = e; }
      check(error?.name === 'TypeError', 'effects getter brand');
    }
    for (const parameters of [1, 'bad', {strongMagnitude: -0.1}, {weakMagnitude: 1.01}, {strongMagnitude: NaN}, {weakMagnitude: Infinity}, {duration: BigInt(1)}, {startDelay: Symbol()}]) {
      await rejects(a.playEffect('dual-rumble', parameters), 'TypeError', 'invalid dictionary or member');
    }
    const order: string[] = [];
    const parameters = Object.create({duration: '0', startDelay: null, strongMagnitude: '1', weakMagnitude: false});
    for (const key of ['duration', 'leftTrigger', 'rightTrigger', 'startDelay', 'strongMagnitude', 'weakMagnitude']) Object.defineProperty(parameters, key, {get() { order.push(key); return key === 'strongMagnitude' ? '1' : undefined; }});
    check(await a.playEffect({toString: () => 'dual-rumble'}, parameters) === 'complete', 'enum and inherited dictionary conversions');
    check(order.join() === 'duration,leftTrigger,rightTrigger,startDelay,strongMagnitude,weakMagnitude', 'dictionary read once in WebIDL order');
    for (const parameters of [undefined, null, {}, {duration: NaN, startDelay: Infinity}, {duration: 0.9}, {duration: '3.9', startDelay: '1.9', strongMagnitude: '1', weakMagnitude: null}, {duration: 2, strongMagnitude: 1, weakMagnitude: 0}]) check(await a.playEffect('dual-rumble', parameters) === 'complete', 'zero/default/finite boundary completion');
    check(await a.reset() === 'complete', 'idle reset settles');
    let old = a.playEffect('dual-rumble', {duration: 5000});
    await rejects(a.playEffect('dual-rumble', {strongMagnitude: 2}), 'TypeError', 'invalid request does not preempt');
    let settled = false; void old.then(() => { settled = true; }); await Promise.resolve(); check(!settled, 'invalid request retains playing effect');
    const replacement = a.playEffect('dual-rumble', {duration: 0});
    check(await old === 'preempted' && await replacement === 'complete', 'replacement outcomes');
    old = a.playEffect('dual-rumble', {startDelay: 5000});
    check(await a.reset() === 'complete' && await old === 'preempted', 'reset cancels delayed request');
    old = a.playEffect('dual-rumble', {duration: 5000});
    await rejects(a.playEffect('trigger-rumble'), 'NotSupportedError', 'known unsupported effect');
    check(await old === 'preempted', 'known unsupported type preempts after validation');
    old = a.playEffect('dual-rumble', {duration: -1});
    const independent = b.playEffect('dual-rumble'); await a.reset();
    check(await old === 'preempted' && await independent === 'complete', 'unsigned wrapping is bounded and controllers independent');
    old = a.playEffect('dual-rumble', {duration: 5000}); s._setVisibility('hidden');
    check(await old === 'preempted', 'hidden cancels effect');
    await rejects(a.playEffect('dual-rumble'), 'InvalidStateError', 'hidden play');
    await rejects(a.reset(), 'InvalidStateError', 'hidden reset'); s._setVisibility('visible');
    check(await a.playEffect('dual-rumble') === 'complete', 'visibility restoration permits new requests');
    const raw = s._device.gamepadInputSources.find((input: any) => input.handedness === 'left');
    old = a.playEffect('dual-rumble', {duration: 5000}); raw.active = false; await frame(s);
    check(await old === 'preempted' && !gamepad.connected, 'retirement cancels and disconnects');
    await rejects(a.playEffect('dual-rumble'), 'InvalidStateError', 'retired actuator cannot restart');
    raw.active = true; await frame(s);
    let fresh = [...s.inputSources].find((input: any) => input.handedness === 'left').gamepad.vibrationActuator;
    check(fresh !== a, 'reconnected source has fresh actuator');
    await rejects(a.reset(), 'InvalidStateError', 'stale reset cannot affect new source');
    const profiles = Object.getOwnPropertyDescriptor(raw.inputSource, 'profiles')!;
    old = fresh.playEffect('dual-rumble', {duration: 5000});
    try {
      Object.defineProperty(raw.inputSource, 'profiles', {configurable: true, get: () => [...profiles.get!.call(raw.inputSource), 'haptic-fixture']});
      await frame(s);
      check(await old === 'preempted', 'metadata replacement preempts old actuator');
      await rejects(fresh.playEffect('dual-rumble'), 'InvalidStateError', 'replaced actuator permanently inactive');
    } finally { Object.defineProperty(raw.inputSource, 'profiles', profiles); await frame(s); }
    fresh = [...s.inputSources].find((input: any) => input.handedness === 'left').gamepad.vibrationActuator;
    let nested: Promise<string> | undefined;
    const reenter = (event: any) => {
      if (event.detail.objectName !== 'leftController' || event.detail.state !== 'idle' || nested) return;
      nested = fresh.playEffect('dual-rumble');
    };
    window.addEventListener('device-haptics', reenter);
    const beforeReentry = fresh.playEffect('dual-rumble', {duration: 5000});
    const afterReentry = fresh.playEffect('dual-rumble');
    const reentryResults = await Promise.all([beforeReentry, afterReentry]);
    window.removeEventListener('device-haptics', reenter);
    check(nested && ['complete','preempted'].includes(await nested) && reentryResults.every(result => ['complete','preempted'].includes(result)), 'diagnostic-listener reentry never strands requests');
    // Host runner inspects the actual panel at each stage, then acknowledges.
    async function stage(name: string) {
      w.hapticPanelStage = name; w.hapticPanelAck = '';
      const deadline = performance.now() + 20000;
      while (w.hapticPanelAck !== name) {
        if (performance.now() > deadline) throw new Error('panel stage timeout ' + name);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      check(true, 'actual panel ' + name);
    }
    const phases: string[] = [];
    const record = (event: any) => { if (event.detail.objectName === 'leftController') phases.push(event.detail.state); };
    window.addEventListener('device-haptics', record);
    check(await fresh.playEffect('dual-rumble', {startDelay: 10, duration: 10}) === 'complete', 'scheduled effect completes');
    window.removeEventListener('device-haptics', record);
    check(phases.join() === 'delayed,playing,idle', 'real timer emits ordered phases');
    old = fresh.playEffect('dual-rumble', {startDelay: 5000, strongMagnitude: 0.8, weakMagnitude: 0.4});
    w.hapticPanelSide = 'left'; await stage('delayed');
    const playing = fresh.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.8, weakMagnitude: 0.4});
    check(await old === 'preempted', 'visible delayed request replaced'); await stage('playing');
    check(await playing === 'complete', 'visible effect completes'); await stage('idle');
    old = b.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.25, weakMagnitude: 1});
    w.hapticPanelSide = 'right'; await stage('right');
    await b.reset(); check(await old === 'preempted', 'panel reset preempts'); await stage('idle-reset');
    // Genuine separately injected realm borrows methods in both directions.
    child = document.createElement('iframe'); child.src = '/csp';
    const ready = new Promise(resolve => { child!.onload = resolve; }); document.body.append(child); await ready;
    const other = child.contentWindow as any, childSession = await setup(other);
    const c = childSession.inputSources[0].gamepad.vibrationActuator;
    const borrowed = a.playEffect.call(c, 'dual-rumble');
    check(borrowed instanceof w.Promise && await borrowed === 'complete', 'borrowed parent operation accepts genuine child');
    check(await c.playEffect.call(fresh, 'dual-rumble') === 'complete', 'borrowed child operation accepts genuine parent');
    check(c instanceof other.Object && c.effects instanceof other.Array && childSession.inputSources[0] instanceof other.Object, 'child source, actuator and effects owner realm');
    for (const [type, parameters] of [[Symbol(), {}], [{toString:()=>Symbol()}, {}], ['dual-rumble', {duration:{valueOf:()=>BigInt(1)}}]]) {
      let error: any; try { await c.playEffect(type, parameters); } catch (caught) { error = caught; }
      check(error instanceof other.TypeError, 'conversion errors belong to child binding realm');
    }
    const sentinel = new w.Error('caller sentinel'); let caught: any;
    try { await c.playEffect('dual-rumble', {get duration() {throw sentinel;}}); } catch (error) {caught = error;}
    check(caught === sentinel, 'caller-thrown conversion errors retain identity');
    const parentEffect = fresh.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.8, weakMagnitude: 0.4});
    old = c.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.25, weakMagnitude: 1});
    w.hapticPanelSide = 'right'; await stage('frames');
    child.remove(); child = undefined;
    check(await old === 'preempted', 'child pagehide cancels pending effects');
    await stage('frame-removed'); await fresh.reset();
    check(await parentEffect === 'preempted', 'child cleanup leaves parent playing until reset'); await stage('all-idle');
    old = fresh.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.8, weakMagnitude: 0.4});
    w.hapticPanelSide = 'left'; await stage('tab-routing'); await fresh.reset();
    check(await old === 'preempted', 'tab-routing probe leaves actuator resettable');
    old = fresh.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.8, weakMagnitude: 0.4}); await stage('session-end'); await s.end();
    check(await old === 'preempted', 'session end settles effect'); await stage('idle-end');
    await rejects(fresh.playEffect('dual-rumble'), 'InvalidStateError', 'ended source cannot vibrate');
    s = await setup();
    const next = s.inputSources[0].gamepad.vibrationActuator;
    check(next !== b && await next.playEffect('dual-rumble') === 'complete', 'session restart uses fresh actuator');
    await rejects(b.playEffect('dual-rumble'), 'InvalidStateError', 'old session cannot affect new session');
    old = next.playEffect('dual-rumble', {duration: 5000, strongMagnitude: 0.25, weakMagnitude: 1});
    w.hapticPanelSide = 'right'; await stage('settings');
    check(await old === 'preempted' && s.ended, 'actual panel settings end session and settle output'); await stage('idle-settings');
    return {mode, assertions: passed.length, passed};
  } finally { child?.remove(); if (!s.ended) await s.end(); w.hapticPanelStage = ''; }
}
