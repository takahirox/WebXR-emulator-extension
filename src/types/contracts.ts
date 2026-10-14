/** Contracts shared across the panel, isolated content script, and injected page. */
export type SessionMode = 'inline' | 'immersive-vr' | 'immersive-ar';
export type ControllerName = 'rightController' | 'leftController';
export interface Capabilities { hasPosition: boolean; hasRotation: boolean; hasSqueezeButton?: boolean }
export interface ControllerDefinition extends Capabilities {
  id?: string; buttonNum: number; primaryButtonIndex: number; primarySqueezeButtonIndex?: number;
}
export interface DeviceSize { width: number; height: number; depth: number }
export interface DeviceDefinition {
  id: string; name: string; modes: SessionMode[]; features?: string[];
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
  'webxr-exit-immersive': Record<never, never>;
  'device-enter-immersive': Record<never, never>;
  'device-leave-immersive': Record<never, never>;
  'webxr-virtual-room-request': Record<never, never>;
  'webxr-virtual-room-response': {buffer: ArrayBuffer};
}
type BridgeEvent = Exclude<keyof EmulatorEvents,
  'webxr-device-init' | 'webxr-virtual-room-request' | 'webxr-virtual-room-response'>;
export type ExtensionMessage = (
  {[K in BridgeEvent]: {action: K} & EmulatorEvents[K]}[BridgeEvent]
  | {action: 'webxr-startup'}
) & {tabId?: number};
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
