import {mat4, vec3} from 'gl-matrix';
import {XRSpace, relativePose, invalidState} from './geometry';
import type {XRSession, XRFrame, XRInputSource} from './runtime';
import type {XRHand, XRJointSpace, XRJointPose} from './sensing';
import type {DeviceInput} from '../device-adapter';

export const jointNames = Object.freeze(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap(finger => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(bone => `${finger}-${bone}`))]);

/** Canonical backend allocations. Only frozen readers escape; neither a public
 * constructor nor the shared space superclass can register a joint. Trackers
 * can retrieve an existing source's hand, never accept caller-provided records,
 * joint names, radii, matrices, providers or membership lists. */
export function createHandAllocations(sessions: WeakSet<object>, inputs: WeakSet<object>,
  frames: WeakMap<object, {session: XRSession; pose: (matrix: mat4, emulated: boolean) => import('./geometry').XRPose}>) {
  const hands = new WeakMap<object, Readonly<{size: number; get: (name: string) => XRJointSpace;
    keys: () => MapIterator<string>; values: () => MapIterator<XRJointSpace>; entries: () => MapIterator<[string, XRJointSpace]>}>>();
  const joints = new WeakMap<object, Readonly<{name: string; radius: number; session: XRSession; update: () => mat4 | null}>>();
  const poses = new WeakMap<object, number>();
  const iterators = new WeakMap<object, Iterator<string | XRJointSpace | [string, XRJointSpace]>>();
  const sourceHands = new WeakMap<XRInputSource, XRHand>();
  type Backend = {session: XRSession; hand: XRHand; joint: XRJointSpace; pose: XRJointPose};
  const backends = new WeakMap<XRSession, Backend>(), trackers = new WeakMap<HandTracker, Backend>();
  function allocateHand(backend: Backend, source: XRInputSource, controller: number) {
    const {session} = backend;
    const collection = new Map<string, XRJointSpace>();
    const hand: XRHand = Object.create(backend.hand);
    for (const [index, name] of jointNames.entries()) {
      const radius = Math.fround(index === 0 ? 0.018 : name.endsWith('tip') ? 0.007 : 0.009);
      const update = () => {
        if (session.ended || !Array.from(session.inputSources).includes(source)) return null;
        const gamepad = session._device.gamepads[controller]; if (!gamepad) return null;
        const matrix = mat4.fromRotationTranslation(mat4.create(), gamepad.pose.orientation, gamepad.pose.position);
        if (index === 0) return matrix;
        // Deterministic simulated skeleton, in metres. Controller translation
        // and rotation move the hand; the panel trigger curls its fingers.
        const finger = index <= 4 ? 0 : 1 + Math.floor((index - 5) / 5);
        const joint = index <= 4 ? index : 1 + (index - 5) % 5;
        const side = gamepad.hand === 'left' ? -1 : 1, curled = gamepad.buttons[0].pressed;
        const position = (bone: number): vec3 => vec3.fromValues((finger - 2) * 0.019 * side, curled ? -bone * 0.009 : 0, -0.025 - bone * (curled ? 0.008 : 0.025));
        const origin = position(joint);
        const target = name.endsWith('tip') ? vec3.add(vec3.create(), origin, vec3.subtract(vec3.create(), origin, position(joint - 1))) : position(joint + 1);
        return mat4.multiply(matrix, matrix, mat4.targetTo(mat4.create(), origin, target, [0, 1, 0]));
      };
      const space = new XRSpace(session, update) as XRJointSpace;
      // XRSpace's diagnostic provider is unnecessary for joints. Its inherited
      // methods use the protected joint reader instead; no mutable record escapes.
      Reflect.deleteProperty(space, 'matrixProvider');
      Object.defineProperty(space, '_session', {value: session, configurable: false, writable: false});
      Object.setPrototypeOf(space, backend.joint);
      joints.set(space, Object.freeze({name, radius, session, update}));
      collection.set(name, space);
    }
    hands.set(hand, Object.freeze({size: collection.size, get: (name: string) => collection.get(name)!,
      keys: () => collection.keys(), values: () => collection.values(), entries: () => collection.entries()}));
    sourceHands.set(source, hand);
    return hand;
  }
  class HandTracker {
    constructor(session: XRSession, hand: XRHand, joint: XRJointSpace, pose: XRJointPose) {
      if (!sessions.has(session) || !session._device?.sessions.has(session._id)) throw new TypeError('Expected backend XRSession.');
      let backend = backends.get(session);
      if (!backend) { backend = {session, hand, joint, pose}; backends.set(session, backend); }
      trackers.set(this, backend);
    }
    hand(source: XRInputSource, raw?: DeviceInput): XRHand {
      const backend = trackers.get(this);
      if (!backend || !inputs.has(source)) throw new TypeError('Expected XRInputSource.');
      const existing = sourceHands.get(source);
      if (existing) {
        if (joints.get(hands.get(existing)!.get('wrist'))!.session !== backend.session) invalidState('Foreign hand source.');
        return existing;
      }
      if (backend.session.ended || !backend.session.enabledFeatures.includes('hand-tracking') || !Array.from(backend.session.inputSources).includes(source)) invalidState('Source is not an active hand source.');
      const controller = backend.session._device.gamepadInputSources.findIndex(input => input.inputSource === raw);
      if (controller < 0) throw new TypeError('Expected connected backend input.');
      return allocateHand(backend, source, controller);
    }
  }
  function pose(frame: XRFrame, joint: XRJointSpace, base: XRSpace): XRJointPose | null {
    const state = frames.get(frame), metadata = joints.get(joint);
    if (!state || !metadata) throw new TypeError('Expected frame and joint.');
    frame._assertActive(); state.session._owns(joint); state.session._owns(base);
    // Even self-relative joint queries are unavailable when the hand is lost.
    if (!metadata.update()) return null;
    const relative = relativePose(joint, base);
    if (!relative) return null;
    const result = state.pose(relative.matrix, relative.emulated) as XRJointPose;
    Object.setPrototypeOf(result, backends.get(state.session)!.pose);
    poses.set(result, metadata.radius);
    return result;
  }
  Object.freeze(HandTracker.prototype); Object.freeze(HandTracker);
  return Object.freeze({HandTracker, pose,
    iterator: (hand: XRHand, kind: 'keys' | 'values' | 'entries', prototype: object): IterableIterator<any> => {
      const state = hands.get(hand);
      if (!state) throw new TypeError('Expected XRHand.');
      const iterator = Object.create(prototype);
      iterators.set(iterator, state[kind]());
      return iterator;
    },
    next: (value: object) => {
      const iterator = iterators.get(value);
      if (!iterator) throw new TypeError('Expected XRHand Iterator.');
      return iterator.next();
    },
    sources: Object.freeze({get: (value: object) => sourceHands.get(value as XRInputSource)}),
    hands: Object.freeze({get: (value: object) => hands.get(value)}),
    joints: Object.freeze({get: (value: object) => joints.get(value), has: (value: object) => joints.has(value)}),
    poses: Object.freeze({get: (value: object) => poses.get(value)})});
}
