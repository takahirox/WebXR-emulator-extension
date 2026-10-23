import type {XRSession, XRFrame, XRInputSource} from './runtime';
import type {EventHandler} from './event-handlers';

// Same-origin injections share allocation brands, not writable WeakSets. Only
// constructors can brand a newly allocated object; borrowing a prototype or
// wrapping an instance in a Proxy cannot acquire its brand.
function createBrands() {
  const frames = new WeakSet<object>(), spaces = new WeakSet<object>(), joints = new WeakSet<object>();
  const sessions = new WeakSet<object>(), inputSources = new WeakSet<object>();
  class SessionObject extends EventTarget {
    constructor() { super(); sessions.add(this); }
  }
  class InputSourceObject {
    constructor() { inputSources.add(this); }
  }
  class FrameObject {
    constructor() { frames.add(this); }
  }
  class SpaceObject extends EventTarget {
    constructor(joint = false) { super(); spaces.add(this); if (joint) joints.add(this); }
  }
  Object.freeze(FrameObject.prototype); Object.freeze(FrameObject);
  Object.freeze(SpaceObject.prototype); Object.freeze(SpaceObject);
  Object.freeze(SessionObject.prototype); Object.freeze(SessionObject);
  Object.freeze(InputSourceObject.prototype); Object.freeze(InputSourceObject);
  return Object.freeze({FrameObject, SpaceObject, SessionObject, InputSourceObject,
    // Dispatch and declared event attributes belong to the object, even when an
    // accessor from another injection is borrowed. Weak keys reject proxies and
    // prototype forgeries just as they do in an individual injection.
    eventSessions: new WeakMap<object, {session: XRSession}>(),
    eventInputs: new WeakMap<object, {frame: XRFrame; inputSource: XRInputSource}>(),
    eventChanges: new WeakMap<object, {session: XRSession; added: readonly XRInputSource[]; removed: readonly XRInputSource[]}>(),
    eventHandlers: new WeakMap<object, Map<string, {value: EventHandler; listener: EventListener}>>(),
    sessions: Object.freeze({has: (value: object) => sessions.has(value)}),
    inputSources: Object.freeze({has: (value: object) => inputSources.has(value)}),
    frames: Object.freeze({has: (value: object) => frames.has(value)}),
    spaces: Object.freeze({has: (value: object) => spaces.has(value)}),
    joints: Object.freeze({has: (value: object) => joints.has(value)}),
  });
}

// Reuse allocation bases through both parent and opener links. Popups have
// themselves as parent, so walking only ancestors would split their brands.
// Only inspect registries on accessible windows; relationship links can cross
// origins. Track visited WindowProxies because opener links can form cycles.
const key = Symbol.for('WebXR-emulator.interface-brands');
let host: object = globalThis;
if (typeof window !== 'undefined') {
  const pending: Window[] = [window], visited = new Set<Window>();
  while (pending.length) {
    const candidate = pending.pop()!;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      void candidate.document;
      host = candidate;
      if (Object.prototype.hasOwnProperty.call(candidate, key)) break;
    } catch { /* cross-origin or closed */ }
    try { if (candidate.opener) pending.push(candidate.opener as Window); } catch { /* closed */ }
    try { pending.push(candidate.parent); } catch { /* closed */ }
  }
}
const shared = host as unknown as {[key: symbol]: ReturnType<typeof createBrands>};
if (!Object.prototype.hasOwnProperty.call(shared, key)) {
  Object.defineProperty(shared, key, {value: createBrands()});
}
export const interfaceBrands = shared[key];
