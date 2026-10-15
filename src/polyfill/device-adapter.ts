import type {EmulatedGamepad} from '../types/contracts';
import type {PolyfillGlobal} from '../types/polyfill';

export type XRGamepad = Omit<Gamepad, 'vibrationActuator'> & {vibrationActuator: null; hapticActuators: readonly GamepadHapticActuator[]};

export interface DeviceInput {
  readonly handedness: string;
  readonly targetRayMode: string;
  readonly profiles: readonly string[];
  readonly gamepad: XRGamepad;
}
export type InputSignal = {sessionId: number; inputSource: DeviceInput};
type Listener = ((detail: InputSignal) => void) | ((id: number) => void);

/** Internal events carry device data, never DOM events from the page. */
export class DeviceAdapter {
  private listeners = new Map<string, Set<Listener>>();
  constructor(readonly global: PolyfillGlobal) {}
  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? new Set<Listener>(); list.add(listener); this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(type: string, detail: number | InputSignal) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) (listener as (value: number | InputSignal) => void)(detail);
  }
}

/** Snapshot-compatible xr-standard gamepad state controlled by the existing panel. */
export class ControllerInput {
  active = false;
  handedness = 'none';
  targetRayMode = 'tracked-pointer';
  primaryActionPressed = false;
  primarySqueezeActionPressed = false;
  private readonly gamepadValue: XRGamepad;
  private axes: readonly number[] = Object.freeze([]);
  private buttons: readonly GamepadButton[] = Object.freeze([]);
  private timestamp = 0;
  readonly inputSource: DeviceInput;
  constructor(readonly primaryButtonIndex: number, readonly primarySqueezeButtonIndex: number) {
    const controller = this;
    this.gamepadValue = Object.freeze({
      id: '', index: -1, mapping: 'xr-standard' as const,
      get connected() { return controller.active; },
      get timestamp() { return controller.timestamp; },
      get axes() { return controller.axes; },
      get buttons() { return controller.buttons; },
      vibrationActuator: null, hapticActuators: Object.freeze([]),
    });
    this.inputSource = {
      get handedness() { return controller.handedness; },
      get targetRayMode() { return controller.targetRayMode; },
      get profiles() { return controller.targetRayMode === 'screen' ? ['generic-touchscreen'] : ['meta-quest-touch-plus', 'oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick']; },
      get gamepad() { return controller.gamepadValue!; },
    };
  }
  updateFromGamepad(gamepad: EmulatedGamepad) {
    this.handedness = gamepad.hand;
    this.timestamp = performance.now();
    this.axes = Object.freeze([...gamepad.axes]);
    this.buttons = Object.freeze(gamepad.buttons.map((button, index) => Object.freeze(index === 2 ? {pressed: false, touched: false, value: 0} : {...button})));

  }
}
