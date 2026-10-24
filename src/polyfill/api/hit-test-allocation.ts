import type {XRFrame, XRInputSource, XRSession} from './runtime';
import type {XRRigidTransform} from './geometry';
import type {HitTestOptions, TransientHitTestOptions, HitTestState, TransientHitTestState} from '../../types/polyfill';
import type XRHitTestResult from './XRHitTestResult';
import {mat4} from 'gl-matrix';

type Point = {x: number; y: number; z: number; w: number};

type Reader<T> = Readonly<{get(value: object): T | undefined; has(value: object): boolean}>;
type RayRecord = Readonly<{origin: DOMPointReadOnly; direction: DOMPointReadOnly; matrix: () => Float32Array}>;
type SourceRecord = Readonly<HitTestState>;
type TransientSourceRecord = Readonly<TransientHitTestState>;
type HitRecord = Readonly<{frame: XRFrame; transform: XRRigidTransform}>;
type TransientRecord = Readonly<{inputSource: XRInputSource; results: readonly XRHitTestResult[]}>;
interface HitTestAllocations {
  RayAllocation: new (p: Point, d: Point) => object;
  HitSourceAllocation: new (session: XRSession, options: HitTestOptions) => object;
  TransientHitSourceAllocation: new (session: XRSession, options: TransientHitTestOptions) => object;
  HitResultAllocation: new (frame: XRFrame, transform: XRRigidTransform) => object;
  TransientHitResultAllocation: new (frame: XRFrame, results: XRHitTestResult[], inputSource: XRInputSource) => object;
  rays: Reader<RayRecord>; hitSources: Reader<SourceRecord>; transientHitSources: Reader<TransientSourceRecord>;
  hitResults: Reader<HitRecord>; transientHitResults: Reader<TransientRecord>;
}

/** Only allocation constructors write these records, and always for their new
 * object. The cross-realm registry exposes frozen readers, never map writers or
 * mutable retained records. Borrowing a prototype cannot acquire a record. */
export function createHitTestAllocations(brands: {
  sessions: WeakSet<object>; spaces: WeakSet<object>; frames: WeakSet<object>;
  inputSources: WeakSet<object>; transforms: WeakMap<object, unknown>;
}): Readonly<HitTestAllocations> {
  const rays = new WeakMap<object, RayRecord>();
  const hitSources = new WeakMap<object, SourceRecord>();
  const transientHitSources = new WeakMap<object, TransientSourceRecord>();
  const hitResults = new WeakMap<object, HitRecord>();
  const transientHitResults = new WeakMap<object, TransientRecord>();
  function sourceRecord<T extends object>(session: XRSession, options: HitTestOptions | TransientHitTestOptions, extra: T, membership: Set<unknown>, source: object) {
    const offsetRay = options.offsetRay!;
    if (!brands.sessions.has(session) || !rays.has(offsetRay)) throw new TypeError('Expected session and ray.');
    const entityTypes = Object.freeze([...options.entityTypes!]);
    if (entityTypes.some(type => !['plane', 'mesh', 'point'].includes(type))) throw new TypeError('Invalid entity type.');
    return Object.freeze({...extra, session, offsetRay, entityTypes,
      get active() { return membership.has(source); }});
  }
  class RayAllocation {
    constructor(p: Point, d: Point) {
      // Snapshot numeric values even when this internal allocation base is called
      // directly. No caller-supplied object or callback becomes retained state.
      p = {x: +p.x, y: +p.y, z: +p.z, w: +p.w};
      d = {x: +d.x, y: +d.y, z: +d.z, w: +d.w};
      if (p.w !== 1 || d.w !== 0 || ![d.x, d.y, d.z].every(Number.isFinite) || (d.x === 0 && d.y === 0 && d.z === 0)) throw new TypeError('Invalid ray.');
      const scale = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
      const length = Math.hypot(d.x / scale, d.y / scale, d.z / scale);
      d.x = d.x / scale / length; d.y = d.y / scale / length; d.z = d.z / scale / length;
      const origin = Object.freeze(new DOMPointReadOnly(p.x, p.y, p.z, p.w));
      const direction = Object.freeze(new DOMPointReadOnly(d.x, d.y, d.z, d.w));
      let matrix: Float32Array | undefined;
      rays.set(this, Object.freeze({origin, direction, matrix: () => {
        if (!matrix || matrix.buffer.byteLength === 0) {
          const rotation = mat4.create();
          const sine = Math.hypot(d.x, d.y);
          if (sine > 0) {
            // A unit axis avoids gl-matrix's small-axis rejection. atan2 also
            // preserves tiny rotations when the cosine rounds to +1 or -1.
            mat4.fromRotation(rotation, Math.atan2(sine, -d.z), [d.y / sine, -d.x / sine, 0]);
          } else if (d.z > 0) mat4.fromRotation(rotation, Math.PI, [1, 0, 0]);
          rotation[12] = p.x; rotation[13] = p.y; rotation[14] = p.z;
          matrix = new Float32Array(rotation);
        }
        return matrix;
      }}));
    }
  }
  class HitSourceAllocation {
    constructor(session: XRSession, options: HitTestOptions) {
      const space = options.space;
      if (!brands.spaces.has(space)) throw new TypeError('Expected XRSpace.');
      hitSources.set(this, sourceRecord(session, options, {space}, session._hitSources, this));
    }
  }
  class TransientHitSourceAllocation {
    constructor(session: XRSession, options: TransientHitTestOptions) {
      const profile = `${options.profile}`;
      transientHitSources.set(this, sourceRecord(session, options, {profile}, session._transientSources, this));
    }
  }
  class HitResultAllocation {
    constructor(frame: XRFrame, transform: XRRigidTransform) {
      if (!brands.frames.has(frame) || !brands.transforms.has(transform)) throw new TypeError('Expected frame and transform.');
      hitResults.set(this, Object.freeze({frame, transform}));
    }
  }
  class TransientHitResultAllocation {
    constructor(frame: XRFrame, results: XRHitTestResult[], inputSource: XRInputSource) {
      if (!brands.frames.has(frame) || !brands.inputSources.has(inputSource)) throw new TypeError('Expected frame and input source.');
      const snapshot = [...results];
      if (snapshot.some(result => hitResults.get(result)?.frame !== frame)) throw new TypeError('Expected frame hit results.');
      transientHitResults.set(this, Object.freeze({inputSource, results: Object.freeze(snapshot)}));
    }
  }
  function reader<T>(map: WeakMap<object, T>) {
    return Object.freeze({get: (value: object) => map.get(value), has: (value: object) => map.has(value)});
  }
  for (const C of [RayAllocation, HitSourceAllocation, TransientHitSourceAllocation, HitResultAllocation, TransientHitResultAllocation]) {
    Object.freeze(C.prototype); Object.freeze(C);
  }
  return Object.freeze({RayAllocation, HitSourceAllocation, TransientHitSourceAllocation, HitResultAllocation, TransientHitResultAllocation,
    rays: reader(rays), hitSources: reader(hitSources), transientHitSources: reader(transientHitSources),
    hitResults: reader(hitResults), transientHitResults: reader(transientHitResults)});
}
