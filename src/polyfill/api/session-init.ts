import type {SessionMode} from '../../types/contracts';
import type {SessionOptions} from '../../types/polyfill';

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  // Object preserves object identity, including document.all, whose legacy
  // typeof result is 'undefined'. It wraps primitives without coercing objects.
  return Object(value) === value;
}
function dictionary(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return Object.create(null) as Record<string, unknown>;
  if (!isObject(value)) throw new TypeError('Expected session initialization dictionary.');
  return value;
}
function domString(value: unknown): string {
  // Template interpolation uses ToString (unlike String(), it rejects Symbols),
  // including the string hint when converting an object to a primitive.
  return `${value}`;
}
function enumeration(value: unknown, allowed: readonly string[]): string {
  const string = domString(value);
  if (!allowed.includes(string)) throw new TypeError('Invalid session initialization enum.');
  return string;
}
function sequence(value: unknown, convert: (entry: unknown) => string): string[] {
  if (!isObject(value)) throw new TypeError('Expected session initialization sequence.');
  const method = value[Symbol.iterator];
  if (typeof method !== 'function') throw new TypeError('Expected iterable sequence.');
  const iterator = Reflect.apply(method, value, []) as unknown;
  if (!isObject(iterator)) throw new TypeError('Expected iterator object.');
  const next = iterator.next;
  const values: string[] = [];
  // WebIDL's create-sequence algorithm captures next once and converts each
  // value before advancing. Array.from has an array-like fallback and closes
  // the iterator on conversion failure; neither is part of this algorithm.
  while (true) {
    const step = Reflect.apply(next as () => unknown, iterator, []) as unknown;
    if (!isObject(step)) throw new TypeError('Expected iterator result object.');
    if (step.done) return values;
    values.push(convert(step.value));
  }
}
const depthFormats = ['float32', 'unsigned-short', 'luminance-alpha'];
function depthInit(value: unknown): NonNullable<SessionOptions['depthSensing']> {
  const input = dictionary(value);
  // Required members fail at their position in lexicographic conversion order.
  const dataFormatPreference = sequence(input.dataFormatPreference, entry => enumeration(entry, depthFormats));
  const depthType = input.depthTypeRequest;
  const depthTypeRequest = depthType === undefined ? undefined : sequence(depthType, entry => enumeration(entry, ['raw', 'smooth']));
  const match = input.matchDepthView;
  const matchDepthView = match === undefined ? true : Boolean(match);
  const usagePreference = sequence(input.usagePreference, entry => enumeration(entry, ['cpu-optimized', 'gpu-optimized']));
  return {dataFormatPreference, depthTypeRequest, matchDepthView, usagePreference};
}

export function convertSessionMode(value: unknown): SessionMode {
  return enumeration(value, ['inline', 'immersive-vr', 'immersive-ar']) as SessionMode;
}

/** The scoped XRSessionInit members, converted before any session algorithms. */
export function convertSessionInit(value: unknown): SessionOptions {
  const input = dictionary(value);
  const init = Object.create(null) as SessionOptions;
  const depthSensing = input.depthSensing;
  if (depthSensing !== undefined) init.depthSensing = depthInit(depthSensing);
  const domOverlay = input.domOverlay;
  if (domOverlay !== undefined) {
    if (domOverlay === null) init.domOverlay = null;
    else {
      const root = dictionary(domOverlay).root;
      // Native Element brand check also accepts same-origin cross-realm roots.
      // Keep the original reference; live presentation eligibility is separate.
      Element.prototype.hasAttribute.call(root, '');
      init.domOverlay = {root: root as Element};
    }
  }
  const optionalFeatures = input.optionalFeatures;
  if (optionalFeatures !== undefined) init.optionalFeatures = sequence(optionalFeatures, domString);
  const requiredFeatures = input.requiredFeatures;
  if (requiredFeatures !== undefined) init.requiredFeatures = sequence(requiredFeatures, domString);
  return init;
}
