import type { DeviceConfig, DeviceSize, SessionMode, EmulatedGamepad } from '../types/contracts';
import type { PolyfillGlobal, BaseLayer, RenderState, Viewport } from '../types/polyfill';
import {XRSpace} from './api/geometry';
import type XRHitTestSource from './api/XRHitTestSource';
import { dispatchCustomEvent } from '../types/contracts';
import {DeviceAdapter as XRDevice, ControllerInput as GamepadXRInputSource, type DeviceInput as XRInputSource} from './device-adapter';
import XRTransientInputHitTestSource from './api/XRTransientInputHitTestSource';
import {XRSpace as OwnedSpace, XRRigidTransform, XRPose} from './api/geometry';
import {
  vec3,
  quat,
  mat4
} from 'gl-matrix';
import ARScene from './ARScene';

const DEFAULT_MODES: SessionMode[] = ['inline'];

// @TODO: This value should shared with panel.js?
const DEFAULT_HEADSET_POSITION = [0, 1.6, 0];

// 10000 is for AR Scene
const DIV_Z_INDEX = '9999';
const DOM_OVERLAY_Z_INDEX = '10001';

// For AR
const DEFAULT_RESOLUTION = {width: 1024, height: 2048};
const DEFAULT_DEVICE_SIZE = {width: 0.05, height: 0.1, depth: 0.005};

// @TODO: Duplicated with content-scripts.js. Move to somewhere common place?

export default class EmulatedXRDevice extends XRDevice {
  sessions: Map<number, Session>;
  modes: SessionMode[];
  features: string[];
  position: vec3;
  quaternion: quat;
  scale: vec3;
  gamepads: EmulatedGamepad[];
  gamepadInputSources: GamepadXRInputSource[];
  stereoEffectEnabled: boolean;
  div: HTMLDivElement;
  originalCanvasParams: {parentElement: HTMLElement | null; width: number; height: number};
  domOverlayRoot: Element | null;
  handheld: boolean;
  emulationMode: SessionMode;
  resolution: {width: number; height: number};
  deviceSize: DeviceSize;
  arScene: ARScene | null;
  touched: boolean;
  isPointerAndTabledCloseEnough: boolean;
  hitTestSources: XRHitTestSource[];
  hitTestResults: Map<XRHitTestSource, mat4[]>;
  hitTestSourcesForTransientInput: XRTransientInputHitTestSource[];
  hitTestResultsForTransientInput: Map<XRTransientInputHitTestSource, mat4[]>;
  originalOverlayZIndex: string | undefined = undefined;
  matrix: mat4;
  projectionMatrix: mat4;
  leftProjectionMatrix: mat4;
  rightProjectionMatrix: mat4;
  viewMatrix: mat4;
  leftViewMatrix: mat4;
  rightViewMatrix: mat4;

  // @TODO: write config parameter comment

  constructor(global: PolyfillGlobal, config: DeviceConfig = {}) {
    super(global);

    this.sessions = new Map();

    this.modes = config.modes || DEFAULT_MODES;
    this.features = config.features || [];

    // headset
    this.position = vec3.copy(vec3.create(), DEFAULT_HEADSET_POSITION);
    this.quaternion = quat.create();
    this.scale = vec3.fromValues(1, 1, 1);
    this.matrix = mat4.create();
    this.projectionMatrix = mat4.create();
    this.leftProjectionMatrix = mat4.create();
    this.rightProjectionMatrix = mat4.create();
    this.viewMatrix = mat4.create();
    this.leftViewMatrix = mat4.create();
    this.rightViewMatrix = mat4.create();

    // controllers
    this.gamepads = [];
    this.gamepadInputSources = [];

    // other configurations
    this.stereoEffectEnabled = config.stereoEffect !== undefined ? config.stereoEffect : true;

    // @TODO: Edit this comment
    // For case where baseLayer's canvas isn't in document.body

    this.div = document.createElement('div');
    this.div.style.position = 'absolute';
    this.div.style.width = '100%';
    this.div.style.height = '100%';
    this.div.style.top = '0';
    this.div.style.left = '0';
    this.div.style.zIndex = DIV_Z_INDEX; // To override window overall
    this.originalCanvasParams = {
      parentElement: null,
      width: 0,
      height: 0
    };

    // For DOM overlay API

    this.domOverlayRoot = null;

    // For AR

    this.handheld = config.formFactor === 'handheld';
    this.emulationMode = config.emulationMode || (this.handheld ? 'immersive-ar' : 'immersive-vr');
    this.resolution = config.resolution !== undefined ? config.resolution : DEFAULT_RESOLUTION;
    this.deviceSize = config.size !== undefined ? config.size : DEFAULT_DEVICE_SIZE;
    this.arScene = null;
    this.touched = false;
    this.isPointerAndTabledCloseEnough = false; // UGH... @TODO: Rename

    this.hitTestSources = [];
    this.hitTestResults = new Map();

    this.hitTestSourcesForTransientInput = [];
    this.hitTestResultsForTransientInput = new Map();

    //
    this._initializeControllers(config);
    this._setupEventListeners();
  }

  onBaseLayerSet(sessionId: number, layer: BaseLayer) {
    const session = this.sessions.get(sessionId)!;

    // Remove old canvas first
    if (session.immersive && session.baseLayer) {
      this._removeBaseLayerCanvasFromDiv(sessionId);
    }

    session.baseLayer = layer;
    if (session.immersive && session.baseLayer) {
      this._appendBaseLayerCanvasToDiv(sessionId);
      if (session.ar) {
        const canvas = session.baseLayer!.context.canvas as HTMLCanvasElement;
        canvas.width = this.handheld ? this.resolution.width : this.arScene!.renderer.domElement.width;
        canvas.height = this.handheld ? this.resolution.height : this.arScene!.renderer.domElement.height;
        this.arScene!.setCanvas(canvas);
        if (canvas.parentElement) {
          // Not sure why but this is necessary for Firefox.
          // Otherwise, the canvas won't be rendered in AR scene.
          // @TODO: Figure out the root issue and resolve.
          canvas.parentElement.removeChild(canvas);
        }
      }
    }
  }

  isSessionSupported(mode: SessionMode) {
    return this.modes.includes(mode) && (mode === 'inline' || mode === this.emulationMode);
  }

  isFeatureSupported(featureDescriptor: string, mode: SessionMode = this.emulationMode) {
    if (featureDescriptor === 'viewer') return true;
    if (featureDescriptor === 'local' || featureDescriptor === 'local-floor') return mode !== 'inline';
    if (!this.features.includes(featureDescriptor)) return false;
    if (featureDescriptor === 'layers') return mode !== 'inline' && typeof WebGL2RenderingContext !== 'undefined';
    if (featureDescriptor === 'hand-tracking') return !this.handheld && mode !== 'inline';
    return mode === 'immersive-ar' && ['hit-test', 'anchors', 'depth-sensing', 'light-estimation'].includes(featureDescriptor);
  }

  async requestSession(mode: SessionMode, enabledFeatures: Set<string>) {
    if(!this.isSessionSupported(mode)) {
      throw new DOMException(`The selected emulation mode does not support ${mode}.`, 'NotSupportedError');
    }
    const immersive = mode === 'immersive-vr' || mode === 'immersive-ar';
    const session = new Session(mode, enabledFeatures);
    this.sessions.set(session.id, session);
    if (immersive) {
      this.touched = false;
      this.isPointerAndTabledCloseEnough = false;
      for (const input of this.gamepadInputSources) {
        input.active = !this.handheld;
        input.primaryActionPressed = false;
        input.primarySqueezeActionPressed = false;
      }
      for (const gamepad of this.gamepads) for (const button of gamepad.buttons) {
        button.pressed = false; button.value = 0;
      }
    }
    if (mode === 'immersive-ar') {
      if (!this.arScene) {
        this.arScene = new ARScene(this.deviceSize, this.handheld);
        this._requestVirtualRoomAsset();
        this.arScene!.onTouch = position => {
          this.touched = true;
          for (let i = 0; i < 3; i++) {
            this.gamepads[0].pose.position[i] = position[i];
          }
          this.arScene!.updatePointerTransform(this.gamepads[0].pose.position, this.gamepads[0].pose.orientation);
          this._notifyInputPoseUpdate(0);
        };
        this.arScene!.onRelease = () => {
          this.touched = false;
        };
        this.arScene!.onCameraPoseUpdate = (positionArray, quaternionArray) => {
          this._updatePose(positionArray, quaternionArray);
          this.arScene!.updateCameraTransform(positionArray, quaternionArray);
          this._notifyPoseUpdate();
        };
        this.arScene!.onTabletPoseUpdate = (positionArray, quaternionArray) => {
          this._updateInputPose(positionArray, quaternionArray, 1);
          this.arScene!.updateTabletTransform(positionArray, quaternionArray);
          this._notifyInputPoseUpdate(1);
        };
      }
      this.arScene.updateCameraTransform(this.position, this.quaternion);
      if (this.handheld) {
        this.arScene.updateTabletTransform(this.gamepads[1].pose.position, this.gamepads[1].pose.orientation);
      }
      this.arScene!.inject(this.div);
    }
    if (immersive) {
      this.dispatchEvent('@@webxr-polyfill/vr-present-start', session.id);
      this._notifyEnterImmersive();
    }
    return Promise.resolve(session.id);
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    return this.global.requestAnimationFrame(callback);
  }

  cancelAnimationFrame(handle: number) {
    this.global.cancelAnimationFrame(handle);
  }

  onFrameStart(sessionId: number, renderState: RenderState) {
    const session = this.sessions.get(sessionId)!;
    // guaranteed by the caller that session.baseLayer is not null
    const context = session.baseLayer!.context;
    const canvas = context.canvas as HTMLCanvasElement;
    if (session.ar && !this.handheld && this.arScene) {
      // Match the MR room's physical drawing buffer before calculating views or
      // running application rendering. Only resize when needed: resizing clears GL.
      const display = this.arScene.renderer.domElement;
      if (canvas.width !== display.width || canvas.height !== display.height) {
        canvas.width = display.width;
        canvas.height = display.height;
        // Three.js texture storage is immutable; replace it for the new size.
        this.arScene.setCanvas(canvas);
      }
    }
    const near = renderState.depthNear;
    const far = renderState.depthFar;
    const width = canvas.width;
    const height = canvas.height;

    // If session is not an inline session, XRWebGLLayer's composition disabled boolean
    // should be false and then framebuffer should be marked as opaque.
    // The buffers attached to an opaque framebuffer must be cleared prior to the
    // processing of each XR animation frame.
    if (session.immersive) {
      const framebuffer = context.getParameter(context.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const scissor = context.isEnabled(context.SCISSOR_TEST);
      const mask = context.getParameter(context.COLOR_WRITEMASK) as boolean[];
      const depthMask = context.getParameter(context.DEPTH_WRITEMASK) as boolean;
      const stencilMask = context.getParameter(context.STENCIL_WRITEMASK) as number;
      const backStencilMask = context.getParameter(context.STENCIL_BACK_WRITEMASK) as number;
      const currentClearColor = context.getParameter(context.COLOR_CLEAR_VALUE) as Float32Array;
      const currentClearDepth = context.getParameter(context.DEPTH_CLEAR_VALUE) as number;
      const currentClearStencil = context.getParameter(context.STENCIL_CLEAR_VALUE) as number;
      // Clear the emulated compositor output without altering application GL state.
      const target = context instanceof WebGL2RenderingContext ? context.DRAW_FRAMEBUFFER : context.FRAMEBUFFER;
      context.bindFramebuffer(target, null); context.disable(context.SCISSOR_TEST);
      context.colorMask(true, true, true, true); context.depthMask(true); context.stencilMask(0xffffffff);
      context.clearColor(0, 0, 0, 0); context.clearDepth(1); context.clearStencil(0);
      context.clear(context.DEPTH_BUFFER_BIT | context.COLOR_BUFFER_BIT | context.STENCIL_BUFFER_BIT);
      context.clearColor(currentClearColor[0], currentClearColor[1], currentClearColor[2], currentClearColor[3]);
      context.clearDepth(currentClearDepth); context.clearStencil(currentClearStencil);
      context.colorMask(mask[0], mask[1], mask[2], mask[3]); context.depthMask(depthMask);
      context.stencilMaskSeparate(context.FRONT, stencilMask); context.stencilMaskSeparate(context.BACK, backStencilMask);
      if (scissor) context.enable(context.SCISSOR_TEST);
      context.bindFramebuffer(target, framebuffer);
    }

    if (session.immersive && !this.handheld) {
      // @TODO: proper FOV
      const aspect = width * (this.stereoEffectEnabled ? 0.5 : 1.0) / height;
      mat4.perspective(this.leftProjectionMatrix, Math.PI / 2, aspect, near, far);
      mat4.perspective(this.rightProjectionMatrix, Math.PI / 2, aspect, near, far);
    } else if (session.ar) {
      // @TODO: proper FOV
      const aspect = this.deviceSize.width / this.deviceSize.height;
      mat4.perspective(this.projectionMatrix, Math.PI / 2, aspect, near, far);
    } else {
      const aspect = width / height;
      mat4.perspective(this.projectionMatrix, renderState.inlineVerticalFieldOfView, aspect, near, far);
    }
    if (session.ar && this.handheld) {
      mat4.fromRotationTranslationScale(this.matrix, this.gamepads[1].pose.orientation, this.gamepads[1].pose.position, this.scale);
    } else {
      mat4.fromRotationTranslationScale(this.matrix, this.quaternion, this.position, this.scale);
    }
    mat4.invert(this.viewMatrix, this.matrix);

    // Move matrices left/right a bit and then calculate left/rightViewMatrix
    // @TODO: proper left/right distance
    mat4.invert(this.leftViewMatrix, translateOnX(mat4.copy(this.leftViewMatrix, this.matrix), -0.02));
    mat4.invert(this.rightViewMatrix, translateOnX(mat4.copy(this.rightViewMatrix, this.matrix), 0.02));

    if (session.ar && this.arScene) this.arScene.stereoEffectEnabled = this.stereoEffectEnabled;
    if (session.immersive) {
      if (session.ar && this.handheld) {
        if (this.touched && this._isPointerCloseEnoughToTablet()) {
          if (!this.isPointerAndTabledCloseEnough) {
            this._updateInputButtonPressed(true, 0, 0);
            this.isPointerAndTabledCloseEnough = true;
            this.arScene!.touched();
          }
          const coordinates = this._getTouchCoordinates();
          this._updateInputAxes(0, coordinates[0], -coordinates[1]);
        } else {
          if (this.isPointerAndTabledCloseEnough) {
            this._updateInputButtonPressed(false, 0, 0);
            this.isPointerAndTabledCloseEnough = false;
            this.arScene!.released();
          }
          this._updateInputAxes(0, 0, 0);
        }
      }

      for (let i = 0; i < this.gamepads.length; ++i) {
        const gamepad = this.gamepads[i];
        const inputSourceImpl = this.gamepadInputSources[i];
        inputSourceImpl.updateFromGamepad(gamepad);
        if (this.handheld && i === 0) {
          inputSourceImpl.handedness = 'none';
          inputSourceImpl.targetRayMode = 'screen';
        }
        if (inputSourceImpl.primaryButtonIndex !== -1) {
          const primaryActionPressed = gamepad.buttons[inputSourceImpl.primaryButtonIndex].pressed;
          if (primaryActionPressed && !inputSourceImpl.primaryActionPressed) {
            if (this.handheld) inputSourceImpl.active = true;
            this.dispatchEvent('@@webxr-polyfill/input-select-start', { sessionId: session.id, inputSource: inputSourceImpl.inputSource });
          } else if (!primaryActionPressed && inputSourceImpl.primaryActionPressed) {
            if (this.handheld) {
              inputSourceImpl.active = false;
            }
            this.dispatchEvent('@@webxr-polyfill/input-select-end', { sessionId: session.id, inputSource: inputSourceImpl.inputSource });
          }
          // Action state is committed in onFrameEnd().
        }
        if (inputSourceImpl.primarySqueezeButtonIndex !== -1) {
          const primarySqueezeActionPressed = gamepad.buttons[inputSourceImpl.primarySqueezeButtonIndex].pressed;
          if (primarySqueezeActionPressed && !inputSourceImpl.primarySqueezeActionPressed) {
            this.dispatchEvent('@@webxr-polyfill/input-squeeze-start', { sessionId: session.id, inputSource: inputSourceImpl.inputSource });
          } else if (!primarySqueezeActionPressed && inputSourceImpl.primarySqueezeActionPressed) {
            this.dispatchEvent('@@webxr-polyfill/input-squeeze-end', { sessionId: session.id, inputSource: inputSourceImpl.inputSource });
          }
          inputSourceImpl.primarySqueezeActionPressed = primarySqueezeActionPressed;
        }
      }

    }
  }

  computeHitTests(sessionId: number) {
    if (!this.sessions.get(sessionId)?.ar) return;
    this._hitTest(sessionId, this.hitTestSources, this.hitTestResults);
    if (this.handheld) this._hitTest(sessionId, this.hitTestSourcesForTransientInput, this.hitTestResultsForTransientInput);
  }

  onFrameEnd(sessionId: number) {
    // Save action state after dispatch so the next device frame detects edges.
    const session = this.sessions.get(sessionId)!;
    if (session.immersive) {
      for (let i = 0; i < this.gamepads.length; ++i) {
        const gamepad = this.gamepads[i];
        const inputSourceImpl = this.gamepadInputSources[i];
        if (inputSourceImpl.primaryButtonIndex !== -1) {
          const primaryActionPressed = gamepad.buttons[inputSourceImpl.primaryButtonIndex].pressed;
          inputSourceImpl.primaryActionPressed = primaryActionPressed; 
        }
      }
    }
  }

  async requestFrameOfReferenceTransform(type: string, options: unknown) {
    // @TODO: Add note
    const matrix = mat4.create();
    switch (type) {
      case 'viewer':
      case 'local':
        matrix[13] = -DEFAULT_HEADSET_POSITION[1];
        return matrix;

      case 'local-floor':
        return matrix;

      case 'bounded-floor':
      case 'unbound':
      default:
        // @TODO: Throw an error?
        return matrix;
    }
  }

  endSession(sessionId: number) {
    const session = this.sessions.get(sessionId)!;
    if (session.ended) return;
    session.ended = true;
    if (session.immersive) {
      if (session.baseLayer) this._removeBaseLayerCanvasFromDiv(sessionId);
      this.domOverlayRoot = null;
      if (session.ar && this.arScene) {
        this.arScene.eject();
        this.arScene.releaseCanvas();
      }
      this.touched = false;
      this.isPointerAndTabledCloseEnough = false;
      for (const input of this.gamepadInputSources) input.active = false;
      for (const source of [...this.hitTestSources, ...this.hitTestSourcesForTransientInput]) if (source._session._id === sessionId) source._deactivate();
      this.hitTestSources = this.hitTestSources.filter(source => source._session._id !== sessionId);
      this.hitTestSourcesForTransientInput = this.hitTestSourcesForTransientInput.filter(source => source._session._id !== sessionId);
      this.hitTestResults.clear();
      this.hitTestResultsForTransientInput.clear();
      this.dispatchEvent('@@webxr-polyfill/vr-present-end', sessionId);
      this._notifyLeaveImmersive();
    }
    this.sessions.delete(sessionId);
  }

  doesSessionSupportReferenceSpace(sessionId: number, type: string) {
    const session = this.sessions.get(sessionId)!;
    if (session.ended) {
      return false;
    }
    return session.enabledFeatures.has(type);
  }

  getViewport(sessionId: number, eye: string, layer: BaseLayer, target: Viewport) {
    const session = this.sessions.get(sessionId)!;
    const canvas = session.baseLayer!.context.canvas as HTMLCanvasElement;
    const width = canvas.width;
    const height = canvas.height;
    if (session.ar && this.handheld) {
      // Handheld AR uses a single monoscopic view.
      target.x = 0;
      target.y = 0;
      target.width = width;
      target.height = height;
    } else {
      if (eye === 'none') {
        target.x = 0;
        target.width = width;
      } else if (this.stereoEffectEnabled) {
        target.x = eye === 'left' ? 0 : width / 2;
        target.width = width / 2;
      } else {
        target.x = 0;
        target.width = eye === 'left' ? width : 0;
      }
      target.y = 0;
      target.height = height;
    }
    return true;
  }

  getProjectionMatrix(eye: string) {
    return eye === 'none' ? this.projectionMatrix :
           eye === 'left' ? this.leftProjectionMatrix : this.rightProjectionMatrix;
  }

  getBasePoseMatrix() {
    return this.matrix;
  }

  getBaseViewMatrix(eye: string) {
    if (eye === 'none' || !this.stereoEffectEnabled) { return this.viewMatrix; }
    return eye === 'left' ? this.leftViewMatrix : this.rightViewMatrix;
  }

  getInputSources() {
    const inputSources = [];
    for (const inputSourceImpl of this.gamepadInputSources) {
      if (inputSourceImpl.active) {
        inputSources.push(inputSourceImpl.inputSource);
      }
    }
    return inputSources;
  }

  getInputPose(inputSource: XRInputSource, coordinateSystem: XRSpace, poseType: string) {
    const index = this.gamepadInputSources.findIndex(input => input.inputSource === inputSource);
    if (index < 0 || !this.gamepadInputSources[index].active) return null;
    const gamepad = this.gamepads[index];
    let matrix = mat4.fromRotationTranslation(mat4.create(), gamepad.pose.orientation, gamepad.pose.position);
    if (this.handheld) {
      if (poseType === 'grip') return null;
      const x = gamepad.axes[0] * this.deviceSize.width / this.deviceSize.height;
      const y = -gamepad.axes[1];
      const direction = vec3.normalize(vec3.create(), [x, y, -1]);
      const rotation = quat.rotationTo(quat.create(), [0, 0, -1], direction);
      const ray = mat4.fromRotationTranslation(mat4.create(), rotation, [x * 0.1, y * 0.1, -0.1]);
      matrix = mat4.multiply(mat4.create(), this.matrix, ray);
    }
    const inverse = coordinateSystem._inverseBaseMatrix;
    if (!inverse) return null;
    return new XRPose(XRRigidTransform._fromMatrix(mat4.multiply(mat4.create(), inverse, matrix)));
  }

  onWindowResize() {
    // @TODO: implement
  }

  // DOM Overlay API

  setDomOverlayRoot(root: Element) {
    this.domOverlayRoot = root;
  }

  // AR Hitting test

  addHitTestSource(source: XRHitTestSource) {
    this.hitTestSources.push(source);
  }

  getHitTestResults(source: XRHitTestSource) {
    return this.hitTestResults.get(source) || [];
  }

  addHitTestSourceForTransientInput(source: XRTransientInputHitTestSource) {
    this.hitTestSourcesForTransientInput.push(source);
  }

  getHitTestResultsForTransientInput(source: XRTransientInputHitTestSource) {
    return this.hitTestResultsForTransientInput.get(source) || [];
  }

  // Private methods

  // If session is immersive mode, resize the canvas size to full window size.
  // To do that, changing canvas size and moving the canvas to
  // the special div. They are restored when exiting immersive mode.
  // @TODO: Simplify the method names

  _appendBaseLayerCanvasToDiv(sessionId: number) {
    const session = this.sessions.get(sessionId)!;
    const canvas = session.baseLayer!.context.canvas as HTMLCanvasElement;

    this.originalCanvasParams.width = canvas.width;
    this.originalCanvasParams.height = canvas.height;

    document.body.appendChild(this.div);

    // If canvas is OffscreenCanvas we don't further touch so far.
    if (!(canvas instanceof HTMLCanvasElement)) { return; }

    this.originalCanvasParams.parentElement = canvas.parentElement;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    this.div.appendChild(canvas);

    // DOM overlay API
    // @TODO: Is this the best place to handle?
    // @TODO: What if dom element is appened/removed while in immersive mode?
    //        Should we observe?
    if (this.domOverlayRoot) {
      const el = this.domOverlayRoot as HTMLElement;
      this.originalOverlayZIndex = el.style.zIndex;
      if (this.domOverlayRoot.contains(this.div)) {
        this.div.style.zIndex = '';
      } else {
        el.style.zIndex = DOM_OVERLAY_Z_INDEX;
      }
    }
  }

  _removeBaseLayerCanvasFromDiv(sessionId: number) {
    const session = this.sessions.get(sessionId)!;
    const canvas = session.baseLayer!.context.canvas as HTMLCanvasElement;

    canvas.width = this.originalCanvasParams.width;
    canvas.height = this.originalCanvasParams.height;

    // There may be a case where an application operates DOM elements
    // in immersive mode. In such case, we don't restore DOM elements
    // hierarchies so far.
    if (this.div.parentElement === document.body) {
      document.body.removeChild(this.div);
    }
    if (canvas.parentElement === this.div) {
      this.div.removeChild(canvas);
    }

    // If canvas is OffscreenCanvas we don't touch so far.
    if (!(canvas instanceof HTMLCanvasElement)) { return; }

    if (this.originalCanvasParams.parentElement) {
      this.originalCanvasParams.parentElement.appendChild(canvas);
    }
    this.originalCanvasParams.parentElement = null;

    // DOM overlay API
    // @TODO: Is this the best place to handle?
    if (this.domOverlayRoot) {
      const el = this.domOverlayRoot as HTMLElement;
      el.style.zIndex = this.originalOverlayZIndex!;
      this.originalOverlayZIndex = undefined;
      this.div.style.zIndex = DIV_Z_INDEX;
    }
  }

  // For AR. Check if right controller(pointer) is touched with left controller(tablet)

  // UGH... @TODO: Rename
  _isPointerCloseEnoughToTablet() {
    // @TODO: Optimize if possible
    const pose = this.gamepads[0].pose;
    const matrix = mat4.fromRotationTranslation(mat4.create(), pose.orientation, pose.position);
    mat4.multiply(matrix, this.viewMatrix, matrix);
    const dx = matrix[12] / (this.deviceSize.width * 0.5);
    const dy = matrix[13] / (this.deviceSize.height * 0.5);
    const dz = matrix[14];
    return dx <= 1.0 && dx >= -1.0 &&
           dy <= 1.0 && dy >= -1.0 &&
           dz <= 0.01 && dz >= 0.0;
  }

  _getTouchCoordinates() {
    // @TODO: Optimize if possible
    const pose = this.gamepads[0].pose;
    const matrix = mat4.fromRotationTranslation(mat4.create(), pose.orientation, pose.position);
    mat4.multiply(matrix, this.viewMatrix, matrix);
    const dx = matrix[12] / (this.deviceSize.width * 0.5);
    const dy = matrix[13] / (this.deviceSize.height * 0.5);
    return [dx, dy];
  }

  // Hit Test

  _hitTest<T extends XRHitTestSource | XRTransientInputHitTestSource>(sessionId: number, hitTestSources: T[], hitTestResults: Map<T, mat4[]>) {
    // Remove inactive sources first
    let activeHitTestSourceNum = 0;
    for (let i = 0; i < hitTestSources.length; i++) {
      const source = hitTestSources[i];
      if (source._active) {
        hitTestSources[activeHitTestSourceNum++] = source;
      } else { hitTestResults.delete(source); }
    }
    hitTestSources.length = activeHitTestSourceNum;

    // Do hit test next
    hitTestResults.clear();
    for (const source of hitTestSources as (XRHitTestSource | XRTransientInputHitTestSource)[]) {
      if (sessionId !== source._session._id) {
        continue;
      }

      // Gets base matrix depending on hit test source type
      let baseMatrix;
      if (source instanceof XRTransientInputHitTestSource) {
        if (!this.gamepadInputSources[0].active) {
          continue;
        }
        if (!this.gamepadInputSources[0].inputSource.profiles.includes(source._profile)) {
          continue;
        }
        const world = new OwnedSpace(source._session, () => mat4.create()); world._update();
        baseMatrix = this.getInputPose(this.gamepadInputSources[0].inputSource, world, 'target-ray')?.transform.matrix;
        if (!baseMatrix) continue;
      } else {
        baseMatrix = source._space._update();
        if (!baseMatrix) {
          continue;
        }
      }

      // Calculates origin and direction used for hit test in AR scene
      const offsetRay = source._offsetRay;
      const origin = vec3.set(vec3.create(), offsetRay.origin.x, offsetRay.origin.y, offsetRay.origin.z);
      const direction = vec3.set(vec3.create(), offsetRay.direction.x, offsetRay.direction.y, offsetRay.direction.z);
      vec3.transformMat4(origin, origin, baseMatrix);
      vec3.transformQuat(direction, direction, mat4.getRotation(quat.create(), baseMatrix));

      // Do hit test in AR scene and stores the result matrices
      const arHitTestResults = this.arScene!.getHitTestResults(origin, direction);
      const results = [];
      for (const result of arHitTestResults) {
        const normal = result.face!.normal.clone().transformDirection(result.object.matrixWorld);
        const rotation = quat.rotationTo(quat.create(), [0, 1, 0], [normal.x, normal.y, normal.z]);
        const matrix = mat4.fromQuat(mat4.create(), rotation);
        matrix[12] = result.point.x;
        matrix[13] = result.point.y;
        matrix[14] = result.point.z;
        results.push(matrix);
      }
      hitTestResults.set(source as T, results);
    }
  }

  // Notify the update to panel

  _notifyPoseUpdate() {
    dispatchCustomEvent('device-pose', {
      position: this.position,
      quaternion: this.quaternion
    });
  }

  // controllerIndex: 0 => Right, 1 => Left
  _notifyInputPoseUpdate(controllerIndex: number) {
    const pose = this.gamepads[controllerIndex].pose;
    const objectName = controllerIndex === 0 ? 'rightController' : 'leftController';
    dispatchCustomEvent('device-input-pose', {
      position: pose.position,
      quaternion: pose.orientation,
      objectName: objectName
    });
  }

  _notifyEnterImmersive() {
    dispatchCustomEvent('device-enter-immersive', {});
  }

  _notifyLeaveImmersive() {
    dispatchCustomEvent('device-leave-immersive', {});
  }

  // Send request to content-scripts

  _requestVirtualRoomAsset() {
    dispatchCustomEvent('webxr-virtual-room-request', {});
  }

  // Device status update methods invoked from event listeners.

  _updateStereoEffect(enabled: boolean) {
    this.stereoEffectEnabled = enabled;
  }

  _updatePose(positionArray: ArrayLike<number>, quaternionArray: ArrayLike<number>) {
    for (let i = 0; i < 3; i++) {
      this.position[i] = positionArray[i];
    }
    for (let i = 0; i < 4; i++) {
      this.quaternion[i] = quaternionArray[i];
    }
  }

  _updateInputPose(positionArray: ArrayLike<number>, quaternionArray: ArrayLike<number>, index: number) {
    if (index >= this.gamepads.length) { return; }
    const gamepad = this.gamepads[index];
    const pose = gamepad.pose;
    for (let i = 0; i < 3; i++) {
      pose.position[i] = positionArray[i];
    }
    for (let i = 0; i < 4; i++) {
      pose.orientation[i] = quaternionArray[i];
    }
  }

  _updateInputButtonPressed(pressed: boolean, controllerIndex: number, buttonIndex: number) {
    if (controllerIndex >= this.gamepads.length) { return; }
    const gamepad = this.gamepads[controllerIndex];
    if (buttonIndex >= gamepad.buttons.length) { return; }
    gamepad.buttons[buttonIndex].pressed = pressed;
    gamepad.buttons[buttonIndex].value = pressed ? 1.0 : 0.0;
  }

  _updateInputAxes(controllerIndex: number, x: number, y: number) {
    if (controllerIndex >= this.gamepads.length) { return; }
    const gamepad = this.gamepads[controllerIndex];
    gamepad.axes[this.handheld ? 0 : 2] = x;
    gamepad.axes[this.handheld ? 1 : 3] = y;
  }

  _initializeControllers(config: DeviceConfig) {
    const hasController = config.controllers !== undefined;
    const controllerNum = hasController ? config.controllers!.length : 0;
    this.gamepads.length = 0;
    this.gamepadInputSources.length = 0;
    for (let i = 0; i < controllerNum; i++) {
      const controller = config.controllers![i];
      const id = controller.id || '';
      const hasPosition = controller.hasPosition || false;
      const buttonNum = controller.buttonNum || 0;
      const primaryButtonIndex = controller.primaryButtonIndex !== undefined ? controller.primaryButtonIndex : 0;
      const primarySqueezeButtonIndex = controller.primarySqueezeButtonIndex !== undefined ? controller.primarySqueezeButtonIndex : -1;
      const gamepad = createGamepad(id, i === 0 ? 'right' : 'left', buttonNum, hasPosition);
      gamepad.pose.position = this.handheld ? [0, 1.6, i === 0 ? -0.15 : -0.2] : [i === 0 ? 0.5 : -0.5, 1.5, -1];
      this.gamepads.push(gamepad);
      // The virtual phone pointer becomes a screen input when updated each frame.
      const imputSourceImpl = new GamepadXRInputSource(primaryButtonIndex, primarySqueezeButtonIndex);
      imputSourceImpl.active = !this.handheld; // Override property for transient imput
      this.gamepadInputSources.push(imputSourceImpl);
    }
  }

  // Set up event listeners. Events are sent from panel via background.

  _setupEventListeners() {
    window.addEventListener('webxr-device', event => {
      const config = event.detail.deviceDefinition;

      // Finish presentation before replacing its views, canvas, and input sources.
      for (const session of this.sessions.values()) {
        if (session.immersive && !session.ended) this.endSession(session.id);
      }
      const wasHandheld = this.handheld;
      this.modes = config.modes || DEFAULT_MODES;
      this.features = config.features || [];
      this.handheld = config.formFactor === 'handheld';
      this.emulationMode = config.emulationMode || (this.handheld ? 'immersive-ar' : 'immersive-vr');
      this.resolution = config.resolution || DEFAULT_RESOLUTION;
      this.deviceSize = config.size || DEFAULT_DEVICE_SIZE;
      if (wasHandheld !== this.handheld && this.arScene) {
        this.arScene.dispose();
        this.arScene = null;
      }
      this._initializeControllers(config);
    });

    window.addEventListener('webxr-pose', event => {
      const positionArray = event.detail.position;
      const quaternionArray = event.detail.quaternion;
      this._updatePose(positionArray, quaternionArray);
      this.arScene?.updateCameraTransform(positionArray, quaternionArray);
    }, false);

    window.addEventListener('webxr-input-pose', event => {
      const positionArray = event.detail.position;
      const quaternionArray = event.detail.quaternion;
      const objectName = event.detail.objectName;

      if (this.handheld) {
        // In AR-mode, right controller corresponds to pointer and left controller corresponds to tablet
        switch (objectName) {
          case 'rightController':
            this._updateInputPose(positionArray, quaternionArray, 0);
            if (this.arScene) {
              this.arScene!.updatePointerTransform(positionArray, quaternionArray);
            }
            break;
          case 'leftController':
            this._updateInputPose(positionArray, quaternionArray, 1);
            if (this.arScene) {
              this.arScene!.updateTabletTransform(positionArray, quaternionArray);
            }
            break;
        }
      } else {
        switch (objectName) {
          case 'rightController':
          case 'leftController':
            this._updateInputPose(positionArray, quaternionArray,
              objectName === 'rightController' ? 0 : 1); // @TODO: remove magic number
            break;
        }
      }
    });

    window.addEventListener('webxr-input-button', event => {
      // The phone receives transient screen touches instead of controller buttons.
      if (this.handheld) {
        return;
      }

      const pressed = event.detail.pressed;
      const objectName = event.detail.objectName;
      const buttonIndex = event.detail.buttonIndex;

      switch (objectName) {
        case 'rightController':
        case 'leftController':
          this._updateInputButtonPressed(pressed,
            objectName === 'rightController' ? 0 : 1, // @TODO: remove magic number
            buttonIndex);
          break;
      }
    }, false);

    window.addEventListener('webxr-stereo-effect', event => {
      this._updateStereoEffect(event.detail.enabled);
    });

    window.addEventListener('webxr-virtual-room-response', event => {
      const virtualRoomAssetBuffer = event.detail.buffer;
      this.arScene?.loadVirtualRoomAsset(virtualRoomAssetBuffer);
    });
  }
};

// The upstream device hook allows a handheld AR session to expose one `none` eye.
let SESSION_ID = 0;

class Session {
  mode: SessionMode;
  immersive: boolean;
  vr: boolean;
  ar: boolean;
  id: number;
  baseLayer: BaseLayer | null;
  inlineVerticalFieldOfView: number;
  ended: boolean;
  enabledFeatures: Set<string>;
  constructor(mode: SessionMode, enabledFeatures: Set<string>) {
    this.mode = mode;
    this.immersive = mode == 'immersive-vr' || mode == 'immersive-ar';
    this.vr = mode === 'immersive-vr';
    this.ar = mode === 'immersive-ar';
    this.id = ++SESSION_ID;
    this.baseLayer = null;
    this.inlineVerticalFieldOfView = Math.PI * 0.5;
    this.ended = false;
    this.enabledFeatures = enabledFeatures;
  }
}

const createGamepad = (id: string, hand: 'right' | 'left', buttonNum: number, hasPosition: boolean): EmulatedGamepad => {
  const buttons = [];
  for (let i = 0; i < buttonNum; i++) {
    buttons.push({
      pressed: false,
      touched: false,
      value: 0.0
    });
  }
  return {
    id: id || '',
    pose: {
      hasPosition: hasPosition,
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1]
    },
    buttons: buttons,
    hand: hand,
    mapping: 'xr-standard',
    axes: [0, 0, 0, 0]
  };
};

const tmpVec3 = vec3.create();
const translateOnX = (matrix: mat4, distance: number) => {
  vec3.set(tmpVec3, distance, 0, 0);
  return mat4.translate(matrix, matrix, tmpVec3);
};
