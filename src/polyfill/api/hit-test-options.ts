import XRRay, {rayState} from './XRRay';
import {spaceObjects, type XRSpace} from './geometry';
import {interfaceValue} from './bulk-input';
import type {HitTestOptions, TransientHitTestOptions} from '../../types/polyfill';

export const hitTestAllocation = Symbol('hit test allocation');
export function requireHitTestAllocation(token?: symbol) {
  if (token !== hitTestAllocation) throw new TypeError('Illegal constructor.');
}
function dictionary(value: unknown) {
  if (value === undefined || value === null) return {} as Record<string, unknown>;
  if (Object(value) !== value) throw new TypeError('Expected hit-test options dictionary.');
  return value as Record<string, unknown>;
}
function common(value: Record<string, unknown>) {
  const member = value.entityTypes;
  let entityTypes: string[] = ['plane'];
  if (member !== undefined) {
    if (member === null || Object(member) !== member) throw new TypeError('Expected entity type sequence.');
    // WebIDL captures next once and does not IteratorClose on conversion failure.
    const method = (member as Iterable<unknown>)[Symbol.iterator];
    if (typeof method !== 'function') throw new TypeError('Expected entity type sequence.');
    const iterator = Reflect.apply(method, member, []);
    if (Object(iterator) !== iterator) throw new TypeError('Expected iterator object.');
    const next = iterator.next;
    entityTypes = [];
    while (true) {
      const step = Reflect.apply(next, iterator, []);
      if (Object(step) !== step) throw new TypeError('Expected iterator result.');
      if (step.done) break;
      const type = `${step.value}`;
      if (!['plane', 'point', 'mesh'].includes(type)) throw new TypeError('Invalid hit-test entity type.');
      entityTypes.push(type);
    }
  }
  const offset = value.offsetRay;
  if (offset !== undefined) rayState(offset as object);
  return {entityTypes, offsetRay: offset === undefined ? new XRRay() : offset as XRRay};
}
export function convertHitTestOptions(value: unknown): HitTestOptions {
  const input = dictionary(value), converted = common(input);
  const space = input.space;
  return {...converted, space: interfaceValue<XRSpace>(space, spaceObjects, 'XRSpace')};
}
export function convertTransientHitTestOptions(value: unknown): TransientHitTestOptions {
  const input = dictionary(value), converted = common(input);
  const profile = input.profile;
  if (profile === undefined) throw new TypeError('profile is required.');
  return {...converted, profile: `${profile}`};
}
