import type {Page} from 'playwright';
import type {DeviceConfig, SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';

type XRWindow = typeof Runtime & typeof Layers & {navigator: {xr: Runtime.XRSystem}; CustomWebXRPolyfill: new () => unknown};

/** Conversion and negotiation through the installed extension's public API. */
export async function runSessionRequest(page: Page, mode: SessionMode, handheld: boolean) {
  await page.evaluate('globalThis.__name = value => value');
  return page.evaluate(async ({mode, handheld}) => {
    const w = window as unknown as XRWindow, xr = w.navigator.xr;
    const passed: string[] = [];
    let context = '';
    function check(value: unknown, label: string) {
      if (!value) throw new Error(`${context}: ${label}`);
      passed.push(`${context}: ${label}`);
    }
    async function rejects(action: () => Promise<unknown>, reason: string | object, label: string) {
      // Invoke outside the catch so a synchronous throw fails the assertion.
      const promise = action(); check(promise instanceof Promise, `${label}: promise returned`);
      let error: unknown; try { await promise; } catch (caught) { error = caught; }
      check(typeof reason === 'string' ? error instanceof Error && error.name === reason : error === reason, `${label}: rejection ${String(error)}`);
    }
    for (const sessionMode of ['inline', mode] as const) {
      context = sessionMode;
      const resources = document.querySelectorAll('[popover], canvas').length;
      for (const invalid of [undefined, null, '', 'invalid', Symbol('mode'), {toString: () => Symbol('mode')}]) {
        await rejects(() => xr.isSessionSupported(invalid), 'TypeError', 'invalid support mode');
        await rejects(() => xr.requestSession(invalid, {get depthSensing() { throw new Error('options read before mode'); }}), 'TypeError', 'mode before dictionary');
      }
      await rejects(() => xr.isSessionSupported(), 'TypeError', 'missing support mode');
      await rejects(() => xr.requestSession(), 'TypeError', 'missing request mode');
      let modeReads = 0;
      check(await xr.isSessionSupported({[Symbol.toPrimitive](hint: string) { check(hint === 'string', 'mode uses string hint'); modeReads++; return sessionMode; }}), 'convertible support mode');
      check(modeReads === 1, 'support mode converted once');
      for (const options of [undefined, null, {}, () => {}, {depthSensing: undefined, domOverlay: undefined, optionalFeatures: undefined, requiredFeatures: undefined}]) {
        const session = await xr.requestSession({toString() { modeReads++; return sessionMode; }}, options);
        check(session.enabledFeatures.join(',') === (sessionMode === 'inline' ? 'viewer' : 'viewer,local'), 'default feature grants for empty dictionary');
        await session.end();
      }
      check(modeReads === 6, 'each request converts mode once');
      for (const options of [false, true, 0, 1, '', 'dictionary', Symbol(), BigInt(1)]) await rejects(() => xr.requestSession(sessionMode, options), 'TypeError', 'primitive dictionary');
      for (const member of ['optionalFeatures', 'requiredFeatures']) {
        for (const value of [null, 'viewer', 1, {}, {length: 1, 0: 'viewer'}, {[Symbol.iterator]: 1}, {[Symbol.iterator]: () => 0}, {[Symbol.iterator]: () => ({next: () => 1})}, [Symbol()]]) {
          await rejects(() => xr.requestSession(sessionMode, {[member]: value}), 'TypeError', `${member} invalid sequence`);
        }
      }
      const sentinel = new Error('conversion sentinel');
      await rejects(() => xr.isSessionSupported({toString() { throw sentinel; }}), sentinel, 'support conversion reason');
      await rejects(() => xr.requestSession({toString() { throw sentinel; }}), sentinel, 'request conversion reason');
      for (const member of ['depthSensing', 'domOverlay', 'optionalFeatures', 'requiredFeatures']) await rejects(() => xr.requestSession(sessionMode, {get [member]() { throw sentinel; }}), sentinel, `${member} getter reason`);
      await rejects(() => xr.requestSession(sessionMode, {requiredFeatures: [{toString() { throw sentinel; }}]}), sentinel, 'feature conversion reason');
      await rejects(() => xr.requestSession(sessionMode, {requiredFeatures: {[Symbol.iterator]() { throw sentinel; }}}), sentinel, 'iterator reason');
      await rejects(() => xr.requestSession(sessionMode, {requiredFeatures: {[Symbol.iterator]: () => ({next() { throw sentinel; }})}}), sentinel, 'next reason');
      for (const member of ['dataFormatPreference', 'depthTypeRequest', 'matchDepthView', 'usagePreference']) {
        await rejects(() => xr.requestSession(sessionMode, {depthSensing: {dataFormatPreference: [], usagePreference: [], get [member]() { throw sentinel; }}}), sentinel, `depth ${member} getter reason`);
      }
      await rejects(() => xr.requestSession(sessionMode, {domOverlay: {get root() { throw sentinel; }}}), sentinel, 'root getter reason');
      for (const matchDepthView of [undefined, null, false, true, 0, 1, '', 'false', Symbol(), {valueOf() { throw sentinel; }}]) {
        const converted = await xr.requestSession(sessionMode, {depthSensing: {dataFormatPreference: [], usagePreference: [], matchDepthView}});
        check(!converted.enabledFeatures.includes('depth-sensing'), 'boolean conversion with no implicit depth grant'); await converted.end();
      }
      for (const depthSensing of [null, {}, () => {}, 1, {dataFormatPreference: []}, {usagePreference: []}, {dataFormatPreference: null, usagePreference: []}, {dataFormatPreference: [], usagePreference: 'cpu-optimized'}, {dataFormatPreference: ['invalid'], usagePreference: []}, {dataFormatPreference: [], usagePreference: [], depthTypeRequest: ['invalid']}, {dataFormatPreference: [], usagePreference: [], depthTypeRequest: null}]) {
        await rejects(() => xr.requestSession(sessionMode, {depthSensing}), 'TypeError', 'depth converted without feature descriptor');
      }
      for (const domOverlay of [{}, 1, {root: null}, {root: {}}, {root: document}, {root: Object.create(Element.prototype)}]) await rejects(() => xr.requestSession(sessionMode, {domOverlay}), 'TypeError', 'overlay converted without descriptor');
      check(document.querySelectorAll('[popover], canvas').length === resources, 'conversion failures create no presentation resources');

      const trace: string[] = [];
      const record = (key: string, value: unknown) => { trace.push(key); return value; };
      const input = new Proxy({}, {
        get(_target, key) {
          if (key === 'depthSensing') return record(String(key), new Proxy({}, {
            get(_target, key) {
              if (key === 'dataFormatPreference') return record(String(key), new Set([{toString: () => record('convert format', 'float32')}]));
              if (key === 'depthTypeRequest') return record(String(key), (function* () { yield {toString: () => record('convert type', 'raw')}; })());
              if (key === 'matchDepthView') return record(String(key), {valueOf() { throw new Error('boolean must not coerce object'); }});
              if (key === 'usagePreference') return record(String(key), [{toString: () => record('convert usage', 'cpu-optimized')}]);
              throw new Error(`Unknown depth property ${String(key)}`);
            }, ownKeys() { throw new Error('Do not enumerate depth'); },
          }));
          if (key === 'domOverlay') return record(String(key), {get root() { return record('root', document.body); }});
          if (key === 'optionalFeatures') return record(String(key), new Set(['unknown-optional']));
          if (key === 'requiredFeatures') return record(String(key), [{toString: () => record('convert feature', 'viewer')}]);
          throw new Error(`Unknown property ${String(key)}`);
        }, ownKeys() { throw new Error('Do not enumerate session dictionary'); },
      });
      const pending = xr.requestSession({toString: () => record('mode', sessionMode)}, input);
      check(trace.join(',') === 'mode,depthSensing,dataFormatPreference,convert format,depthTypeRequest,convert type,matchDepthView,usagePreference,convert usage,domOverlay,root,optionalFeatures,requiredFeatures,convert feature', 'complete ordered conversion before returning');
      const ordered = await pending;
      check(!ordered.enabledFeatures.includes('unknown-optional'), 'unknown optional omitted'); await ordered.end();
      // Null/undefined dictionaries are empty values, not ordinary objects
      // whose members can be supplied through Object.prototype.
      const saved = Object.getOwnPropertyDescriptor(Object.prototype, 'requiredFeatures');
      Object.defineProperty(Object.prototype, 'requiredFeatures', {configurable: true, get() { throw sentinel; }});
      let nullPending: Promise<Runtime.XRSession>;
      try { nullPending = xr.requestSession(sessionMode, null); }
      finally {
        if (saved) Object.defineProperty(Object.prototype, 'requiredFeatures', saved);
        else delete (Object.prototype as {requiredFeatures?: unknown}).requiredFeatures;
      }
      const nullSession = await nullPending;
      check(nullSession.enabledFeatures.includes('viewer'), 'null dictionary has no inherited member reads'); await nullSession.end();
      const inherited = Object.create(null);
      let reads = 0;
      Object.defineProperty(inherited, 'requiredFeatures', {get() { reads++; return new Set(['viewer']); }});
      const inheritedSession = await xr.requestSession(sessionMode, Object.create(inherited));
      check(reads === 1 && inheritedSession.enabledFeatures.includes('viewer'), 'inherited nonenumerable member read once'); await inheritedSession.end();
      const legacy = document.all;
      check(typeof legacy === 'undefined' && legacy !== undefined && legacy !== null, 'document.all exercises legacy object semantics');
      const members = ['depthSensing', 'domOverlay', 'optionalFeatures', 'requiredFeatures'];
      const savedMembers = members.map(member => Object.getOwnPropertyDescriptor(legacy, member));
      const legacyReads: string[] = [];
      try {
        for (const member of members) Object.defineProperty(legacy, member, {configurable: true, get() {
          legacyReads.push(member);
          return member === 'requiredFeatures' ? ['unknown-required'] : undefined;
        }});
        const pending = xr.requestSession(sessionMode, legacy);
        check(legacyReads.join(',') === members.join(','), 'document.all dictionary members read once in order before returning');
        await rejects(() => pending, 'NotSupportedError', 'document.all dictionary retains unknown required feature');
      } finally {
        members.forEach((member, index) => {
          const descriptor = savedMembers[index];
          if (descriptor) Object.defineProperty(legacy, member, descriptor);
          else Reflect.deleteProperty(legacy, member);
        });
      }
      const savedIterator = Object.getOwnPropertyDescriptor(legacy, Symbol.iterator);
      try {
        for (const member of ['optionalFeatures', 'requiredFeatures']) {
          let iteratorReads = 0, conversions = 0;
          Object.defineProperty(legacy, Symbol.iterator, {configurable: true, get() {
            iteratorReads++;
            return function* () {
              yield {toString() { conversions++; return 'viewer'; }};
              yield {toString() { conversions++; return 'unknown-feature'; }};
            };
          }});
          const pending = xr.requestSession(sessionMode, {[member]: legacy});
          check(iteratorReads === 1 && conversions === 2, `${member}: iterable document.all converted once before returning`);
          if (member === 'requiredFeatures') {
            await rejects(() => pending, 'NotSupportedError', 'iterable document.all retains unknown required feature');
          } else {
            const session = await pending;
            try { check(session.enabledFeatures.join(',') === (sessionMode === 'inline' ? 'viewer' : 'viewer,local'), 'iterable document.all grants viewer and omits unknown optional feature'); }
            finally { await session.end(); }
          }
        }
      } finally {
        if (savedIterator) Object.defineProperty(legacy, Symbol.iterator, savedIterator);
        else Reflect.deleteProperty(legacy, Symbol.iterator);
      }
      const foreign = document.createElement('iframe'); document.body.append(foreign);
      try {
        const foreignRoot = foreign.contentDocument!.body;
        check(!(foreignRoot instanceof Element), 'cross-realm root fixture');
        const session = await xr.requestSession(sessionMode, {domOverlay: {root: foreignRoot}});
        check(session.domOverlayState === null, 'cross-realm Element conversion without feature'); await session.end();
      } finally { foreign.remove(); }
      await rejects(() => xr.requestSession(sessionMode, {requiredFeatures: (function* () { yield 'unknown-required'; })()}), 'NotSupportedError', 'one-shot unknown required survives activation');
      const required = ['viewer'], optional = ['unknown-optional'];
      const options = {requiredFeatures: required, optionalFeatures: optional, domOverlay: null};
      const snapshot = xr.requestSession(sessionMode, options);
      required[0] = 'unknown-required'; optional.push('unknown-later');
      const session = await snapshot;
      try {
        check(session.enabledFeatures.includes('viewer') && !session.enabledFeatures.includes('unknown-optional'), 'immediate list mutation does not affect grants');
        if (sessionMode !== 'inline') {
          await rejects(() => xr.requestSession(sessionMode, {requiredFeatures: null}), 'TypeError', 'conversion before concurrency');
          await rejects(() => xr.requestSession(sessionMode), 'InvalidStateError', 'active immersive ownership');
          check(!session.ended, 'failed overlapping requests preserve existing session');
        }
        const canvas = document.createElement('canvas'); document.body.append(canvas);
        try {
          const gl = canvas.getContext('webgl')!; await gl.makeXRCompatible();
          session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
          const space = await session.requestReferenceSpace('viewer');
          await new Promise<void>((resolve, reject) => session.requestAnimationFrame((_time, frame) => {
            try { check(!!frame.getViewerPose(space)?.views.length, 'snapshot session produces usable frame'); resolve(); } catch (error) { reject(error); }
          }));
        } finally { canvas.remove(); }
      } finally { await session.end(); }
      const recovered = await xr.requestSession(sessionMode); check(!recovered.ended, 'request recovers after conversion/negotiation failure and end'); await recovered.end();
    }
    return {mode, handheld, assertions: passed.length, passed};
  }, {mode, handheld});
}

/** Fresh packaged polyfill + real device, with only the init event held by the harness. */
export async function runDeferredSessionRequest(page: Page, mode: SessionMode, deviceDefinition: DeviceConfig) {
  await page.evaluate('globalThis.__name = value => value');
  // The caller holds automatic configuration in this fresh injected document.
  return page.evaluate(async ({mode, deviceDefinition}) => {
    const w = window as unknown as XRWindow;
    const xr = w.navigator.xr;
    const passed: string[] = [];
    function check(value: unknown, label: string) { if (!value) throw new Error(`${mode}: ${label}`); passed.push(label); }
    async function rejects(promise: Promise<unknown>, name: string, label: string) {
      let error: unknown; try { await promise; } catch (caught) { error = caught; }
      check(error instanceof Error && error.name === name, `${label}: ${String(error)}`);
    }
    const original = document.createElement('section'), replacement = document.createElement('section');
    original.style.color = 'red'; document.body.append(original, replacement);
    const initialStyle = original.getAttribute('style');
    let requiredRuns = 0, optionalRuns = 0, depthRuns = 0, rootReads = 0;
    const required = mode === 'inline' ? ['viewer'] : ['local-floor', ...(mode === 'immersive-ar' ? ['depth-sensing', 'dom-overlay'] : [])];
    const formats = ['unsigned-short', 'float32'];
    const depthSensing = {dataFormatPreference: (function* () { depthRuns++; yield* formats; })(), depthTypeRequest: new Set(['raw']), matchDepthView: false, usagePreference: new Set(['cpu-optimized'])};
    const domOverlay = {get root() { rootReads++; return original; }};
    const input = {
      requiredFeatures: (function* () { requiredRuns++; yield* required; })(),
      optionalFeatures: (function* () { optionalRuns++; yield 'unknown-optional'; })(), depthSensing, domOverlay,
    };
    let settled = false;
    const pending = xr.requestSession({toString: () => mode}, input);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    check(requiredRuns === 1 && optionalRuns === 1 && depthRuns === 1 && rootReads === 1, 'all generators and root converted before configuration');
    required.splice(0, required.length, 'unknown-mutated'); formats.splice(0, formats.length, 'float32');
    depthSensing.usagePreference.clear(); depthSensing.usagePreference.add('gpu-optimized');
    Object.defineProperty(domOverlay, 'root', {value: replacement});
    input.requiredFeatures = (function* () { yield 'unknown-replaced'; })();
    if (mode !== 'inline') {
      await rejects(xr.requestSession(mode, {requiredFeatures: null}), 'TypeError', 'conversion before pending immersive check');
      await rejects(xr.requestSession(mode), 'InvalidStateError', 'overlap while waiting for configuration');
    }
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    check(!settled && !original.hasAttribute('popover') && !replacement.hasAttribute('popover'), 'request waits with no presentation resources');
    (window as unknown as {allowDeferredDeviceInit: boolean}).allowDeferredDeviceInit = true;
    window.dispatchEvent(new CustomEvent('webxr-device-init', {detail: {deviceDefinition, stereoEffect: true}}));
    const session = await pending;
    try {
      check(session.enabledFeatures.includes('viewer') && !session.enabledFeatures.includes('unknown-optional'), 'deferred negotiation uses feature snapshot');
      if (mode !== 'inline') check(session.enabledFeatures.includes('local') && session.enabledFeatures.includes('local-floor'), 'deferred immersive defaults and explicit features');
      if (mode === 'immersive-ar') {
        check(session.depthUsage === 'cpu-optimized' && session.depthDataFormat === 'unsigned-short', 'deferred depth uses converted usage and format');
        check(session.domOverlayState?.type === 'screen' && original.matches(':popover-open') && !replacement.hasAttribute('popover'), 'deferred overlay presents original root');
      }
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      try {
        const gl = canvas.getContext('webgl')!; await gl.makeXRCompatible(); session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
        const viewer = await session.requestReferenceSpace('viewer');
        await new Promise<void>((resolve, reject) => session.requestAnimationFrame((_time, frame) => {
          try { check(!!frame.getViewerPose(viewer)?.views.length, 'deferred session has usable frames'); resolve(); } catch (error) { reject(error); }
        }));
      } finally { canvas.remove(); }
    } finally { await session.end(); }
    check(original.getAttribute('style') === initialStyle && !original.hasAttribute('popover') && !replacement.hasAttribute('style'), 'end restores original root and leaves replacement untouched');
    const recovered = await xr.requestSession(mode); await recovered.end();
    check(recovered.ended, 'immersive ownership recovers after deferred session end');
    if (mode === 'immersive-ar') {
      for (const requirement of ['requiredFeatures', 'optionalFeatures']) {
        const liveOptions = {[requirement]: ['dom-overlay'], domOverlay: {root: original}};
        const livePending = xr.requestSession(mode, liveOptions);
        original.remove(); liveOptions.domOverlay.root = replacement;
        if (requirement === 'requiredFeatures') await rejects(livePending, 'NotSupportedError', 'detached original root fails live eligibility');
        else {
          const omitted = await livePending;
          check(!omitted.enabledFeatures.includes('dom-overlay') && omitted.domOverlayState === null, 'detached optional root is omitted'); await omitted.end();
        }
        check(original.getAttribute('style') === initialStyle && !replacement.hasAttribute('popover'), 'failed live root cannot substitute replacement or alter resources');
        document.body.append(original);
      }
      // Presentation can still fail after eligibility checks (zero-size layout).
      const hiddenParent = document.createElement('div'); hiddenParent.style.display = 'none';
      hiddenParent.append(original); document.body.append(hiddenParent);
      await rejects(xr.requestSession(mode, {requiredFeatures: ['dom-overlay'], domOverlay: {root: original}}), 'NotSupportedError', 'presentation failure rejects required overlay');
      check(original.getAttribute('style') === initialStyle && !original.hasAttribute('popover'), 'presentation failure restores original root');
      const afterFailure = await xr.requestSession(mode); await afterFailure.end();
      check(afterFailure.ended, 'ownership recovers after presentation failure');
      document.body.append(original); hiddenParent.remove();
    }
    original.remove(); replacement.remove();
    return {mode, profile: deviceDefinition.formFactor, assertions: passed.length, passed};
  }, {mode, deviceDefinition});
}
