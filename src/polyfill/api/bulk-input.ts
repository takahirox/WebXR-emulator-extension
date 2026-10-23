// Scoped WebIDL conversion for the Hands WD 2024-06-05 bulk operations.
// Capture intrinsic accessors: public tags, length, buffer, set and fill are
// replaceable and instanceof does not accept genuine cross-realm arrays.
const typedArray = Object.getPrototypeOf(Float32Array.prototype);
const arrayName = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const arrayLength = Object.getOwnPropertyDescriptor(typedArray, 'length')!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

function isObject(value: unknown): value is Record<PropertyKey, unknown> { return Object(value) === value; }

export function interfaceValue<T>(value: unknown, brand: WeakSet<object>, name: string): T {
  if (!isObject(value) || !brand.has(value)) throw new TypeError(`Expected ${name}.`);
  return value as T;
}

export function interfaceSequence<T>(value: unknown, brand: WeakSet<object>, name: string): T[] {
  if (!isObject(value)) throw new TypeError('Expected iterable sequence.');
  const method = value[Symbol.iterator];
  if (typeof method !== 'function') throw new TypeError('Expected iterable sequence.');
  const iterator: unknown = Reflect.apply(method, value, []);
  if (!isObject(iterator)) throw new TypeError('Expected iterator object.');
  const next = iterator.next;
  const list: T[] = [];
  // WebIDL captures next once and checks each interface before advancing;
  // neither an array-like fallback nor IteratorClose is part of conversion.
  while (true) {
    const step: unknown = Reflect.apply(next as () => unknown, iterator, []);
    if (!isObject(step)) throw new TypeError('Expected iterator result object.');
    if (step.done) return list;
    list.push(interfaceValue<T>(step.value, brand, name));
  }
}

export function float32Output(value: unknown): number {
  if (arrayName.call(value) !== 'Float32Array') throw new TypeError('Expected Float32Array.');
  const buffer = arrayBuffer.call(value);
  // The ArrayBuffer getter rejects SharedArrayBuffer even across realms.
  bufferLength.call(buffer);
  if (bufferResizable?.call(buffer)) throw new TypeError('Resizable buffers are not supported.');
  // Detached fixed buffers retain their brand, but have zero usable capacity.
  return arrayLength.call(value) as number;
}
