/** Contracts shared across the panel, isolated content script, and injected page. */
export type SessionMode = 'inline' | 'immersive-vr' | 'immersive-ar';
export type ImmersiveMode = Exclude<SessionMode, 'inline'>;
export type ControllerName = 'rightController' | 'leftController';
export interface HapticState {
  objectName: ControllerName; sessionId: number; sourceId: number;
  state: 'idle' | 'delayed' | 'playing';
  startDelay: number; duration: number; strongMagnitude: number; weakMagnitude: number;
}
export interface Capabilities { hasPosition: boolean; hasRotation: boolean; hasSqueezeButton?: boolean }
export interface ControllerDefinition extends Capabilities {
  id?: string; buttonNum: number; primaryButtonIndex: number; primarySqueezeButtonIndex?: number;
}
export interface DeviceSize { width: number; height: number; depth: number }
export interface DeviceDefinition {
  id: string; name: string; modes: SessionMode[]; features?: string[];
  domOverlayPreview?: boolean; domOverlayPreviewFlat?: boolean;
  formFactor?: 'headset' | 'handheld'; emulationMode?: ImmersiveMode;
  headset?: Capabilities; controllers?: ControllerDefinition[];
  resolution?: { width: number; height: number }; size?: DeviceSize;
}
export type DeviceConfig = Partial<DeviceDefinition> & { stereoEffect?: boolean };
export interface DeviceDefinitions { default: {deviceKey: string; stereoEffect: boolean}; devices: Record<string, DeviceDefinition> }
export interface Pose { position: ArrayLike<number>; quaternion: ArrayLike<number> }
export interface InputPose extends Pose { objectName: ControllerName }
export interface InputButton { objectName: ControllerName; pressed: boolean; buttonIndex: number }
export interface EmulatorEvents {
  'webxr-device': {deviceDefinition: DeviceDefinition};
  'webxr-device-init': {deviceDefinition: DeviceDefinition; stereoEffect: boolean};
  'webxr-pose': Pose; 'device-pose': Pose;
  'webxr-input-pose': InputPose; 'device-input-pose': InputPose;
  'webxr-input-button': InputButton;
  'webxr-stereo-effect': {enabled: boolean};
  'webxr-extension-check': Record<never, never>;
  'webxr-extension-alive': Record<never, never>;
  'webxr-exit-immersive': Record<never, never>;
  'device-haptics': HapticState;
  'device-enter-immersive': Record<never, never>;
  'device-leave-immersive': Record<never, never>;
  'webxr-virtual-room-request': Record<never, never>;
  'webxr-virtual-room-response': {buffer: ArrayBuffer};
}
type BridgeEvent = Exclude<keyof EmulatorEvents,
  'webxr-extension-check' | 'webxr-extension-alive' | 'webxr-device-init' | 'webxr-virtual-room-request' | 'webxr-virtual-room-response'>;
export type ExtensionMessage = (
  {[K in BridgeEvent]: {action: K} & EmulatorEvents[K]}[BridgeEvent]
  | {action: 'webxr-startup'}
) & {tabId?: number; frameId?: number};
export interface EmulatedGamepad {
  id: string; hand: 'right' | 'left'; mapping: string; axes: number[];
  pose: {hasPosition: boolean; position: number[]; orientation: number[]};
  buttons: {pressed: boolean; touched: boolean; value: number}[];
}
export function dispatchCustomEvent<K extends keyof EmulatorEvents>(type: K, detail: EmulatorEvents[K]): void {
  window.dispatchEvent(new CustomEvent(type, {
    detail: typeof cloneInto !== 'undefined' ? cloneInto(detail, window) : detail,
  }));
}

export interface RuntimeMessage {
  source: 'panel' | 'content' | 'background';
  message: ExtensionMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isVector(value: unknown, length: number): boolean {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    Array.from(value as ArrayLike<unknown>).length === length &&
    Array.from(value as ArrayLike<unknown>).every(v => typeof v === 'number' && Number.isFinite(v));
}
function isPose(value: Record<string, unknown>): boolean {
  return isVector(value.position, 3) && isVector(value.quaternion, 4);
}
function isController(value: unknown): boolean {
  return value === 'rightController' || value === 'leftController';
}

// MAIN-world events are page-controlled. Only emulation data may cross into
// extension pages; a page cannot request privileged APIs, URLs, or another tab.
export function isDeviceMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value)) return false;
  switch (value.action) {
    case 'webxr-startup':
    case 'device-enter-immersive':
    case 'device-leave-immersive': return true;
    case 'device-haptics': return isController(value.objectName) &&
      ['idle', 'delayed', 'playing'].includes(value.state as string) &&
      ['sessionId', 'sourceId'].every(key => Number.isSafeInteger(value[key]) && (value[key] as number) > 0) &&
      ['duration', 'startDelay', 'strongMagnitude', 'weakMagnitude'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= (key.endsWith('Magnitude') ? 1 : 5000)) &&
      (value.duration as number) + (value.startDelay as number) <= 5000;
    case 'device-pose': return isPose(value);
    case 'device-input-pose': return isPose(value) && isController(value.objectName);
    default: return false;
  }
}
export function isPanelMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value)) return false;
  switch (value.action) {
    case 'webxr-device': return isRecord(value.deviceDefinition);
    case 'webxr-pose': return isPose(value);
    case 'webxr-input-pose': return isPose(value) && isController(value.objectName);
    case 'webxr-input-button': return isController(value.objectName) &&
      typeof value.pressed === 'boolean' && Number.isInteger(value.buttonIndex) &&
      (value.buttonIndex as number) >= 0;
    case 'webxr-stereo-effect': return typeof value.enabled === 'boolean';
    case 'webxr-exit-immersive': return true;
    default: return false;
  }
}
