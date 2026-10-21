import {mat4} from 'gl-matrix';
import type EmulatedXRDevice from '../EmulatedXRDevice';
import type {SessionMode} from '../../types/contracts';
import type {SessionOptions, HitTestOptions, TransientHitTestOptions} from '../../types/polyfill';
import type {DeviceInput, InputSignal} from '../device-adapter';
import {XRSpace, XRReferenceSpace, XRBoundedReferenceSpace, XRRigidTransform, XRPose, XRViewerPose, XRView, sessionObjects, frameObjects, invalidState, unsupported} from './geometry';
import {HALL_PLAY_AREA} from '../virtual-play-area';
import {XRCompositionLayer, XRProjectionLayer, XRWebGLLayer} from './layers';
import {XRAnchor, XRAnchorSet, XRHand, XRJointSpace, XRJointPose, XRLightProbe, XRLightEstimate, XRCPUDepthInformation} from './sensing';
import XRHitTestSource from './XRHitTestSource';
import XRTransientInputHitTestSource from './XRTransientInputHitTestSource';
import XRHitTestResult from './XRHitTestResult';
import XRTransientInputHitTestResult from './XRTransientInputHitTestResult';
import XRInputSourceArray from './XRInputSourceArray';
import type DOMOverlay from '../DOMOverlay';
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
const modes = ['inline', 'immersive-vr', 'immersive-ar'];
function validateMode(mode: string): asserts mode is SessionMode { if (!modes.includes(mode)) throw new TypeError('Invalid XRSessionMode.'); }

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
  async isSessionSupported(mode: SessionMode) { validateMode(mode); return (await this.devicePromise).isSessionSupported(mode); }
  async requestSession(mode: SessionMode, options: SessionOptions = {}) {
    validateMode(mode);
    const domOverlay = options.domOverlay;
    let overlayRoot: Element | undefined;
    if (domOverlay !== undefined && domOverlay !== null) {
      // WebIDL interface conversion uses the Element brand, not instanceof:
      // a same-origin iframe's Element has a different realm's prototype.
      overlayRoot = domOverlay.root;
      Element.prototype.hasAttribute.call(overlayRoot, '');
    }
    if (options.depthSensing) {
      const {usagePreference, dataFormatPreference} = options.depthSensing;
      if ([...usagePreference].some(value => !['cpu-optimized', 'gpu-optimized'].includes(value)) || [...dataFormatPreference].some(value => !['float32', 'unsigned-short', 'luminance-alpha'].includes(value))) throw new TypeError('Invalid depth sensing preference enum.');
    }
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
    if (!(space instanceof XRSpace)) throw new TypeError('Expected XRSpace.');
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
  updateRenderState(init: Partial<XRRenderState>) {
    this._assertLive();
    if (init.baseLayer !== undefined && init.layers !== undefined) unsupported('baseLayer and layers cannot both be supplied.');
    if (init.baseLayer && (!(init.baseLayer instanceof XRWebGLLayer) || init.baseLayer._session !== this)) invalidState('Layer belongs to a different session.');
    if (init.layers !== undefined && init.layers !== null) {
      if (!this.enabledFeatures.includes('layers') && (init.layers.length > 1 || init.layers.some(layer => !(layer instanceof XRProjectionLayer)))) unsupported('Only a single projection layer is supported without the layers feature.');
      if (new Set(init.layers).size !== init.layers.length) throw new TypeError('Duplicate composition layers.');
      for (const layer of init.layers) if (!(layer instanceof XRCompositionLayer) || layer._binding._session !== this || layer._destroyed) invalidState('Invalid composition layer.');
      if (init.layers.some(layer => layer._binding._context !== init.layers![0]._binding._context)) unsupported('All layers must share one WebGL context.');
    }
    if (init.inlineVerticalFieldOfView != null && this._mode !== 'inline') invalidState('Immersive sessions cannot set inlineVerticalFieldOfView.');
    const state = {...(this.pendingRenderState ?? this.renderState), ...init};
    if (init.baseLayer !== undefined) state.layers = null;
    if (init.layers !== undefined) state.baseLayer = null;
    if (state.inlineVerticalFieldOfView != null) state.inlineVerticalFieldOfView = Math.max(0.01, Math.min(3.13, state.inlineVerticalFieldOfView));
    if (![state.depthNear, state.depthFar].every(Number.isFinite)) throw new TypeError('Depth values must be finite.');
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
      this.activeRenderState = this.pendingRenderState; this.pendingRenderState = null;
      this.presentation = this.renderState.baseLayer ?? this.renderState.layers?.[0]?._binding._presentation ?? null;
      if (this.presentation && this.presentation !== previous) this._device.onBaseLayerSet(this._id, this.presentation);
    }
    if (!this.presentation || this.presentation.context.isContextLost()) return;
    this._viewer._update();
    for (const source of this._hitSources) if (source._space instanceof XRSpace) source._space._update();
    this._device.onFrameStart(this._id, {depthNear: this.renderState.depthNear, depthFar: this.renderState.depthFar, inlineVerticalFieldOfView: this.renderState.inlineVerticalFieldOfView ?? Math.PI / 2});
    this.rawSources = this._mode === 'inline' ? [] : this._device.getInputSources();
    const next: XRInputSource[] = this.rawSources.map(source => {
      if (!this.inputWrappers.has(source)) this.inputWrappers.set(source, new XRInputSource(this, source, this._device.getInputSources().indexOf(source)));
      return this.inputWrappers.get(source)!;
    });
    const added = next.filter(source => !this.sources.includes(source));
    const removed = this.sources.filter(source => !next.includes(source));
    // New sources precede their first action; disappearing transient sources remain
    // observable until select/selectend have been dispatched.
    this.sources = Object.freeze([...next, ...removed]);
    for (const source of next) source._updatePose();
    if (added.length) this._emit(new XRInputSourcesChangeEvent('inputsourceschange', {session: this, added, removed: []}));
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

export class XRFrame {
  _active = false;
  private hitResults = new Map<XRHitTestSource, XRHitTestResult[]>();
  private anchorSnapshot: XRAnchorSet;
  private environmentSnapshot: ReturnType<EnvironmentTracker['snapshot']>;
  private transientResults = new Map<XRTransientInputHitTestSource, XRTransientInputHitTestResult[]>();
  constructor(readonly session: XRSession, readonly predictedDisplayTime: number, readonly _animation: boolean) {
    frameObjects.add(this);
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
    this._assertActive(); const list = [...joints]; if (radii.length < list.length) throw new TypeError('Insufficient radii array.');
    for (const [index, joint] of list.entries()) { if (!(joint instanceof XRJointSpace)) throw new TypeError('Expected XRJointSpace.'); this.session._owns(joint); radii[index] = joint._radius; }
    return true;
  }
  fillPoses(spaces: Iterable<XRSpace>, baseSpace: XRSpace, transforms: Float32Array) {
    this._assertActive(); const list = [...spaces]; if (transforms.length < list.length * 16) throw new TypeError('Insufficient transform array.');
    let valid = true;
    for (const [index, space] of list.entries()) { const pose = this.getPose(space, baseSpace); if (pose) transforms.set(pose.transform.matrix, index * 16); else { valid = false; transforms.fill(NaN, index * 16, index * 16 + 16); } }
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

/** Every exposed space and input identity is owned by exactly one session. */
export class XRInputSource {
  readonly hand: XRHand | null;
  readonly targetRaySpace: XRSpace;
  private grip: XRSpace;
  private targetWorld: mat4 | null = null;
  private gripWorld: mat4 | null = null;
  constructor(private session: XRSession, private raw: DeviceInput, index: number) {
    this.hand = session.enabledFeatures.includes('hand-tracking') ? new XRHand(session, index) : null;
    const provider = (type: string) => () => Array.from(session.inputSources).includes(this) ? (type === 'grip' ? this.gripWorld : this.targetWorld) : null;
    this.targetRaySpace = new XRSpace(session, provider('target-ray')); this.grip = new XRSpace(session, provider('grip'));
  }
  _updatePose() {
    const world = new XRReferenceSpace(this.session, 'local-floor', () => mat4.create()); world._update();
    const target = this.session._device.getInputPose(this.raw, world, 'target-ray');
    const grip = this.session._device.getInputPose(this.raw, world, 'grip');
    this.targetWorld = target ? mat4.clone(target.transform.matrix) : null;
    this.gripWorld = grip ? mat4.clone(grip.transform.matrix) : null;
  }
  get handedness() { return this.raw.handedness; }
  get targetRayMode() { return this.raw.targetRayMode; }
  get gripSpace() { return this.targetRayMode === 'screen' ? null : this.grip; }
  get profiles() { return this.hand ? ['generic-hand-select'] : this.raw.targetRayMode === 'screen' ? ['generic-touchscreen'] : ['meta-quest-touch-plus', 'oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick']; }
  get gamepad() { return this.hand || this.targetRayMode === 'screen' ? null : this.raw.gamepad; }
}
