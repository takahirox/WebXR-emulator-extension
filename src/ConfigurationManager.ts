// @TODO: write json format comment

import type { DeviceDefinitions, ImmersiveMode } from './types/contracts';

export default class ConfigurationManager {
  private _deviceDefinitions: DeviceDefinitions;
  private _deviceKey: string;
  private _stereoEffect: boolean;
  private _questMode: ImmersiveMode = 'immersive-vr';
  private _storageKey: string;

  constructor(deviceDefinitions: DeviceDefinitions) {
    this._deviceDefinitions = deviceDefinitions;
    this._deviceKey = this.defaultDeviceKey;
    this._stereoEffect = this.defaultStereoEffect;
    this._storageKey = 'webxr-extension';
  }

  static createFromJsonFile(path: string): Promise<ConfigurationManager> {
    return new Promise<ConfigurationManager>((resolve, reject) => {
      fetch(chrome.runtime.getURL(path))
        .then(response => response.json())
        .then(json => {
          resolve(new ConfigurationManager(json as DeviceDefinitions));
        }).catch(reject);
    });
  }

  // exposed attributes

  get deviceKey() {
    return this._deviceKey;
  }

  get deviceDefinition() {
    // @TODO: throw error if deviceKey isn't valid?
    return {...this._deviceDefinitions.devices[this.deviceKey], emulationMode: this.emulationMode};
  }

  get questMode() { return this._questMode; }

  get emulationMode(): ImmersiveMode {
    return this._deviceDefinitions.devices[this.deviceKey].formFactor === 'handheld'
      ? 'immersive-ar' : this.questMode;
  }

  updateQuestMode(mode: ImmersiveMode) {
    if (mode !== 'immersive-vr' && mode !== 'immersive-ar') return false;
    if (mode === this._questMode) return false;
    this._questMode = mode;
    return true;
  }

  get stereoEffect() {
    return this._stereoEffect;
  }

  get defaultDeviceKey() {
    // @TODO: throw error if .default.deviceKey is undefined?
    return this._deviceDefinitions.default.deviceKey;
  }

  get defaultStereoEffect() {
    // @TODO: throw error if .default.stereoEffect is undefined?
    return this._deviceDefinitions.default.stereoEffect;
  }

  get devices() {
    return this._deviceDefinitions.devices;
  }

  // exposed methods

  serialize() {
    return JSON.stringify({
      deviceKey: this.deviceKey,
      stereoEffect: this.stereoEffect,
      questMode: this.questMode
    });
  }

  deserialize(str: string) {
    if (!str) { str = '{}'; }
    let json: { deviceKey?: string; stereoEffect?: boolean; questMode?: ImmersiveMode };
    try { json = JSON.parse(str) || {}; } catch { json = {}; }
    // Preserve the old handheld selection; removed headsets and unknown IDs use Quest.
    if (json.deviceKey === 'Samsung Galaxy S8+ (AR)') json.deviceKey = 'Generic Android Phone (ARCore)';
    const deviceKey = this._validDeviceKey(json.deviceKey)
      ? json.deviceKey : this.defaultDeviceKey;
    const stereoEffect = typeof json.stereoEffect === 'boolean'
      ? json.stereoEffect : this.defaultStereoEffect;

    this.updateQuestMode(json.questMode === 'immersive-ar' ? 'immersive-ar' : 'immersive-vr');
    this.updateDeviceKey(deviceKey);
    this.updateStereoEffect(stereoEffect);
  }

  updateDeviceKey(key: string) {
    if (!this._validDeviceKey(key)) {
      // @TODO: throw error?
      return false;
    }
    if (this._deviceKey !== key) {
      this._deviceKey = key;
      return true;
    }
    return false;
  }

  updateStereoEffect(enabled: boolean) {
    if (this._stereoEffect !== enabled) {
      this._stereoEffect = enabled;
      return true;
    }
    return false;
  }

  loadFromStorage() {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      chrome.storage.local.get(this._storageKey, result => {
        const value = result[this._storageKey];
        this.deserialize(typeof value === 'string' ? value : '');
        resolve(result);
      });
    });
  }

  storeToStorage() {
    return new Promise<Record<string, string>>((resolve, reject) => {
      const storedValue: Record<string, string> = {};
      storedValue[this._storageKey] = this.serialize();
      chrome.storage.local.set(storedValue, () => {
        resolve(storedValue);
      });
    });
  }

  // private methods

  _validDeviceKey(key: string | undefined): key is string {
    return key !== undefined && Object.prototype.hasOwnProperty.call(this._deviceDefinitions.devices, key);
  }
}
