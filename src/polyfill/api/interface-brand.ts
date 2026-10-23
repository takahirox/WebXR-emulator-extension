// Same-origin injections share allocation brands, not writable WeakSets. Only
// constructors can brand a newly allocated object; borrowing a prototype or
// wrapping an instance in a Proxy cannot acquire its brand.
function createBrands() {
  const frames = new WeakSet<object>(), spaces = new WeakSet<object>(), joints = new WeakSet<object>();
  class FrameObject {
    constructor() { frames.add(this); }
  }
  class SpaceObject extends EventTarget {
    constructor(joint = false) { super(); spaces.add(this); if (joint) joints.add(this); }
  }
  Object.freeze(FrameObject.prototype); Object.freeze(FrameObject);
  Object.freeze(SpaceObject.prototype); Object.freeze(SpaceObject);
  return Object.freeze({FrameObject, SpaceObject,
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
