import {XRRigidTransform, transformMatrix, transformObjects, enumerableMembers} from './geometry';
import {interfaceBrands} from './interface-brand';

// WebIDL dictionary conversion reads inherited members once in IDL order.
// Origin uses unrestricted double; direction uses restricted double.
function point(value: unknown, direction = false) {
  if (value !== null && value !== undefined && Object(value) !== value) throw new TypeError('Expected point dictionary.');
  const input = value as DOMPointInit | null | undefined;
  const out = {w: direction ? 0 : 1, x: 0, y: 0, z: direction ? -1 : 0};
  for (const key of ['w', 'x', 'y', 'z'] as const) {
    const member = input?.[key];
    if (member !== undefined) out[key] = +member;
    if (direction && !Number.isFinite(out[key])) throw new TypeError('Direction members must be finite doubles.');
  }
  return out;
}
export function rayState(value: object) {
  const state = interfaceBrands.rays.get(value);
  if (!state) throw new TypeError('Expected XRRay.');
  return state;
}
export default class XRRay extends interfaceBrands.hitTestAllocations.RayAllocation {
  constructor(origin: DOMPointInit | XRRigidTransform | null = {}, direction: DOMPointInit | null = {}) {
    let p, d;
    // The transform overload only participates in the one-argument overload set.
    if (arguments.length === 1 && transformObjects.has(origin as object)) {
      const m = transformMatrix(origin as XRRigidTransform);
      p = {x: m[12], y: m[13], z: m[14], w: 1};
      d = {x: -m[8], y: -m[9], z: -m[10], w: 0};
    } else { p = point(origin); d = point(direction, true); }
    if (p.w !== 1 || d.w !== 0 || (d.x === 0 && d.y === 0 && d.z === 0)) throw new TypeError('Invalid ray origin or direction.');
    super(p, d);
  }
  get origin() { return rayState(this).origin; }
  get direction() { return rayState(this).direction; }
  get matrix() { return rayState(this).matrix(); }
}
enumerableMembers(XRRay.prototype, ['origin', 'direction', 'matrix']);
Object.defineProperty(XRRay.prototype, Symbol.toStringTag, {value: 'XRRay', configurable: true});
