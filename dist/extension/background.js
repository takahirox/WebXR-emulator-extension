(function () {
    'use strict';

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
    function isPanelMessage(value) {
        if (!isRecord(value))
            return false;
        switch (value.action) {
            case 'webxr-device': return isRecord(value.deviceDefinition);
            case 'webxr-pose': return isPose(value);
            case 'webxr-input-pose': return isPose(value) && isController(value.objectName);
            case 'webxr-input-button': return isController(value.objectName) &&
                typeof value.pressed === 'boolean' && Number.isInteger(value.buttonIndex) &&
                value.buttonIndex >= 0;
            case 'webxr-stereo-effect': return typeof value.enabled === 'boolean';
            case 'webxr-exit-immersive': return true;
            default: return false;
        }
    }

    chrome.runtime.onMessage.addListener((envelope, sender, respond) => {
        var _a;
        if (sender.id !== chrome.runtime.id || !(envelope === null || envelope === void 0 ? void 0 : envelope.message))
            return;
        const message = envelope.message;
        const complete = () => {
            void chrome.runtime.lastError;
            respond();
        };
        if (envelope.source === 'content' && ((_a = sender.tab) === null || _a === void 0 ? void 0 : _a.id) !== undefined && isDeviceMessage(message)) {
            chrome.runtime.sendMessage({ source: 'background', message: { ...message, tabId: sender.tab.id } }, complete);
            return true;
        }
        if (envelope.source === 'panel' && !sender.tab &&
            sender.url === chrome.runtime.getURL('src/app/panel.html') &&
            Number.isInteger(message.tabId) && isPanelMessage(message)) {
            chrome.tabs.sendMessage(message.tabId, { source: 'background', message }, complete);
            return true;
        }
    });

})();
