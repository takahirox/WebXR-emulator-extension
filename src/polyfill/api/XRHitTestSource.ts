import type {XRSession} from './runtime';
import type {HitTestOptions} from '../../types/polyfill';
import {interfaceBrands} from './interface-brand';
import {enumerableMembers, invalidState} from './geometry';
import {requireHitTestAllocation} from './hit-test-options';

export function hitSourceState(value: object) {
  const state = interfaceBrands.hitSources.get(value);
  if (!state) throw new TypeError('Expected XRHitTestSource.');
  return state;
}
export default class XRHitTestSource {
  constructor(...args: [session: XRSession, options: HitTestOptions, token?: symbol]) {
    const [session, options, token] = args;
    requireHitTestAllocation(token);
    interfaceBrands.hitSources.set(this, {session, space: options.space, offsetRay: options.offsetRay!,
      entityTypes: Object.freeze([...options.entityTypes!]), active: true});
  }
  cancel() {
    const state = hitSourceState(this);
    if (!state.active) invalidState('Source is inactive.');
    this._deactivate();
  }
  _deactivate() {
    const state = hitSourceState(this);
    state.active = false; state.session._hitSources.delete(this);
    state.session._device.removeHitTestSource(this);
  }
  get _space() { return hitSourceState(this).space; }
  get _session() { return hitSourceState(this).session; }
  get _offsetRay() { return hitSourceState(this).offsetRay; }
  get _entityTypes() { return hitSourceState(this).entityTypes; }
  get _active() { return hitSourceState(this).active; }
}
enumerableMembers(XRHitTestSource.prototype, ['cancel']);
Object.defineProperty(XRHitTestSource.prototype, Symbol.toStringTag, {value: 'XRHitTestSource', configurable: true});
