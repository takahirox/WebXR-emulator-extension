import type {XRSession, XRFrame, XRInputSource} from './runtime';
import {interfaceBrands} from './interface-brand';
import {interfaceValue, interfaceSequence} from './bulk-input';

// Device CRD 2026-06-09 §12 + WebIDL 622910c. Convert the complete
// dictionary before invoking Event, so caller getters are never read twice.
function eventArguments(count: number, type: unknown, value: unknown) {
  if (count < 2) throw new TypeError('Expected type and eventInitDict.');
  // Template substitution uses ToString (unlike String(), it rejects Symbols).
  const name = `${type as string}`;
  if (value != null && Object(value) !== value) throw new TypeError('Expected event dictionary.');
  const dictionary = (value ?? {}) as Record<string, unknown>;
  const init = {bubbles: Boolean(dictionary.bubbles), cancelable: Boolean(dictionary.cancelable), composed: Boolean(dictionary.composed)};
  return {name, dictionary, init};
}
function required(dictionary: Record<string, unknown>, key: string): unknown {
  const value = dictionary[key];
  if (value === undefined) throw new TypeError(`Missing required ${key}.`);
  return value;
}
function data<T>(map: WeakMap<object, T>, receiver: object): T {
  const value = map.get(receiver);
  if (!value) throw new TypeError('Invalid XR event receiver.');
  return value;
}
const sessions = new WeakMap<object, {session: XRSession}>();
const inputs = new WeakMap<object, {frame: XRFrame; inputSource: XRInputSource}>();
const changes = new WeakMap<object, {session: XRSession; added: readonly XRInputSource[]; removed: readonly XRInputSource[]}>();

export class XRSessionEvent extends Event {
  constructor(type: string, eventInitDict: EventInit & {session: XRSession}) {
    const {name, dictionary, init} = eventArguments(arguments.length, type, eventInitDict);
    const session = interfaceValue<XRSession>(required(dictionary, 'session'), interfaceBrands.sessions, 'XRSession');
    super(name, init); sessions.set(this, {session});
  }
  get session() { return data(sessions, this).session; }
}
export class XRInputSourceEvent extends Event {
  constructor(type: string, eventInitDict: EventInit & {frame: XRFrame; inputSource: XRInputSource}) {
    const {name, dictionary, init} = eventArguments(arguments.length, type, eventInitDict);
    const frame = interfaceValue<XRFrame>(required(dictionary, 'frame'), interfaceBrands.frames, 'XRFrame');
    const inputSource = interfaceValue<XRInputSource>(required(dictionary, 'inputSource'), interfaceBrands.inputSources, 'XRInputSource');
    super(name, init); inputs.set(this, {frame, inputSource});
  }
  get frame() { return data(inputs, this).frame; }
  get inputSource() { return data(inputs, this).inputSource; }
}
export class XRInputSourcesChangeEvent extends Event {
  constructor(type: string, eventInitDict: EventInit & {session: XRSession; added: Iterable<XRInputSource>; removed: Iterable<XRInputSource>}) {
    const {name, dictionary, init} = eventArguments(arguments.length, type, eventInitDict);
    const added = interfaceSequence<XRInputSource>(required(dictionary, 'added'), interfaceBrands.inputSources, 'XRInputSource');
    const removed = interfaceSequence<XRInputSource>(required(dictionary, 'removed'), interfaceBrands.inputSources, 'XRInputSource');
    const session = interfaceValue<XRSession>(required(dictionary, 'session'), interfaceBrands.sessions, 'XRSession');
    super(name, init); changes.set(this, {session, added: Object.freeze(added), removed: Object.freeze(removed)});
  }
  get session() { return data(changes, this).session; }
  get added() { return data(changes, this).added; }
  get removed() { return data(changes, this).removed; }
}
// WebIDL attributes are enumerable, readonly prototype accessors.
for (const [prototype, keys] of [
  [XRSessionEvent.prototype, ['session']],
  [XRInputSourceEvent.prototype, ['frame', 'inputSource']],
  [XRInputSourcesChangeEvent.prototype, ['session', 'added', 'removed']],
] as const) for (const key of keys) Object.defineProperty(prototype, key, {...Object.getOwnPropertyDescriptor(prototype, key), enumerable: true});
