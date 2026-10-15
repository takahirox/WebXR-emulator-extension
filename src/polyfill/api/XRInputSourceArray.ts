import type {XRInputSource} from './runtime';

const providers = new WeakMap<XRInputSourceArray, () => readonly XRInputSource[]>();
const isIndex = (key: PropertyKey) => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff;
const isReadonly = (key: PropertyKey) => key === 'length' || isIndex(key);

/** A live WebIDL iterable with read-only indexed properties, not an Array. */
export default class XRInputSourceArray implements Iterable<XRInputSource> {
  readonly [index: number]: XRInputSource;
  constructor(provider: () => readonly XRInputSource[]) {
    const collection = new Proxy(this, {
      get: (target, key, receiver) => isIndex(key) ? provider()[Number(key)] : Reflect.get(target, key, receiver),
      has: (target, key) => isIndex(key) ? Number(key) < provider().length : Reflect.has(target, key),
      ownKeys: target => [...[...provider().keys()].map(String), ...Reflect.ownKeys(target)],
      getOwnPropertyDescriptor: (target, key) => isIndex(key)
        ? (Number(key) < provider().length ? {value: provider()[Number(key)], writable: false, enumerable: true, configurable: true} : undefined)
        : Reflect.getOwnPropertyDescriptor(target, key),
      set: (target, key, value, receiver) => !isReadonly(key) && Reflect.set(target, key, value, receiver),
      defineProperty: (target, key, descriptor) => !isReadonly(key) && Reflect.defineProperty(target, key, descriptor),
      deleteProperty: (target, key) => !isReadonly(key) && Reflect.deleteProperty(target, key),
      // Virtual indexed properties must remain configurable as sources change.
      preventExtensions: () => false,
    });
    providers.set(collection, provider);
    return collection;
  }
  get length() { return providers.get(this)!().length; }
  get [Symbol.toStringTag]() { return 'XRInputSourceArray'; }
  *values() { for (let index = 0; index < this.length; index++) yield this[index]; }
  *keys() { for (let index = 0; index < this.length; index++) yield index; }
  *entries(): IterableIterator<[number, XRInputSource]> { for (const index of this.keys()) yield [index, this[index]]; }
  forEach(callback: (value: XRInputSource, index: number, collection: XRInputSourceArray) => void, thisArg?: unknown) {
    if (typeof callback !== 'function') throw new TypeError('Expected callback.');
    for (const [index, value] of this.entries()) callback.call(thisArg, value, index, this);
  }
  [Symbol.iterator]() { return this.values(); }
}
