export const PRIVATE = Symbol('@@webxr-polyfill/XRHitTestSource');

import XRRay from './XRRay';
import type XRSession from 'webxr-polyfill/src/api/XRSession';
import type { HitTestOptions, HitTestState } from '../../types/polyfill';

export default class XRHitTestSource {
  [PRIVATE]: HitTestState;

  constructor(session: XRSession, options: HitTestOptions) {
    // @TODO: Support options.entityTypes and options.offsetRay
    if (options.entityTypes && options.entityTypes.length > 0) {
      throw new Error('XRHitTestSource does not support entityTypes option yet.');
    }
    this[PRIVATE] = {
      session,
      space: options.space,
      offsetRay: options.offsetRay || new XRRay(),
      active: true
    };
  }

  cancel() {
    // @TODO: Throw InvalidStateError if active is already false
    this[PRIVATE].active = false;
  }

  get _space() {
    return this[PRIVATE].space;
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
