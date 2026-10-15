export const PRIVATE = Symbol('@@webxr-polyfill/XRHitTestSource');

import XRRay from './XRRay';
import type {XRSession} from './runtime';
import type { HitTestOptions, HitTestState } from '../../types/polyfill';

export default class XRHitTestSource {
  [PRIVATE]: HitTestState;

  constructor(session: XRSession, options: HitTestOptions) {
    const types = options.entityTypes ?? ['plane'];
    for (const type of types) {
      if (!['plane', 'point', 'mesh'].includes(type)) throw new TypeError('Invalid hit-test entity type.');
      if (type === 'point') throw new DOMException('The virtual room has no point cloud.', 'NotSupportedError');
    }
    if (types.length === 0) throw new DOMException('At least one entity type is required.', 'NotSupportedError');
    if (options.offsetRay !== undefined && !(options.offsetRay instanceof XRRay)) throw new TypeError('Expected XRRay.');
    this[PRIVATE] = {
      session,
      space: options.space,
      offsetRay: options.offsetRay || new XRRay(),
      active: true
    };
  }

  cancel() {
    if (!this._active) throw new DOMException('Source is inactive.', 'InvalidStateError');
    this._deactivate();
  }

  get _space() {
    return this[PRIVATE].space;
  }

  _deactivate() {
    this[PRIVATE].active = false;
    this._session._hitSources.delete(this);
  }

  get _session() {
    return this[PRIVATE].session;
  }

  get _offsetRay() {
    return this[PRIVATE].offsetRay;
  }

  get _active() {
    return this[PRIVATE].active;
  }
}
