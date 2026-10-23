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

// Walk WindowProxy parents even across inaccessible intermediate origins. An
// inaccessible window is never read or modified; a same-origin ancestor can
// host the private allocation bases for its descendants.
let host: object = globalThis;
if (typeof window !== 'undefined') {
  for (let ancestor: Window = window; ; ancestor = ancestor.parent) {
    try { void ancestor.document; host = ancestor; } catch { /* cross-origin */ }
    if (ancestor === ancestor.parent) break;
  }
}
const key = Symbol.for('WebXR-emulator.interface-brands');
const shared = host as unknown as {[key: symbol]: ReturnType<typeof createBrands>};
if (!Object.prototype.hasOwnProperty.call(shared, key)) {
  Object.defineProperty(shared, key, {value: createBrands()});
}
export const interfaceBrands = shared[key];
