import type {HapticState} from '../../types/contracts';
import type {PolyfillGlobal} from '../../types/polyfill';

export type HapticResult = 'complete' | 'preempted';
export interface VirtualHapticActuator {
  readonly effects: readonly ['dual-rumble'];
  playEffect(type: unknown, parameters?: unknown): Promise<HapticResult>;
  reset(): Promise<HapticResult>;
}
type Parameters = {duration: number; startDelay: number; strongMagnitude: number; weakMagnitude: number; leftTrigger: number; rightTrigger: number};
type Backend = {effects: readonly ['dual-rumble']; live: () => boolean; cancel: () => void; reset: () => Promise<HapticResult>; play: (parameters: Parameters) => Promise<HapticResult>};
// Only the fixed runtime factory calls this module. No writer, registration
// handle, backend or allocator is published on the actuator or shared registry.
const backends = new WeakMap<object, Backend>();

export function createHaptics(window: PolyfillGlobal) {
  const {Promise, TypeError, DOMException, String: toString} = window;
  // Native min with one argument performs ToNumber without changing its
  // value. Its conversion errors belong to this binding's realm, including
  // for objects returning BigInt/Symbol; caller-thrown errors pass through.
  const toNumber = window.Math.min.bind(window.Math);
  const document = window.document;
  const schedule = window.setTimeout.bind(window), unschedule = window.clearTimeout.bind(window);
  const requireBackend = (value: object) => {
    const backend = backends.get(value);
    if (!backend) throw new TypeError('Expected virtual GamepadHapticActuator receiver.');
    return backend;
  };
  const assertLive = (backend: Backend) => {
    const detached = window.frameElement !== null && !window.frameElement.isConnected;
    if (document.visibilityState === 'hidden' || !document.defaultView || window.closed || detached || !backend.live()) {
      throw new DOMException('The document or XR input source is inactive.', 'InvalidStateError');
    }
  };
  function convert(value: unknown): Parameters {
    if (value != null && typeof value !== 'object' && typeof value !== 'function') throw new TypeError('Expected GamepadEffectParameters dictionary.');
    const dictionary = (value ?? {}) as Record<string, unknown>;
    const result = {} as Parameters;
    for (const key of ['duration', 'leftTrigger', 'rightTrigger', 'startDelay', 'strongMagnitude', 'weakMagnitude'] as const) {
      const member = dictionary[key];
      let number = member === undefined ? 0 : toNumber(member as number);
      if (key === 'duration' || key === 'startDelay') {
        // WebIDL unsigned long long uses truncation and modulo, without
        // EnforceRange. Non-finite values convert to zero; negative values wrap.
        number = !Number.isFinite(number) || number === 0 ? 0 : Number(BigInt.asUintN(64, BigInt(Math.trunc(number))));
      } else if (!Number.isFinite(number)) throw new TypeError(`${key} must be finite.`);
      result[key] = number;
    }
    return result;
  }
  const prototype = window.Object.defineProperties(window.Object.create(window.Object.prototype), Object.getOwnPropertyDescriptors({
    get effects(): readonly ['dual-rumble'] { return requireBackend(this).effects; },
    playEffect(this: VirtualHapticActuator, type: unknown, parameters: unknown = {}): Promise<HapticResult> {
      return new Promise(resolve => {
        const backend = requireBackend(this);
        if (arguments.length === 0) throw new TypeError('Effect type is required.');
        if (typeof type === 'symbol') throw new TypeError('Effect type cannot be a Symbol.');
        const effect = toString(type);
        if (effect !== 'dual-rumble' && effect !== 'trigger-rumble') throw new TypeError('Invalid GamepadHapticEffectType.');
        const params = convert(parameters);
        for (const key of effect === 'dual-rumble' ? ['strongMagnitude', 'weakMagnitude'] as const : ['strongMagnitude', 'weakMagnitude', 'leftTrigger', 'rightTrigger'] as const) {
          if (params[key] < 0 || params[key] > 1) throw new TypeError(`${key} must be in [0, 1].`);
        }
        assertLive(backend);
        backend.cancel();
        if (effect !== 'dual-rumble') throw new DOMException('Only dual-rumble is simulated.', 'NotSupportedError');
        resolve(backend.play(params));
      });
    },
    reset(this: VirtualHapticActuator): Promise<HapticResult> {
      return new Promise(resolve => {
        const backend = requireBackend(this);
        assertLive(backend); resolve(backend.reset());
      });
    },
    [Symbol.toStringTag]: 'GamepadHapticActuator',
  }));
  return (live: () => boolean, emit: (state: Omit<HapticState, 'objectName' | 'sessionId' | 'sourceId'>, teardown?: boolean) => void) => {
    const effects = Object.freeze(window.Array.of('dual-rumble')) as readonly ['dual-rumble'];
    const settlements = new Map<number, {resolve: (result: HapticResult) => void; result: HapticResult}>();
    const settle = (resolve: (result: HapticResult) => void, result: HapticResult) => {
      const timer = schedule(() => { settlements.delete(timer); resolve(result); }, 0);
      settlements.set(timer, {resolve, result});
    };
    let pending: {resolve: (result: HapticResult) => void; timers: number[]} | undefined;
    const stop = (result: HapticResult, teardown = false) => {
      const previous = pending;
      if (!previous) return;
      pending = undefined;
      for (const timer of previous.timers) unschedule(timer);
      emit({state: 'idle', startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0}, teardown);
      // Cancelled callbacks cannot settle a replacement. Teardown must not
      // depend on timers in a document that is about to be discarded.
      if (teardown) previous.resolve(result);
      else settle(previous.resolve, result);
    };
    const backend: Backend = {
      effects, live, cancel: () => stop('preempted'),
      reset: () => new Promise(resolve => { stop('preempted'); settle(resolve, 'complete'); }),
      play: parameters => new Promise(resolve => {
        const startDelay = Math.min(5000, parameters.startDelay);
        const duration = Math.min(5000 - startDelay, parameters.duration);
        const state = {startDelay, duration, strongMagnitude: parameters.strongMagnitude, weakMagnitude: parameters.weakMagnitude};
        const request = {resolve, timers: [] as number[]}; pending = request;
        const start = () => {
          if (pending !== request) return;
          if (!live() || document.visibilityState === 'hidden') { stop('preempted'); return; }
          emit({...state, startDelay: 0, state: 'playing'});
          request.timers.push(schedule(() => { if (pending === request) stop('complete'); }, duration));
        };
        if (startDelay) {
          emit({...state, state: 'delayed'});
          request.timers.push(schedule(start, startDelay));
        } else start();
      }),
    };
    const value = Object.freeze(window.Object.create(prototype)) as VirtualHapticActuator;
    backends.set(value, backend);
    return {value, cancel: backend.cancel, retire: () => {
      stop('preempted', true);
      // A discarded frame's timers no longer run. Settle even already queued
      // completion/preemption/reset results before its document is destroyed.
      for (const [timer, settlement] of settlements) { unschedule(timer); settlement.resolve(settlement.result); }
      settlements.clear();
    }};
  };
}
