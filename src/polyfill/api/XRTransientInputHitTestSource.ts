import type {XRSession} from './runtime';
import type {TransientHitTestOptions} from '../../types/polyfill';
import {interfaceBrands} from './interface-brand';
import {enumerableMembers, invalidState} from './geometry';
import {requireHitTestAllocation} from './hit-test-options';

export function transientHitSourceState(value: object) {
  const state = interfaceBrands.transientHitSources.get(value);
  if (!state) throw new TypeError('Expected XRTransientInputHitTestSource.');
  return state;
}
export default class XRTransientInputHitTestSource extends interfaceBrands.hitTestAllocations.TransientHitSourceAllocation {
  constructor(...args: [session: XRSession, options: TransientHitTestOptions, token?: symbol]) {
    const [session, options, token] = args;
    requireHitTestAllocation(token);
    super(session, options);
  }
  cancel() {
    const state = transientHitSourceState(this);
    if (!state.active) invalidState('Source is inactive.');
    this._deactivate();
  }
  _deactivate() {
    const state = transientHitSourceState(this);
    state.session._transientSources.delete(this);
    state.session._device.removeHitTestSource(this);
  }
  get _profile() { return transientHitSourceState(this).profile; }
  get _session() { return transientHitSourceState(this).session; }
  get _offsetRay() { return transientHitSourceState(this).offsetRay; }
  get _entityTypes() { return transientHitSourceState(this).entityTypes; }
  get _active() { return transientHitSourceState(this).active; }
}
enumerableMembers(XRTransientInputHitTestSource.prototype, ['cancel']);
Object.defineProperty(XRTransientInputHitTestSource.prototype, Symbol.toStringTag, {value: 'XRTransientInputHitTestSource', configurable: true});
