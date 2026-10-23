import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';

type API = typeof Runtime & typeof Layers & {navigator: {xr: Runtime.XRSystem}; Event: typeof Event; EventTarget: typeof EventTarget; Object: typeof Object};

/** XR adaptation of pinned WPT handler/IDL/frame assertions; inventory records provenance. */
export async function runEvents(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'event-interface-realm'; frame.src = '/frame'; document.body.append(frame);
  });
  await page.frameLocator('#event-interface-realm').locator('body').waitFor();
  const opened = page.waitForEvent('popup');
  const handle = await page.evaluateHandle(() => window.open('/frame'));
  const popup = await opened;
  try {
    await popup.waitForLoadState();
    await popup.waitForFunction(() => !!(window as unknown as API).XRSessionEvent);
    return await page.evaluate(async ({mode, handheld, popupWindow}) => {
      const w = window as unknown as API;
      const passed: string[] = [], failures: unknown[] = [];
      function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed.push(label); }
      function throws(action: () => unknown, name: string, label: string) {
        let error: unknown; try { action(); } catch (caught) { error = caught; }
        check(error !== null && typeof error === 'object' && (error as Error).name === name, `${label}: ${name} (got ${String(error)})`);
      }
      function guard(action: (event: Event) => unknown) { return (event: Event) => { try { return action(event); } catch (error) { failures.push(error); } }; }
      function clean() { if (failures.length) throw failures[0]; }
      async function setup(realm: Window, sessionMode: SessionMode) {
        const api = realm as unknown as API;
        const session = await api.navigator.xr.requestSession(sessionMode);
        const canvas = realm.document.createElement('canvas'); realm.document.body.append(canvas);
        session.updateRenderState({baseLayer: new api.XRWebGLLayer(session, canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!)});
        const base = await session.requestReferenceSpace('viewer');
        const next = <T>(read: (frame: Runtime.XRFrame) => T) => new Promise<T>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Event contract frame timeout')), 5000);
          session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(read(frame)); } catch (error) { reject(error); } });
        });
        const close = async () => { session._device._updateInputButtonPressed(false, 0, 0); session._device._updateInputButtonPressed(false, 0, 1); if (!session.ended) await session.end(); canvas.remove(); };
        return {session, base, next, close};
      }
      type Test = Awaited<ReturnType<typeof setup>>;
      function context(event: Event, target: EventTarget, receiver: unknown, label: string) {
        check(receiver === target && event.target === target && event.currentTarget === target && event.eventPhase === Event.AT_TARGET, `${label}: receiver/target/currentTarget/phase`);
      }
      function handlers(target: Runtime.XRSystem | Runtime.XRSession, names: string[]) {
        const properties = target as unknown as Record<string, unknown>;
        for (const name of names) {
          const key = `on${name}`, order: string[] = [];
          check(properties[key] === null && !Object.prototype.hasOwnProperty.call(properties, key), `${key}: initial null prototype accessor`);
          const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), key)!;
          check(!!descriptor.get && !!descriptor.set && descriptor.enumerable, `${key}: IDL accessor descriptor`);
          for (const primitive of [undefined, null, false, true, 0, 42, '', 'code', Symbol(), BigInt(1)]) {
            properties[key] = primitive; check(properties[key] === null, `${key}: primitive becomes null (${typeof primitive})`);
          }
          const before = () => order.push('before'), after = () => order.push('after');
          target.addEventListener(name, before);
          const object = {handleEvent() { throw new Error('Property handler must not call handleEvent'); }};
          properties[key] = object; check(properties[key] === object, `${key}: non-callable object identity`);
          target.addEventListener(name, after);
          target.dispatchEvent(new Event(name)); check(order.join() === 'before,after', `${key}: non-callable object is not invoked`); order.length = 0;
          const callback = function(this: EventTarget, event: Event) { context(event, target, this, key); order.push('handler'); };
          properties[key] = callback;
          target.dispatchEvent(new Event(name)); clean(); check(order.join() === 'before,handler,after', `${key}: replacement preserves object registration position`); order.length = 0;
          properties[key] = guard(event => { context(event, target, target, key); order.push('replacement'); });
          target._emit(new Event(name)); clean(); check(order.join() === 'before,replacement,after', `${key}: emulator emit delivers once in dispatch order`); order.length = 0;
          properties[key] = null; target.dispatchEvent(new Event(name)); check(order.join() === 'before,after', `${key}: null deactivates`); order.length = 0;
          properties[key] = callback; target.dispatchEvent(new Event(name)); clean(); check(order.join() === 'before,after,handler', `${key}: reactivation registers at end`); order.length = 0;
          properties[key] = 0; target.dispatchEvent(new Event(name)); check(order.join() === 'before,after', `${key}: primitive removes active handler`);
          target.removeEventListener(name, before); target.removeEventListener(name, after);
          const stop = (event: Event) => event.stopImmediatePropagation();
          target.addEventListener(name, stop); let calls = 0;
          properties[key] = () => { calls++; };
          target.dispatchEvent(new Event(name)); check(calls === 0, `${key}: earlier immediate stop suppresses property`);
          target.removeEventListener(name, stop);
          let later = 0; const tail = () => { later++; };
          properties[key] = (event: Event) => { calls++; event.stopImmediatePropagation(); };
          target.addEventListener(name, tail); target.dispatchEvent(new Event(name));
          check(Number(calls) === 1 && later === 0, `${key}: property immediate stop suppresses later listener`);
          for (const result of [false, true, 0, null, new Boolean(false)]) {
            properties[key] = () => result;
            const event = new Event(name, {cancelable: true});
            check(target.dispatchEvent(event) === (result !== false) && event.defaultPrevented === (result === false), `${key}: only literal false cancels and changes dispatch result`);
          }
          properties[key] = () => false;
          let publicCancelCalls = 0;
          const overridden = new Event(name, {cancelable: true}); overridden.preventDefault = () => { publicCancelCalls++; };
          check(!target.dispatchEvent(overridden) && overridden.defaultPrevented && publicCancelCalls === 0, `${key}: false cancellation uses native event state`);
          const uncancelable = new Event(name); check(target.dispatchEvent(uncancelable) && !uncancelable.defaultPrevented, `${key}: false respects cancelable flag`);
          const marker = new Error(`Expected ${key} exception`); let reports = 0;
          const receive = (event: ErrorEvent) => { if (event.error === marker) { reports++; event.preventDefault(); } };
          window.addEventListener('error', receive);
          try {
            properties[key] = () => { throw marker; }; const previous = later;
            check(target.dispatchEvent(new Event(name)), `${key}: exception does not escape dispatch`);
            check(reports === 1 && later === previous + 1, `${key}: exception reported once and later listener runs`);
            target._emit(new Event(name)); check(Number(reports) === 2 && later === previous + 2, `${key}: exception does not escape emulator emit`);
          } finally { window.removeEventListener('error', receive); properties[key] = null; target.removeEventListener(name, tail); }
        }
      }
      function constructors(session: Runtime.XRSession, frame: Runtime.XRFrame, source: Runtime.XRInputSource) {
        const cases = [
          {C: w.XRSessionEvent, init: {session}, keys: ['session']},
          {C: w.XRInputSourceEvent, init: {frame, inputSource: source}, keys: ['frame', 'inputSource']},
          {C: w.XRInputSourcesChangeEvent, init: {session, added: [source, source], removed: [source]}, keys: ['added', 'removed', 'session']},
        ];
        for (const {C, init, keys} of cases) {
          const label = C.name;
          const construct = (...args: unknown[]) => Reflect.construct(C, args) as Event & Record<string, unknown>;
          check(Object.getPrototypeOf(C.prototype) === Event.prototype && Object.getPrototypeOf(C) === Event, `${label}: direct Event inheritance`);
          for (const args of [[], ['x'], ['x', undefined], ['x', null], ['x', {}], ['x', 1], ['x', 'dictionary']]) throws(() => construct(...args), 'TypeError', `${label}: required arguments/dictionary`);
          const defaults = construct(undefined, init);
          check(defaults.type === 'undefined' && !defaults.bubbles && !defaults.cancelable && !defaults.composed, `${label}: DOMString and EventInit defaults`);
          for (const type of [null, 42, BigInt(1), true]) check(construct(type, init).type === String(type), `${label}: type conversion (${typeof type})`);
          throws(() => construct(Symbol(), init), 'TypeError', `${label}: Symbol type rejects`);
          const reads: string[] = [];
          const dictionary = Object.create(null);
          // Inherited, non-enumerable getters deliberately installed in reverse order.
          for (const key of [...['bubbles', 'cancelable', 'composed'], ...keys].reverse()) Object.defineProperty(dictionary, key, {get() { reads.push(key); return key in init ? (init as Record<string, unknown>)[key] : 1; }});
          const event = construct({toString() { reads.push('type'); return 'converted'; }}, Object.create(dictionary));
          check(reads.join() === ['type', 'bubbles', 'cancelable', 'composed', ...keys].join(), `${label}: inherited getters once in base-to-derived lexical order`);
          check(event.type === 'converted' && event.bubbles && event.cancelable && event.composed, `${label}: converted EventInit flags`);
          for (const key of keys) {
            const value = event[key], descriptor = Object.getOwnPropertyDescriptor(C.prototype, key)!;
            check(!Object.prototype.hasOwnProperty.call(event, key) && typeof descriptor.get === 'function' && descriptor.set === undefined && descriptor.enumerable && descriptor.configurable, `${label}.${key}: readonly enumerable prototype accessor`);
            check(!Reflect.set(event, key, null) && event[key] === value && event[key] === event[key], `${label}.${key}: stable identity and assignment rejected`);
            for (const fake of [{}, Object.create(C.prototype), new Proxy(event, {})]) throws(() => descriptor.get!.call(fake), 'TypeError', `${label}.${key}: branded getter`);
            for (const invalid of [undefined, null]) throws(() => construct('x', {...init, [key]: invalid}), 'TypeError', `${label}.${key}: required nonnull member`);
            const missing = {...init}; delete (missing as Record<string, unknown>)[key];
            throws(() => construct('x', missing), 'TypeError', `${label}.${key}: missing member`);
            const marker = new Error(`${label}.${key} getter`);
            let caught: unknown; try { construct('x', Object.defineProperty({...init}, key, {get() { throw marker; }})); } catch (error) { caught = error; }
            check(caught === marker, `${label}.${key}: getter exception identity`);
          }
        }
        for (const [key, value, prototype, C, init] of [
          ['session', session, w.XRSession.prototype, w.XRSessionEvent, {session}],
          ['frame', frame, w.XRFrame.prototype, w.XRInputSourceEvent, {frame, inputSource: source}],
          ['inputSource', source, w.XRInputSource.prototype, w.XRInputSourceEvent, {frame, inputSource: source}],
          ['session', session, w.XRSession.prototype, w.XRInputSourcesChangeEvent, {session, added: [], removed: []}],
        ] as const) for (const fake of [{}, Object.create(prototype), new Proxy(value, {})]) throws(() => Reflect.construct(C, ['x', {...init, [key]: fake}]), 'TypeError', `${C.name}.${key}: rejects interface forgery/proxy`);
        for (const key of ['added', 'removed']) {
          for (const invalid of [1, 'not an object sequence', {}, {length: 1, 0: source}, {[Symbol.iterator]: 1}, [null], [undefined], [source, {}], [new Proxy(source, {})], [Object.create(w.XRInputSource.prototype)]]) {
            throws(() => Reflect.construct(w.XRInputSourcesChangeEvent, ['x', {session, added: [], removed: [], [key]: invalid}]), 'TypeError', `${key}: rejects invalid sequence or element`);
          }
          for (const stage of ['iterator-get', 'iterator-call', 'next-get', 'next-call', 'done-get', 'value-get']) {
            const marker = new Error(stage); let caught: unknown;
            const sequence = {get [Symbol.iterator]() {
              if (stage === 'iterator-get') throw marker;
              return () => {
                if (stage === 'iterator-call') throw marker;
                return {get next() {
                  if (stage === 'next-get') throw marker;
                  return () => { if (stage === 'next-call') throw marker; return {get done() { if (stage === 'done-get') throw marker; return false; }, get value() { throw marker; }}; };
                }};
              };
            }};
            try { Reflect.construct(w.XRInputSourcesChangeEvent, ['x', {session, added: [], removed: [], [key]: sequence}]); } catch (error) { caught = error; }
            check(caught === marker, `${key}: ${stage} exception identity`);
          }
        }
        const unchanged = [source];
        throws(() => Reflect.construct(w.XRInputSourcesChangeEvent, ['x', {session, added: unchanged, removed: [source, null]}]), 'TypeError', 'failed later conversion leaves caller arrays mutable');
        check(!Object.isFrozen(unchanged) && !Object.isFrozen(source), 'failed construction does not freeze caller data');
        const same = new w.XRInputSourcesChangeEvent('x', {session, added: unchanged, removed: unchanged});
        check(same.added !== same.removed && same.added !== unchanged && same.removed !== unchanged, 'same input array produces two independent snapshots');
        const added = [source, source], removed = [source];
        const event = new w.XRInputSourcesChangeEvent('x', {session, added, removed});
        check(Object.isFrozen(event.added) && Object.isFrozen(event.removed) && event.added !== added && event.removed !== removed && event.added !== event.removed, 'change arrays are independent frozen snapshots');
        added.length = 0; removed.push(source); Reflect.set(source, 'eventFixture', 42);
        check(event.added.length === 2 && event.removed.length === 1 && event.added.every(input => input === source) && !Object.isFrozen(source) && !Object.isFrozen(added) && !Object.isFrozen(removed), 'caller mutations leave ordered duplicate snapshots independent and sources mutable');
        Reflect.deleteProperty(source, 'eventFixture');
        check(!Reflect.set(event.added, '0', null) && !Reflect.set(event.removed, 'length', 0), 'snapshot mutation rejects');
        let iterations = 0;
        const iterable = {[Symbol.iterator]: function* () { iterations++; yield source; yield source; }};
        const sequence = new w.XRInputSourcesChangeEvent('x', {session, added: iterable, removed: new Set([source])});
        check(iterations === 1 && sequence.added.length === 2 && sequence.removed[0] === source, 'one-shot iterable and Set conversion');
      }
      const sessionNames = ['end', 'visibilitychange', 'inputsourceschange', 'selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend'];
      handlers(w.navigator.xr, ['devicechange']);
      const live = await setup(window, mode);
      let held!: Runtime.XRFrame, source!: Runtime.XRInputSource;
      try {
        handlers(live.session, sessionNames);
        throws(() => Reflect.construct(w.XRSessionEvent, ['x', {session: new w.XREventTarget()}]), 'TypeError', 'generic XR event target is not an allocated session');
        check(!live.session.ended, 'synthetic lifecycle dispatch does not end session');
        // Use the real adapter's input sampling, including Android transient activation.
        await live.next(frame => { held = frame; });
        const order: string[] = [], frames: Runtime.XRFrame[] = [];
        const seen = new Map<string, number>();
        const marker = new Error('Expected live input property exception'); let reports = 0;
        const receive = (event: ErrorEvent) => { if (event.error === marker) { reports++; event.preventDefault(); } };
        window.addEventListener('error', receive);
        for (const name of ['inputsourceschange', 'selectstart', 'select', 'selectend', ...(!handheld ? ['squeezestart', 'squeeze', 'squeezeend'] : [])]) {
          const inspect = function(this: EventTarget, event: Event, style: string) {
            context(event, live.session, this, `real ${name}/${style}`);
            seen.set(`${name}/${style}`, (seen.get(`${name}/${style}`) ?? 0) + 1);
            if (name === 'inputsourceschange') {
              const change = event as Runtime.XRInputSourcesChangeEvent;
              if (style === 'listener') order.push(change.added.length ? 'added' : 'removed');
              check(change.session === live.session, `real ${name}/${style}: session identity`);
            } else {
              const input = event as Runtime.XRInputSourceEvent; source = input.inputSource; frames.push(input.frame);
              if (style === 'listener') order.push(name);
              check(input.frame.getPose(source.targetRaySpace, live.base) !== null, `real ${name}/${style}: live pose`);
              throws(() => input.frame.getViewerPose(live.base), 'InvalidStateError', `real ${name}/${style}: event viewer pose rejects`);
            }
          };
          live.session.addEventListener(name, guard(event => inspect.call(live.session, event, 'listener')));
          Reflect.set(live.session, `on${name}`, function(this: EventTarget, event: Event) {
            try { inspect.call(this, event, 'property'); } catch (error) { failures.push(error); }
            if (name === 'selectstart') throw marker;
          });
          // This listener must still run after the throwing property handler.
          live.session.addEventListener(name, guard(() => { seen.set(`${name}/tail`, (seen.get(`${name}/tail`) ?? 0) + 1); }));
        }
        try {
          if (!handheld) {
            live.session._device.gamepadInputSources[0].active = false; await live.next(() => {});
            live.session._device.gamepadInputSources[0].active = true; await live.next(() => {});
            clean(); check(seen.get('inputsourceschange/listener') === 2 && seen.get('inputsourceschange/property') === 2, 'Quest source change events both styles once');
            order.length = 0;
          }
          for (const button of handheld ? [0] : [0, 1]) {
            live.session._device._updateInputButtonPressed(true, 0, button); await live.next(() => {}); clean();
            live.session._device._updateInputButtonPressed(false, 0, button); await live.next(() => {}); clean();
          }
          check(reports === 1, 'live throwing property exception reported exactly once');
          for (const name of ['selectstart', 'select', 'selectend', ...(!handheld ? ['squeezestart', 'squeeze', 'squeezeend'] : [])]) check(seen.get(`${name}/listener`) === 1 && seen.get(`${name}/property`) === 1 && seen.get(`${name}/tail`) === 1, `real ${name}: both styles once with subsequent listener`);
          check(handheld ? order.join() === 'added,selectstart,select,selectend,removed' : order.join() === 'selectstart,select,selectend,squeezestart,squeeze,squeezeend', 'real source/action ordering');
          if (handheld) check(seen.get('inputsourceschange/listener') === 2 && seen.get('inputsourceschange/property') === 2, 'transient change events both styles once');
          for (const frame of frames) throws(() => frame.getPose(source.targetRaySpace, live.base), 'InvalidStateError', 'retained real event frame inactive after dispatch/exception');
          constructors(live.session, held, source);
        } finally { window.removeEventListener('error', receive); }
        // Synthetic dispatch never activates a retained frame or virtual action.
        for (const name of sessionNames) Reflect.set(live.session, `on${name}`, null);
        const inline = await setup(window, 'inline');
        try {
          handlers(inline.session, sessionNames);
          let synthetic = 0;
          inline.session.onselect = guard(event => {
            synthetic++; const input = event as Runtime.XRInputSourceEvent;
            throws(() => input.frame.getPose(source.targetRaySpace, live.base), 'InvalidStateError', 'synthetic event cannot activate retained frame');
          });
          const syntheticEvent = new w.XRInputSourceEvent('select', {frame: held, inputSource: source});
          check(inline.session.dispatchEvent(syntheticEvent), 'synthetic input dispatch succeeds on unrelated inline target'); clean();
          inline.session.dispatchEvent(new w.XRSessionEvent('end', {session: live.session}));
          inline.session.dispatchEvent(new w.XRInputSourcesChangeEvent('inputsourceschange', {session: live.session, added: [source], removed: []}));
          check(synthetic === 1 && !inline.session.ended && inline.session.inputSources.length === 0, 'synthetic events have no inline session/input side effects');
        } finally { await inline.close(); }
        await live.next(() => {});
        let visibility = 0;
        const visibilityListener = guard(event => { context(event, live.session, live.session, 'real visibility/listener'); visibility++; });
        live.session.addEventListener('visibilitychange', visibilityListener);
        live.session.onvisibilitychange = guard(event => { context(event, live.session, live.session, 'real visibility/property'); visibility++; });
        live.session._setVisibility('visible-blurred'); live.session._setVisibility('visible'); clean();
        check(visibility === 4, 'real visibility changes delivered once through both styles');
        live.session.removeEventListener('visibilitychange', visibilityListener); live.session.onvisibilitychange = null;
      } finally {
        for (const name of sessionNames) Reflect.set(live.session, `on${name}`, null);
        await live.close();
      }
      const iframeWindow = document.querySelector<HTMLIFrameElement>('#event-interface-realm')!.contentWindow!;
      check(popupWindow!.opener === window && popupWindow!.parent === popupWindow, 'real opener-linked popup fixture');
      for (const [realm, label] of [[iframeWindow, 'iframe'], [popupWindow!, 'popup']] as const) {
        const other = realm as unknown as API;
        check(other.XRSessionEvent !== w.XRSessionEvent && other.XRSession !== w.XRSession, `${label}: separate injection constructors`);
        const foreign = await setup(realm, mode);
        let foreignFrame!: Runtime.XRFrame, foreignSource!: Runtime.XRInputSource;
        try {
          foreign.session._device._updateInputButtonPressed(true, 0, 0);
          await foreign.next(frame => { foreignFrame = frame; foreignSource = foreign.session.inputSources[0]; });
          check(!!foreignSource, `${label}: real allocated foreign input source`);
          check(foreign.session instanceof other.EventTarget && !(foreign.session instanceof w.XRSession), `${label}: session retains its realm prototype`);
          check(foreignSource instanceof other.Object && !(foreignSource instanceof w.XRInputSource), `${label}: input source retains its realm prototype`);
          // Cross-session, inactive-frame and ended-session values are all legal init data.
          const combinations: [Runtime.XRSession, Runtime.XRFrame, Runtime.XRInputSource][] = [[live.session, foreignFrame, source], [foreign.session, held, foreignSource]];
          for (const api of [w, other]) for (const [session, frame, inputSource] of combinations) {
            check(new api.XRSessionEvent('x', {session}).session === session, `${label}: session conversion across realms/end`);
            const event = new api.XRInputSourceEvent('x', {frame, inputSource});
            check(event.frame === frame && event.inputSource === inputSource, `${label}: mixed-session inactive interfaces accepted`);
            const change: Runtime.XRInputSourcesChangeEvent = new api.XRInputSourcesChangeEvent('x', {session, added: [source, foreignSource, source], removed: new Set([foreignSource])});
            check(change.session === session && change.added[1] === foreignSource && change.removed[0] === foreignSource, `${label}: cross-realm sequence identities`);
            for (const fake of [Object.create(other.XRSession.prototype), new Proxy(foreign.session, {})]) throws(() => Reflect.construct(api.XRSessionEvent, ['x', {session: fake}]), 'TypeError', `${label}: foreign session forgery/proxy`);
            for (const fake of [Object.create(other.XRFrame.prototype), new Proxy(foreignFrame, {})]) throws(() => Reflect.construct(api.XRInputSourceEvent, ['x', {frame: fake, inputSource}]), 'TypeError', `${label}: foreign frame forgery/proxy`);
            for (const fake of [Object.create(other.XRInputSource.prototype), new Proxy(foreignSource, {})]) throws(() => Reflect.construct(api.XRInputSourcesChangeEvent, ['x', {session, added: [fake], removed: []}]), 'TypeError', `${label}: foreign input source forgery/proxy`);
          }
        } finally { await foreign.close(); }
        check(new w.XRSessionEvent('x', {session: foreign.session}).session === foreign.session, `${label}: ended foreign session allowed`);
        throws(() => foreignFrame.getPose(foreignSource.targetRaySpace, foreign.base), 'InvalidStateError', `${label}: construction did not reactivate foreign frame`);
      }
      // Shutdown is task-queued, singular, and fully cleaned up before delivery.
      const ending = await setup(window, mode); let ends = 0, synchronous = true;
      const end = guard(event => { context(event, ending.session, ending.session, 'real end'); check(!synchronous && ending.session.ended && ending.session.inputSources.length === 0, 'end delivery follows complete asynchronous cleanup'); ends++; });
      ending.session.addEventListener('end', end); ending.session.onend = end;
      const done = ending.session.end(); synchronous = false;
      await done; await new Promise(resolve => setTimeout(resolve, 20)); clean();
      check(ends === 2, 'one end event delivered to both styles exactly once'); await ending.close();
      return {mode, handheld, assertions: passed.length, passed, skipped: []};
    }, {mode, handheld, popupWindow: handle});
  } finally {
    await handle.dispose(); await popup.close();
    await page.locator('#event-interface-realm').evaluateAll(frames => frames.forEach(frame => frame.remove()));
  }
}

/** Observe actual panel-to-page devicechange delivery during the existing profile switch. */
export async function startDeviceChangeProbe(page: Page) {
  return page.evaluateHandle(() => {
    const target = (window as unknown as API).navigator.xr;
    const state = {order: [] as string[], valid: true};
    const record = function(this: EventTarget, event: Event, style: string) {
      state.valid &&= this === target && event.target === target && event.currentTarget === target && event.eventPhase === Event.AT_TARGET;
      state.order.push(style);
    };
    const listener = function(this: EventTarget, event: Event) { record.call(this, event, 'listener'); };
    target.addEventListener('devicechange', listener);
    target.ondevicechange = function(this: EventTarget, event: Event) { record.call(this, event, 'property'); };
    return {state, cleanup() { target.removeEventListener('devicechange', listener); target.ondevicechange = null; }};
  });
}
