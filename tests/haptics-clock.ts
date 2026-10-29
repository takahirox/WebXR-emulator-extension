import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHaptics} from '../src/polyfill/api/haptics';
import {isDeviceMessage, isPanelMessage} from '../src/types/contracts';
import type {PolyfillGlobal} from '../src/types/polyfill';

test('deterministic scheduled effects, cancellation, bounds and stale timers', async () => {
  let time = 0, next = 0, live = true;
  const tasks = new Map<number, {at: number; callback: () => void}>(), saved: (() => void)[] = [];
  const states: any[] = [];
  const global = {Promise, TypeError, DOMException, Object, Array, String, Math, document: {visibilityState: 'visible', defaultView: {}}, frameElement: null,
    setTimeout(callback: () => void, delay: number) { const id = ++next; tasks.set(id, {at: time + delay, callback}); saved.push(callback); return id; },
    clearTimeout(id: number) { tasks.delete(id); },
  } as unknown as PolyfillGlobal;
  function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      const task = [...tasks].sort((a,b) => a[1].at - b[1].at)[0];
      if (!task || task[1].at > end) break;
      tasks.delete(task[0]); time = task[1].at; task[1].callback();
    }
    time = end;
  }
  const allocate = createHaptics(global), a = allocate(() => live, state => states.push(state));
  let settled = false;
  const delayed = a.value.playEffect('dual-rumble', {startDelay: 100, duration: 250, strongMagnitude: 0.8, weakMagnitude: 0.4});
  void delayed.then(() => { settled = true; });
  assert.equal(states[states.length - 1].state, 'delayed'); advance(99); await Promise.resolve(); assert(!settled);
  advance(1); assert.deepEqual(states[states.length - 1], {state:'playing',startDelay:0,duration:250,strongMagnitude:0.8,weakMagnitude:0.4});
  advance(249); await Promise.resolve(); assert(!settled); advance(1); assert.equal(await delayed, 'complete'); assert.equal(states[states.length - 1].state, 'idle');
  const old = a.value.playEffect('dual-rumble', {duration: 5000});
  const stale = saved[saved.length - 1]!;
  const replacement = a.value.playEffect('dual-rumble', {duration: 10});
  stale(); advance(0); assert.equal(await old, 'preempted'); assert.equal(states[states.length - 1].state, 'playing'); advance(10); assert.equal(await replacement, 'complete');
  for (const parameters of [{duration:1e100,startDelay:0},{duration:-1,startDelay:0},{duration:5000,startDelay:5000},{duration:Infinity,startDelay:NaN}]) {
    const p = a.value.playEffect('dual-rumble', parameters); const event = states[states.length - 1];
    assert(event.duration + event.startDelay <= 5000); advance(5000); assert.equal(await p, 'complete');
  }
  const waiting = a.value.playEffect('dual-rumble', {startDelay:4000,duration:1000});
  live = false; a.cancel(); advance(0); assert.equal(await waiting,'preempted'); advance(5000);
  await assert.rejects(a.value.playEffect('dual-rumble'), {name:'InvalidStateError'});
  assert.equal(tasks.size,0);
});

test('haptics bridge accepts bounded diagnostics only', () => {
  const valid = {action:'device-haptics',objectName:'leftController',sessionId:1,sourceId:2,state:'playing',duration:250,startDelay:0,strongMagnitude:0.8,weakMagnitude:0.4};
  assert.equal(isDeviceMessage(valid), true); assert.equal(isPanelMessage(valid), false);
  for (const patch of [{objectName:'headset'},{duration:Infinity},{duration:-1},{duration:5001},{duration:4000,startDelay:2000},{strongMagnitude:1.1},{weakMagnitude:NaN},{sessionId:0},{sourceId:1.5},{state:'eval'}] as Record<string, unknown>[]) assert(!isDeviceMessage({...valid,...patch}),JSON.stringify(patch));
});

test('retirement flushes queued reset/preemption without discarded-document timers', async () => {
  const tasks = new Map<number, () => void>(); let next = 0;
  const global = {Promise, TypeError, DOMException, Object, Array, String, Math, document: {visibilityState:'visible',defaultView:{}},frameElement:null,
    setTimeout(fn:()=>void) {const id=++next;tasks.set(id,fn);return id;}, clearTimeout(id:number) {tasks.delete(id);}} as unknown as PolyfillGlobal;
  const a = createHaptics(global)(()=>true,()=>{});
  const old=a.value.playEffect('dual-rumble',{duration:100});
  const reset=a.value.reset(); a.retire();
  assert.equal(await old,'preempted');assert.equal(await reset,'complete');assert.equal(tasks.size,0);
});
