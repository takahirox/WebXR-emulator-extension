import {mat4} from 'gl-matrix';
import type EmulatedXRDevice from '../EmulatedXRDevice';
import type {SessionMode} from '../../types/contracts';
import type {HitTestOptions, TransientHitTestOptions} from '../../types/polyfill';
import {SourceGamepad, type DeviceInput, type InputSignal} from '../device-adapter';
import {XRSpace, XRReferenceSpace, XRBoundedReferenceSpace, XRRigidTransform, XRPose, XRViewerPose, XRView, sessionObjects, frameObjects, spaceObjects, invalidState, unsupported} from './geometry';
import {HALL_PLAY_AREA} from '../virtual-play-area';
import {XRCompositionLayer, XRProjectionLayer, XRWebGLLayer} from './layers';
import {XRAnchor, XRAnchorSet, XRHand, XRJointSpace, XRJointPose, XRLightProbe, XRLightEstimate, XRCPUDepthInformation, jointObjects} from './sensing';
import {interfaceValue, interfaceSequence, float32Output} from './bulk-input';
import {interfaceBrands} from './interface-brand';
import XRHitTestSource from './XRHitTestSource';
import XRTransientInputHitTestSource from './XRTransientInputHitTestSource';
import XRHitTestResult from './XRHitTestResult';
import XRTransientInputHitTestResult from './XRTransientInputHitTestResult';
import XRInputSourceArray from './XRInputSourceArray';
import type DOMOverlay from '../DOMOverlay';
import {convertSessionMode, convertSessionInit} from './session-init';
import {EnvironmentTracker} from './environment';
export {XRInputSourceArray};

export class XREventTarget extends EventTarget {
  _emit(event: Event) {
    this.dispatchEvent(event);
    const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
    if (typeof handler === 'function') {
      try { handler.call(this, event); } catch (error) { reportError(error); }
    }
  }
}
export class XRSessionEvent extends Event { constructor(type: string, init: EventInit & {session: XRSession}) { super(type, init); this.session = init.session; } readonly session: XRSession; }
export class XRInputSourceEvent extends Event {
  readonly frame: XRFrame; readonly inputSource: XRInputSource;
  constructor(type: string, init: EventInit & {frame: XRFrame; inputSource: XRInputSource}) { super(type, init); this.frame = init.frame; this.inputSource = init.inputSource; }
}
export class XRInputSourcesChangeEvent extends XRSessionEvent {
  readonly added: readonly XRInputSource[]; readonly removed: readonly XRInputSource[];
  constructor(type: string, init: EventInit & {session: XRSession; added: XRInputSource[]; removed: XRInputSource[]}) {
    super(type, init); this.added = Object.freeze(init.added); this.removed = Object.freeze(init.removed);
  }
}
export class XRRenderState {
  readonly depthNear: number; readonly depthFar: number; readonly inlineVerticalFieldOfView: number | null; readonly baseLayer: XRWebGLLayer | null;
  readonly layers: readonly XRCompositionLayer[] | null;
  constructor(init: Partial<XRRenderState> = {}) {
    this.depthNear = init.depthNear ?? 0.1; this.depthFar = init.depthFar ?? 1000;
    this.inlineVerticalFieldOfView = init.inlineVerticalFieldOfView === undefined ? null : init.inlineVerticalFieldOfView;
    this.baseLayer = init.baseLayer ?? null; this.layers = init.layers ? Object.freeze([...init.layers]) : null;
    Object.freeze(this);
  }
}
// Emulator-selected limits, applied only when a pending state becomes active.
// Device CRD 2026-06-09 imposes a near minimum and far maximum, not near < far.
const minimumDepthNear = 0.01;
const maximumDepthFar = 10000;
const minimumInlineFov = 0.01;
const maximumInlineFov = 3.13;
type RenderStateInit = {-readonly [K in keyof XRRenderState]?: XRRenderState[K]};
function convertRenderStateInit(value: unknown): RenderStateInit {
  if (value == null) return {};
  if (typeof value !== 'object' && typeof value !== 'function') throw new TypeError('Expected XRRenderStateInit dictionary.');
  const dictionary = value as Record<string, unknown>;
  const init: RenderStateInit = {};
  // WebIDL dictionary members are read and converted once, in lexicographic
  // order (including inherited/non-enumerable members), before session checks.
  const baseLayer = dictionary.baseLayer;
  if (baseLayer !== undefined) {
    if (baseLayer !== null && !(baseLayer instanceof XRWebGLLayer)) throw new TypeError('Expected XRWebGLLayer.');
    init.baseLayer = baseLayer;
  }
  for (const key of ['depthFar', 'depthNear', 'inlineVerticalFieldOfView'] as const) {
    const member = dictionary[key];
    if (member === undefined) continue;
    // Unary + implements ToNumber, including rejecting BigInt (Number() does not).
    const number = +(member as number);
    if (!Number.isFinite(number)) throw new TypeError(`${key} must be a finite double.`);
    init[key] = number;
  }
  const layers = dictionary.layers;
  if (layers !== undefined) {
    if (layers === null) init.layers = null;
    else {
      if ((typeof layers !== 'object' && typeof layers !== 'function') || !(Symbol.iterator in layers)) throw new TypeError('Expected layer sequence.');
      init.layers = Array.from(layers as Iterable<XRCompositionLayer>);
    }
  }
  return init;
}
export class XRSystem extends XREventTarget {
  ondevicechange: ((event: Event) => void) | null = null;
  private immersive: XRSession | null = null;
  private requesting = false;
  private sessions = new Set<XRSession>();
  constructor(private devicePromise: Promise<EmulatedXRDevice>) {
    super();
    window.addEventListener('webxr-device', () => this._emit(new Event('devicechange')));
    window.addEventListener('webxr-exit-immersive', () => { void this.immersive?.end(); });
  }
  async isSessionSupported(value?: unknown) {
    const mode = convertSessionMode(value);
    return (await this.devicePromise).isSessionSupported(mode);
  }
  async requestSession(value?: unknown, dictionary?: unknown) {
    const mode = convertSessionMode(value);
    const options = convertSessionInit(dictionary);
    const overlayRoot = options.domOverlay?.root;
    const needsActivation = mode !== 'inline' || [...(options.requiredFeatures ?? []), ...(options.optionalFeatures ?? [])].some(feature => feature !== 'inline-stereo');
    if (needsActivation && !navigator.userActivation.isActive) throw new DOMException('XR session request requires transient user activation.', 'SecurityError');
    if (mode !== 'inline' && (this.immersive || this.requesting)) invalidState('An immersive session is already pending or active.');
    if (mode !== 'inline') this.requesting = true;
    try {
      const device = await this.devicePromise;
      if (!device.isSessionSupported(mode)) unsupported('The selected profile/mode does not support this session mode.');
      const required = new Set(['viewer', ...(mode === 'inline' ? [] : ['local']), ...(options.requiredFeatures ?? [])]);
      const enabled = new Set<string>();
      for (const feature of new Set([...required, ...(options.optionalFeatures ?? [])])) {
        let supported = device.isFeatureSupported(feature, mode);
        if (feature === 'dom-overlay') supported = supported && device.canPresentDOMOverlay(overlayRoot);
        if (feature === 'depth-sensing') {
          if (!options.depthSensing) { supported = false; }
          else {
            const {usagePreference, dataFormatPreference} = options.depthSensing;
            supported = supported && (!usagePreference.length || usagePreference.includes('cpu-optimized')) && (!dataFormatPreference.length || dataFormatPreference.some(format => ['float32', 'unsigned-short', 'luminance-alpha'].includes(format)));
          }
        }
        if (!supported && required.has(feature)) unsupported(`Required feature ${feature} is unavailable in ${mode}.`);
        if (supported) enabled.add(feature);
      }
      const depthFormat = options.depthSensing?.dataFormatPreference.find(format => ['float32', 'unsigned-short', 'luminance-alpha'].includes(format)) ?? 'float32';
      const id = await device.requestSession(mode, enabled);
      const session = new XRSession(device, mode, id, enabled, () => {
        this.sessions.delete(session);
        if (this.immersive === session) {
          this.immersive = null;
          for (const inline of this.sessions) inline._setImmersiveSuppressed(false);
        }
      });
      session._depthFormat = depthFormat;
      if (enabled.has('dom-overlay')) {
        try { session._startDOMOverlay(overlayRoot as HTMLElement); }
        catch {
          if (required.has('dom-overlay')) {
            await session.end();
            unsupported('The DOM Overlay Preview root could not be presented.');
          }
          enabled.delete('dom-overlay');
          session._omitDOMOverlay();
        }
      }
      this.sessions.add(session);
      if (mode === 'inline' && this.immersive) session._setImmersiveSuppressed(true);
      if (mode !== 'inline') {
        this.immersive = session;
        for (const other of this.sessions) if (other !== session) other._setImmersiveSuppressed(true);
      }
      return session;
    } finally { if (mode !== 'inline') this.requesting = false; }
  }
}

type Callback = (time: number, frame: XRFrame) => void;
const inputEvents = ['select-start', 'select-end', 'squeeze-start', 'squeeze-end'] as const;
export class XRSession extends XREventTarget {
  private callbacks = new Map<number, Callback>();
  private nextCallback = 0;
  private frameHandle = 0;
  private currentCallbacks: Map<number, Callback> | null = null;
  private animationFrame: XRFrame | null = null;
  private pendingRenderState: XRRenderState | null = null;
  private presentation: XRWebGLLayer | null = null;
  private activeRenderState: XRRenderState;
  private endedValue = false;
  private visibility: 'visible' | 'visible-blurred' | 'hidden' = document.hidden ? 'hidden' : 'visible';
  private sources: readonly XRInputSource[] = Object.freeze([]);
  private readonly inputSourceArray = new XRInputSourceArray(() => this.sources);
  private signals: {type: typeof inputEvents[number]; source: DeviceInput}[] = [];
  private listeners: [string, (detail: InputSignal) => void][] = [];
  private endListener: (id: number) => void;
  private immersiveSuppressed = false;
  private visibilityListener = () => this._setVisibility(document.hidden || this.immersiveSuppressed ? 'hidden' : 'visible');
  readonly _anchors = new Set<XRAnchor>();
  readonly _environment = new EnvironmentTracker(this);
  _depthFormat = 'float32';
  private roomCaptureCompleted = false;
  private inputWrappers = new Map<DeviceInput, XRInputSource>();
  private rawSources: DeviceInput[] = [];
  private depthRunning = true;
  private overlay: DOMOverlay | null = null;
  private overlayState: Readonly<{type: 'screen'}> | null = null;
  _startDOMOverlay(root: HTMLElement) {
    this.overlay = this._device.startDOMOverlay(root, () => { if (!this.ended) void this.end(); });
    this.overlayState = Object.freeze({type: 'screen'});
  }
  _omitDOMOverlay() { this.features = Object.freeze(this.features.filter(feature => feature !== 'dom-overlay')); }
  private features: readonly string[];
  readonly isSystemKeyboardSupported = false;
  readonly interactionMode: 'screen-space' | 'world-space';
  readonly _viewer: XRReferenceSpace;
  readonly _hitSources = new Set<XRHitTestSource>();
  readonly _transientSources = new Set<XRTransientInputHitTestSource>();
  onend: ((event: Event) => void) | null = null;
  onvisibilitychange: ((event: Event) => void) | null = null;
  oninputsourceschange: ((event: Event) => void) | null = null;
  onselectstart: ((event: Event) => void) | null = null;
  onselect: ((event: Event) => void) | null = null;
  onselectend: ((event: Event) => void) | null = null;
  onsqueezestart: ((event: Event) => void) | null = null;
  onsqueeze: ((event: Event) => void) | null = null;
  onsqueezeend: ((event: Event) => void) | null = null;
  constructor(readonly _device: EmulatedXRDevice, readonly _mode: SessionMode, readonly _id: number, enabled: Set<string>, private onShutdown: () => void) {
    super(); sessionObjects.add(this); this.features = Object.freeze([...enabled]); this.interactionMode = _device.handheld ? 'screen-space' : 'world-space';
    this.activeRenderState = new XRRenderState({inlineVerticalFieldOfView: _mode === 'inline' ? Math.PI / 2 : null});
    this._viewer = new XRReferenceSpace(this, 'viewer', () => mat4.clone(_device.getBasePoseMatrix()));
    for (const type of inputEvents) {
      const listener = (detail: InputSignal) => { if (detail.sessionId === _id) this.signals.push({type, source: detail.inputSource}); };
      this.listeners.push([`@@webxr-polyfill/input-${type}`, listener]);
      _device.addEventListener(`@@webxr-polyfill/input-${type}`, listener);
    }
    this.endListener = id => { if (id === _id) this._finish(); };
    _device.addEventListener('@@webxr-polyfill/vr-present-end', this.endListener);
    document.addEventListener('visibilitychange', this.visibilityListener);
    this.frameHandle = _device.requestAnimationFrame(this.tick);
  }
  get enabledFeatures() { return this.features; }
  get ended() { return this.endedValue; }
  get renderState() { return this.activeRenderState; }
  get visibilityState() { return this.visibility; }
  get inputSources() { return this.inputSourceArray; }
  private assertDepthConfiguration() { if (!this.enabledFeatures.includes('depth-sensing')) invalidState('Depth sensing was not enabled.'); }
  private assertDepthFrame() {
    this._assertLive();
    if (!this.animationFrame?._active) invalidState('Depth sensing can only be changed during an active animation frame.');
    this._require('depth-sensing');
  }
  get depthUsage() { this.assertDepthConfiguration(); return 'cpu-optimized'; }
  get depthDataFormat() { this.assertDepthConfiguration(); return this._depthFormat; }
  get depthType() { this.assertDepthConfiguration(); return 'smooth'; }
  get depthActive() { this.assertDepthConfiguration(); return this.depthRunning; }
  pauseDepthSensing() { this.assertDepthFrame(); this.depthRunning = false; }
  resumeDepthSensing() { this.assertDepthFrame(); this.depthRunning = true; }
  get preferredReflectionFormat() { return 'srgba8'; }
  get persistentAnchors() { return Object.freeze([] as string[]); }
  async restorePersistentAnchor(_uuid: string): Promise<XRAnchor> { this._require('anchors'); return unsupported('Persistent anchors are not simulated.'); }
  async deletePersistentAnchor(_uuid: string) { this._require('anchors'); unsupported('Persistent anchors are not simulated.'); }
  async requestLightProbe(options: {reflectionFormat?: string} = {}) {
    this._require('light-estimation');
    if (options.reflectionFormat && !['srgba8', 'rgba16f'].includes(options.reflectionFormat)) throw new TypeError('Invalid XRReflectionFormat.');
    if (options.reflectionFormat === 'rgba16f') unsupported('Only srgba8 reflection format is supported.');
    return new XRLightProbe(this);
  }
  get environmentBlendMode() { return this._mode === 'immersive-ar' ? 'alpha-blend' : 'opaque'; }
  get domOverlayState() { return this.overlayState; }
  _assertLive() { if (this.ended) invalidState('The session has ended.'); }
  _require(feature: string) { this._assertLive(); if (!this.enabledFeatures.includes(feature)) unsupported(`${feature} was not enabled.`); }
  _owns(space: XRSpace) {
    interfaceValue(space, spaceObjects, 'XRSpace');
    if (space._session !== this) invalidState('Space belongs to a different session.');
  }
  _setVisibility(value: typeof this.visibility) {
    if (this.ended || value === this.visibility) return;
    this.visibility = value; this._emit(new XRSessionEvent('visibilitychange', {session: this}));
  }
  _setImmersiveSuppressed(value: boolean) {
    this.immersiveSuppressed = value; this.visibilityListener();
  }
  async initiateRoomCapture() {
    this._assertLive();
    if (this.roomCaptureCompleted) invalidState('Room capture already completed.');
    this._require('plane-detection');
    // The packaged room loads automatically; there is no manual sensor capture.
    this.roomCaptureCompleted = true;
  }
  async requestReferenceSpace(type: string) {
    this._assertLive();
    if (!['viewer', 'local', 'local-floor', 'bounded-floor', 'unbounded'].includes(type)) throw new TypeError('Invalid XRReferenceSpaceType.');
    if (!this.enabledFeatures.includes(type)) unsupported(`Reference space ${type} was not enabled.`);
    if (type === 'viewer') return this._viewer;
    const inverse = await this._device.requestFrameOfReferenceTransform(type, undefined);
    this._assertLive();
    const world = mat4.invert(mat4.create(), inverse)!;
    if (type === 'bounded-floor') return new XRBoundedReferenceSpace(this, () => world, HALL_PLAY_AREA);
    return new XRReferenceSpace(this, type, () => world);
  }
  updateRenderState(value: unknown = {}) {
    const init = convertRenderStateInit(value);
    this._assertLive();
    if (init.baseLayer && (!(init.baseLayer instanceof XRWebGLLayer) || init.baseLayer._session !== this)) invalidState('Layer belongs to a different session.');
    if (init.inlineVerticalFieldOfView !== undefined && this._mode !== 'inline') invalidState('Immersive sessions cannot set inlineVerticalFieldOfView.');
    if (Object.keys(init).length === 0) return;
    if (init.baseLayer !== undefined && init.layers !== undefined) unsupported('baseLayer and layers cannot both be supplied.');
    if (init.layers !== undefined && init.layers !== null) {
      if (!this.enabledFeatures.includes('layers') && (init.layers.length > 1 || init.layers.some(layer => !(layer instanceof XRProjectionLayer)))) unsupported('Only a single projection layer is supported without the layers feature.');
      if (new Set(init.layers).size !== init.layers.length) throw new TypeError('Duplicate composition layers.');
      for (const layer of init.layers) if (!(layer instanceof XRCompositionLayer) || layer._binding._session !== this || layer._destroyed) invalidState('Invalid composition layer.');
      if (init.layers.some(layer => layer._binding._context !== init.layers![0]._binding._context)) unsupported('All layers must share one WebGL context.');
    }
    const state = {...(this.pendingRenderState ?? this.renderState), ...init};
    if (init.baseLayer !== undefined) state.layers = null;
    if (init.layers !== undefined) state.baseLayer = null;
    this.pendingRenderState = new XRRenderState(state);
  }
  _removeLayer(layer: XRCompositionLayer) {
    const state = this.pendingRenderState ?? this.renderState;
    if (!state.layers?.includes(layer)) return;
    this.pendingRenderState = new XRRenderState({...state, layers: state.layers.filter(entry => entry !== layer)});
  }
  requestAnimationFrame(callback: Callback) { if (typeof callback !== 'function') throw new TypeError('Expected callback.'); if (this.ended) return 0; const id = ++this.nextCallback; this.callbacks.set(id, callback); return id; }
  cancelAnimationFrame(id: number) { this.callbacks.delete(id); this.currentCallbacks?.delete(id); }
  async end() {
    this._assertLive(); this._device.endSession(this._id); this._finish();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  private _finish() {
    if (this.ended) return;
    this.overlay?.dispose(); this.overlay = null;
    this.endedValue = true; this._device.cancelAnimationFrame(this.frameHandle);
    for (const [type, listener] of this.listeners) this._device.removeEventListener(type, listener);
    this._device.removeEventListener('@@webxr-polyfill/vr-present-end', this.endListener);
    document.removeEventListener('visibilitychange', this.visibilityListener);
    for (const anchor of this._anchors) anchor.delete();
    this._environment.clear();
    for (const source of this.inputWrappers.values()) source._retire();
    this.inputWrappers.clear();
    this.callbacks.clear(); this.currentCallbacks?.clear(); this.signals = []; this.sources = Object.freeze([]);
    for (const source of [...this._hitSources, ...this._transientSources]) source._deactivate();
    this._hitSources.clear(); this._transientSources.clear();
    // Release system state now, but deliver the public event in a later task.
    setTimeout(() => this._emit(new XRSessionEvent('end', {session: this})), 0);
    this.onShutdown();
  }
  async requestHitTestSource(options: HitTestOptions) {
    this._require('hit-test'); this._owns(options.space);
    const source = new XRHitTestSource(this, options); this._hitSources.add(source); this._device.addHitTestSource(source); return source;
  }
  async requestHitTestSourceForTransientInput(options: TransientHitTestOptions) {
    this._require('hit-test'); const source = new XRTransientInputHitTestSource(this, options); this._transientSources.add(source); this._device.addHitTestSourceForTransientInput(source); return source;
  }
  private emitInput(type: string, inputSource: XRInputSource, time: number) {
    const frame = new XRFrame(this, time, false); frame._active = true;
    try { this._emit(new XRInputSourceEvent(type, {frame, inputSource})); } finally { frame._active = false; }
  }
  private tick = (time: number) => {
    if (this.ended) return;
    this.frameHandle = this._device.requestAnimationFrame(this.tick);
    if (this.visibility === 'hidden') return;
    if (this.pendingRenderState) {
      const previous = this.presentation;
      const state = this.pendingRenderState;
      this.activeRenderState = new XRRenderState({...state,
        depthNear: Math.max(minimumDepthNear, state.depthNear),
        depthFar: Math.min(maximumDepthFar, state.depthFar),
        inlineVerticalFieldOfView: state.inlineVerticalFieldOfView === null ? null : Math.max(minimumInlineFov, Math.min(maximumInlineFov, state.inlineVerticalFieldOfView)),
      });
      this.pendingRenderState = null;
      this.presentation = this.renderState.baseLayer ?? this.renderState.layers?.[0]?._binding._presentation ?? null;
      if (this.presentation && this.presentation !== previous) this._device.onBaseLayerSet(this._id, this.presentation);
    }
    if (!this.presentation || this.presentation.context.isContextLost()) return;
    this._viewer._update();
    for (const source of this._hitSources) if (source._space instanceof XRSpace) source._space._update();
    this._device.onFrameStart(this._id, {depthNear: this.renderState.depthNear, depthFar: this.renderState.depthFar, inlineVerticalFieldOfView: this.renderState.inlineVerticalFieldOfView ?? Math.PI / 2});
    this.rawSources = this._mode === 'inline' ? [] : this._device.getInputSources();
    const replaced: XRInputSource[] = [];
    const next: XRInputSource[] = this.rawSources.map(source => {
      const previous = this.inputWrappers.get(source);
      if (!previous || !previous._matches(source)) {
        if (previous) { previous._retire(); replaced.push(previous); }
        // Active sources can omit earlier controllers; hands need the adapter slot.
        const controllerIndex = this._device.gamepadInputSources.findIndex(input => input.inputSource === source);
        this.inputWrappers.set(source, new XRInputSource(this, source, controllerIndex));
      }
      return this.inputWrappers.get(source)!;
    });
    const added = next.filter(source => !this.sources.includes(source));
    const removed = this.sources.filter(source => !next.includes(source) && !replaced.includes(source));
    // New sources precede their first action; disappearing transient sources remain
    // observable until select/selectend have been dispatched.
    this.sources = Object.freeze([...next, ...removed]);
    for (const source of next) source._updatePose();
    if (added.length || replaced.length) this._emit(new XRInputSourcesChangeEvent('inputsourceschange', {session: this, added, removed: replaced}));
    if (this.ended) return;
    for (const signal of this.signals.splice(0)) {
      if (this.ended) break;
      // A completed action delivers both events with the same identity, even if
      // its first handler shuts down the session and clears the wrapper map.
      const source = this.inputWrappers.get(signal.source);
      if (!source) continue;
      const prefix = signal.type.startsWith('squeeze') ? 'squeeze' : 'select';
      const starting = signal.type.endsWith('start');
      if (!starting) this.emitInput(prefix, source, time);
      this.emitInput(`${prefix}${starting ? 'start' : 'end'}`, source, time);
    }
    if (this.ended) return;
    this.sources = Object.freeze(next.slice());
    for (const source of removed) source._retire();
    if (removed.length) this._emit(new XRInputSourcesChangeEvent('inputsourceschange', {session: this, added: [], removed: [...removed]}));
    if (this.ended) return;
    for (const [raw, wrapper] of this.inputWrappers) if (removed.includes(wrapper)) this.inputWrappers.delete(raw);
    this._device.computeHitTests(this._id);
    if (this.enabledFeatures.some(feature => feature === 'plane-detection' || feature === 'mesh-detection')) this._environment.update(time);
    const frame = new XRFrame(this, time, true);
    const layers = this.renderState.layers;
    if (layers?.length) layers[0]._binding._prepare(layers);
    const callbacks = this.currentCallbacks = this.callbacks; this.callbacks = new Map(); frame._active = true;
    this.animationFrame = frame;
    try {
      for (const [id, callback] of callbacks) {
        if (this.ended) break;
        callbacks.delete(id);
        try { callback(time, frame); } catch (error) { window.dispatchEvent(new ErrorEvent('error', {error, message: String(error)})); }
      }
      if (!this.ended && layers?.length) layers[0]._binding._compose(frame, layers);
    } finally { frame._active = false; this.animationFrame = null; this.currentCallbacks = null; if (!this.ended) this._device.onFrameEnd(this._id); }
  };
}

export class XRFrame extends interfaceBrands.FrameObject {
  _active = false;
  private hitResults = new Map<XRHitTestSource, XRHitTestResult[]>();
  private anchorSnapshot: XRAnchorSet;
  private environmentSnapshot: ReturnType<EnvironmentTracker['snapshot']>;
  private transientResults = new Map<XRTransientInputHitTestSource, XRTransientInputHitTestResult[]>();
  constructor(readonly session: XRSession, readonly predictedDisplayTime: number, readonly _animation: boolean) {
    super();
    this.anchorSnapshot = new XRAnchorSet(session._anchors);
    this.environmentSnapshot = session._environment.snapshot();
    if (_animation) {
      for (const source of session._hitSources) this.hitResults.set(source, session._device.getHitTestResults(source).map(matrix => new XRHitTestResult(this, XRRigidTransform._fromMatrix(matrix))));
      for (const source of session._transientSources) {
        const input = Array.from(session.inputSources).find(input => input.targetRayMode === 'screen' && input.profiles.includes(source._profile));
        const hits = session._device.getHitTestResultsForTransientInput(source).map(matrix => new XRHitTestResult(this, XRRigidTransform._fromMatrix(matrix)));
        this.transientResults.set(source, input ? [new XRTransientInputHitTestResult(this, hits, input)] : []);
      }
    }
  }
  _assertActive(animation = false) { this.session._assertLive(); if (!this._active || (animation && !this._animation)) invalidState('XRFrame is not active for this operation.'); }
  _world(space: XRSpace): mat4 | null {
    this.session._owns(space);
    return space._update();
  }
  getPose(space: XRSpace, baseSpace: XRSpace) {
    this._assertActive(); const world = this._world(space); const base = this._world(baseSpace);
    return world && base ? new XRPose(XRRigidTransform._fromMatrix(mat4.multiply(mat4.create(), mat4.invert(mat4.create(), base)!, world))) : null;
  }
  getViewerPose(referenceSpace: XRReferenceSpace) {
    this._assertActive(true); if (!(referenceSpace instanceof XRReferenceSpace)) throw new TypeError('Expected XRReferenceSpace.');
    const pose = this.getPose(this.session._viewer, referenceSpace); if (!pose) return null;
    const device = this.session._device;
    const eyes: ('none' | 'left' | 'right')[] = this.session._mode === 'inline' || device.handheld ? ['none'] : ['left', 'right'];
    const inverse = mat4.invert(mat4.create(), this._world(referenceSpace)!)!;
    const views = eyes.map(eye => {
      const world = mat4.invert(mat4.create(), device.getBaseViewMatrix(eye))!;
      return new XRView(this, eye, XRRigidTransform._fromMatrix(mat4.multiply(mat4.create(), inverse, world)), new Float32Array(device.getProjectionMatrix(eye)), world);
    });
    return new XRViewerPose(pose.transform, Object.freeze(views));
  }
  get detectedPlanes() { this._assertActive(); return this.environmentSnapshot.planes; }
  get detectedMeshes() { this._assertActive(); return this.environmentSnapshot.meshes; }
  get trackedAnchors() { this._assertActive(); this.session._require('anchors'); return this.anchorSnapshot; }
  async createAnchor(pose: XRRigidTransform, space: XRSpace) {
    this._assertActive(); this.session._require('anchors');
    if (!(pose instanceof XRRigidTransform)) throw new TypeError('Expected XRRigidTransform.');
    const world = this._world(space); if (!world) throw new DOMException('Space is not tracked.', 'OperationError');
    const anchor = new XRAnchor(this.session, mat4.multiply(mat4.create(), world, pose.matrix));
    return new Promise<XRAnchor>((resolve, reject) => queueMicrotask(() => {
      if (this.session.ended) { anchor.delete(); reject(new DOMException('Session ended before anchor tracking began.', 'InvalidStateError')); }
      else { this.session._anchors.add(anchor); resolve(anchor); }
    }));
  }
  getJointPose(joint: XRJointSpace, baseSpace: XRSpace) {
    this._assertActive(); this.session._require('hand-tracking');
    if (!(joint instanceof XRJointSpace)) throw new TypeError('Expected XRJointSpace.');
    const pose = this.getPose(joint, baseSpace); return pose ? new XRJointPose(pose.transform, joint._radius) : null;
  }
  fillJointRadii(joints: Iterable<XRJointSpace>, radii: Float32Array) {
    interfaceValue(this, frameObjects, 'XRFrame');
    if (arguments.length < 2) throw new TypeError('Expected joints and radii.');
    const list = interfaceSequence<XRJointSpace>(joints, jointObjects, 'XRJointSpace');
    const capacity = float32Output(radii);
    this._assertActive();
    for (const joint of list) this.session._owns(joint);
    if (capacity < list.length) throw new TypeError('Insufficient radii array.');
    let valid = true;
    for (const [index, joint] of list.entries()) {
      // All joints of an emulated hand share the same tracking availability.
      // Query native tracking independently of any reference/base space.
      const tracked = joint._update() !== null;
      radii[index] = tracked ? joint._radius : NaN;
      if (!tracked) valid = false;
    }
    return valid;
  }
  fillPoses(spaces: Iterable<XRSpace>, baseSpace: XRSpace, transforms: Float32Array) {
    interfaceValue(this, frameObjects, 'XRFrame');
    if (arguments.length < 3) throw new TypeError('Expected spaces, baseSpace and transforms.');
    const list = interfaceSequence<XRSpace>(spaces, spaceObjects, 'XRSpace');
    interfaceValue(baseSpace, spaceObjects, 'XRSpace');
    const capacity = float32Output(transforms);
    this._assertActive();
    for (const space of list) this.session._owns(space);
    this.session._owns(baseSpace);
    if (capacity < list.length * 16) throw new TypeError('Insufficient transform array.');
    let valid = true;
    for (const [index, space] of list.entries()) {
      const pose = this.getPose(space, baseSpace);
      if (!pose) valid = false;
      for (let component = 0; component < 16; component++) transforms[index * 16 + component] = pose ? pose.transform.matrix[component] : NaN;
    }
    return valid;
  }
  getLightEstimate(probe: XRLightProbe) {
    this._assertActive(); this.session._require('light-estimation'); if (!(probe instanceof XRLightProbe)) throw new TypeError('Expected XRLightProbe.');
    if (probe._session !== this.session) invalidState('Light probe belongs to a different session.'); return new XRLightEstimate();
  }
  getDepthInformation(view: XRView) {
    this._assertActive(true); this.session._require('depth-sensing');
    if (!(view instanceof XRView)) throw new TypeError('Expected XRView.'); if (view._frame !== this) invalidState('View belongs to a different frame.');
    if (!this.session.depthActive || !this.session._device.arScene?.room) return null;
    return new XRCPUDepthInformation(this, view);
  }
  getHitTestResults(source: XRHitTestSource) { this._assertActive(); if (!this.hitResults.has(source)) invalidState('Hit test source was not active for this frame.'); return this.hitResults.get(source)!.slice(); }
  getHitTestResultsForTransientInput(source: XRTransientInputHitTestSource) { this._assertActive(); if (!this.transientResults.has(source)) invalidState('Transient source was not active for this frame.'); return this.transientResults.get(source)!.slice(); }
}
// Share allocation branding while retaining the public prototype's own realm.
Object.setPrototypeOf(XRFrame.prototype, Object.prototype);

/** Every exposed space and input identity is owned by exactly one session. */
export class XRInputSource {
  private readonly handValue: XRHand | null;
  private readonly targetSpace: XRSpace;
  private readonly grip: XRSpace | null;
  private readonly handednessValue: string;
  private readonly targetRayModeValue: string;
  private readonly profilesValue: readonly string[];
  private readonly rawProfiles: readonly string[];
  private readonly hasGamepad: boolean;
  private readonly gamepadState: SourceGamepad | null;
  private targetWorld: mat4 | null = null;
  private gripWorld: mat4 | null = null;
  constructor(private session: XRSession, private raw: DeviceInput, index: number) {
    const active = () => Array.from(session.inputSources).includes(this);
    this.handValue = session.enabledFeatures.includes('hand-tracking') ? new XRHand(session, index, active) : null;
    this.handednessValue = raw.handedness;
    this.targetRayModeValue = raw.targetRayMode;
    this.rawProfiles = Object.freeze([...raw.profiles]);
    this.profilesValue = this.handValue ? Object.freeze(['generic-hand-select']) : this.rawProfiles;
    this.hasGamepad = raw.gamepad !== null;
    this.gamepadState = !this.handValue && this.targetRayModeValue !== 'screen' && this.hasGamepad ? new SourceGamepad(this.targetRayModeValue === 'tracked-pointer' ? 'xr-standard' : '') : null;
    const provider = (type: string) => () => active() ? (type === 'grip' ? this.gripWorld : this.targetWorld) : null;
    this.targetSpace = new XRSpace(session, provider('target-ray'));
    this.grip = ['gaze', 'screen'].includes(this.targetRayModeValue) ? null : new XRSpace(session, provider('grip'));
  }
  _matches(raw: DeviceInput) {
    const profiles = raw.profiles;
    return this.handednessValue === raw.handedness && this.targetRayModeValue === raw.targetRayMode &&
      this.hasGamepad === (raw.gamepad !== null) && this.rawProfiles.length === profiles.length &&
      this.rawProfiles.every((profile, index) => profile === profiles[index]);
  }
  _retire() { this.gamepadState?.retire(); }
  _updatePose() {
    if (this.gamepadState && this.raw.gamepad) this.gamepadState.sample(this.raw.gamepad);
    const world = new XRReferenceSpace(this.session, 'local-floor', () => mat4.create()); world._update();
    const target = this.session._device.getInputPose(this.raw, world, 'target-ray');
    const grip = this.session._device.getInputPose(this.raw, world, 'grip');
    this.targetWorld = target ? mat4.clone(target.transform.matrix) : null;
    this.gripWorld = grip ? mat4.clone(grip.transform.matrix) : null;
  }
  get hand() { return this.handValue; }
  get targetRaySpace() { return this.targetSpace; }
  get handedness() { return this.handednessValue; }
  get targetRayMode() { return this.targetRayModeValue; }
  get gripSpace() { return this.grip; }
  get profiles() { return this.profilesValue; }
  get gamepad() { return this.gamepadState?.value ?? null; }
  get skipRendering() { return false; }
}
