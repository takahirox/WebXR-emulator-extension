(function () {
    'use strict';

    class ConfigurationManager {
        constructor(deviceDefinitions) {
            this._questMode = 'immersive-vr';
            this._deviceDefinitions = deviceDefinitions;
            this._deviceKey = this.defaultDeviceKey;
            this._stereoEffect = this.defaultStereoEffect;
            this._storageKey = 'webxr-extension';
        }
        static createFromJsonFile(path) {
            return new Promise((resolve, reject) => {
                fetch(chrome.runtime.getURL(path))
                    .then(response => response.json())
                    .then(json => {
                    resolve(new ConfigurationManager(json));
                }).catch(reject);
            });
        }
        get deviceKey() {
            return this._deviceKey;
        }
        get deviceDefinition() {
            return { ...this._deviceDefinitions.devices[this.deviceKey], emulationMode: this.emulationMode };
        }
        get questMode() { return this._questMode; }
        get emulationMode() {
            return this._deviceDefinitions.devices[this.deviceKey].formFactor === 'handheld'
                ? 'immersive-ar' : this.questMode;
        }
        updateQuestMode(mode) {
            if (mode !== 'immersive-vr' && mode !== 'immersive-ar')
                return false;
            if (mode === this._questMode)
                return false;
            this._questMode = mode;
            return true;
        }
        get stereoEffect() {
            return this._stereoEffect;
        }
        get defaultDeviceKey() {
            return this._deviceDefinitions.default.deviceKey;
        }
        get defaultStereoEffect() {
            return this._deviceDefinitions.default.stereoEffect;
        }
        get devices() {
            return this._deviceDefinitions.devices;
        }
        serialize() {
            return JSON.stringify({
                deviceKey: this.deviceKey,
                stereoEffect: this.stereoEffect,
                questMode: this.questMode
            });
        }
        deserialize(str) {
            if (!str) {
                str = '{}';
            }
            let json;
            try {
                json = JSON.parse(str) || {};
            }
            catch (_a) {
                json = {};
            }
            if (json.deviceKey === 'Samsung Galaxy S8+ (AR)')
                json.deviceKey = 'Generic Android Phone (ARCore)';
            const deviceKey = this._validDeviceKey(json.deviceKey)
                ? json.deviceKey : this.defaultDeviceKey;
            const stereoEffect = typeof json.stereoEffect === 'boolean'
                ? json.stereoEffect : this.defaultStereoEffect;
            this.updateQuestMode(json.questMode === 'immersive-ar' ? 'immersive-ar' : 'immersive-vr');
            this.updateDeviceKey(deviceKey);
            this.updateStereoEffect(stereoEffect);
        }
        updateDeviceKey(key) {
            if (!this._validDeviceKey(key)) {
                return false;
            }
            if (this._deviceKey !== key) {
                this._deviceKey = key;
                return true;
            }
            return false;
        }
        updateStereoEffect(enabled) {
            if (this._stereoEffect !== enabled) {
                this._stereoEffect = enabled;
                return true;
            }
            return false;
        }
        loadFromStorage() {
            return new Promise((resolve, reject) => {
                chrome.storage.local.get(this._storageKey, result => {
                    const value = result[this._storageKey];
                    this.deserialize(typeof value === 'string' ? value : '');
                    resolve(result);
                });
            });
        }
        storeToStorage() {
            return new Promise((resolve, reject) => {
                const storedValue = {};
                storedValue[this._storageKey] = this.serialize();
                chrome.storage.local.set(storedValue, () => {
                    resolve(storedValue);
                });
            });
        }
        _validDeviceKey(key) {
            return key !== undefined && Object.prototype.hasOwnProperty.call(this._deviceDefinitions.devices, key);
        }
    }

    function dispatchCustomEvent(type, detail) {
        window.dispatchEvent(new CustomEvent(type, {
            detail: typeof cloneInto !== 'undefined' ? cloneInto(detail, window) : detail,
        }));
    }
    function isRecord(value) {
        return typeof value === 'object' && value !== null;
    }
    function isVector(value, length) {
        return (Array.isArray(value) || ArrayBuffer.isView(value)) &&
            Array.from(value).length === length &&
            Array.from(value).every(v => typeof v === 'number' && Number.isFinite(v));
    }
    function isPose(value) {
        return isVector(value.position, 3) && isVector(value.quaternion, 4);
    }
    function isController(value) {
        return value === 'rightController' || value === 'leftController';
    }
    function isDeviceMessage(value) {
        if (!isRecord(value))
            return false;
        switch (value.action) {
            case 'webxr-startup':
            case 'device-enter-immersive':
            case 'device-leave-immersive': return true;
            case 'device-pose': return isPose(value);
            case 'device-input-pose': return isPose(value) && isController(value.objectName);
            default: return false;
        }
    }

    function sendRuntimeMessage(envelope) {
        chrome.runtime.sendMessage(envelope, () => {
            void chrome.runtime.lastError;
        });
    }

    const postMessage = (message) => sendRuntimeMessage({ source: 'content', message });
    chrome.runtime.onMessage.addListener((envelope) => {
        if ((envelope === null || envelope === void 0 ? void 0 : envelope.source) !== 'background')
            return;
        const message = envelope.message;
        switch (message.action) {
            case 'webxr-device':
                dispatchCustomEvent('webxr-device', {
                    deviceDefinition: message.deviceDefinition
                });
                break;
            case 'webxr-pose':
                dispatchCustomEvent('webxr-pose', {
                    position: message.position,
                    quaternion: message.quaternion
                });
                break;
            case 'webxr-input-pose':
                dispatchCustomEvent('webxr-input-pose', {
                    objectName: message.objectName,
                    position: message.position,
                    quaternion: message.quaternion
                });
                break;
            case 'webxr-input-button':
                dispatchCustomEvent('webxr-input-button', {
                    objectName: message.objectName,
                    pressed: message.pressed,
                    buttonIndex: message.buttonIndex
                });
                break;
            case 'webxr-stereo-effect':
                dispatchCustomEvent('webxr-stereo-effect', {
                    enabled: message.enabled
                });
                break;
            case 'webxr-exit-immersive':
                dispatchCustomEvent('webxr-exit-immersive', {});
                break;
        }
    });
    window.addEventListener('device-pose', event => {
        if (!isDeviceMessage({ ...event.detail, action: 'device-pose' }))
            return;
        postMessage({
            action: 'device-pose',
            position: Array.from(event.detail.position),
            quaternion: Array.from(event.detail.quaternion)
        });
    }, false);
    window.addEventListener('device-input-pose', event => {
        if (!isDeviceMessage({ ...event.detail, action: 'device-input-pose' }))
            return;
        postMessage({
            action: 'device-input-pose',
            objectName: event.detail.objectName,
            position: Array.from(event.detail.position),
            quaternion: Array.from(event.detail.quaternion)
        });
    }, false);
    window.addEventListener('device-enter-immersive', event => {
        postMessage({
            action: 'device-enter-immersive'
        });
    }, false);
    window.addEventListener('device-leave-immersive', event => {
        postMessage({
            action: 'device-leave-immersive'
        });
    }, false);
    window.addEventListener('webxr-virtual-room-request', event => {
        fetch(chrome.runtime.getURL('assets/hall_empty.glb')).then(response => {
            return response.arrayBuffer();
        }).then(buffer => {
            dispatchCustomEvent('webxr-virtual-room-response', {
                buffer: buffer
            });
        });
    }, false);
    ConfigurationManager.createFromJsonFile('src/devices.json').then(manager => {
        manager.loadFromStorage().then(() => {
            dispatchCustomEvent('webxr-device-init', {
                deviceDefinition: manager.deviceDefinition,
                stereoEffect: manager.stereoEffect
            });
            postMessage({
                action: 'webxr-startup'
            });
        });
    }).catch(error => {
        console.error(error);
    });

})();
