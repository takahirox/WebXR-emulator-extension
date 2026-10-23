import ConfigurationManager from '../ConfigurationManager';
import type { ExtensionMessage, RuntimeMessage } from '../types/contracts';
import { dispatchCustomEvent, isDeviceMessage } from '../types/contracts';
import { sendRuntimeMessage } from './messaging';
const postMessage = (message: ExtensionMessage) => sendRuntimeMessage({source: 'content', message});

// receive message from panel via background
// and transfer to polyfill as event on window

chrome.runtime.onMessage.addListener((envelope: RuntimeMessage) => {
  if (envelope?.source !== 'background') return;
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

// MAIN owns the active-session lifetime timer. Firefox destroys isolated-world
// timers/listeners on unload, so an isolated timer cannot detect its own removal.
// This synchronous reply uses no worker ping, port or background keepalive.
window.addEventListener('webxr-extension-check', () => {
  if (chrome.runtime?.id) dispatchCustomEvent('webxr-extension-alive', {});
});

// Set up listeners for events coming from EmulatedXRDevice.
// Transfer to panel via background.

window.addEventListener('device-pose', event => {
  if (!isDeviceMessage({...event.detail, action: 'device-pose'})) return;
  postMessage({
    action: 'device-pose',
    position: Array.from(event.detail.position),
    quaternion: Array.from(event.detail.quaternion)
  });
}, false);

window.addEventListener('device-input-pose', event => {
  if (!isDeviceMessage({...event.detail, action: 'device-input-pose'})) return;
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

// Set up listeners for requests coming from EmulatedXRDevice.
// Send back the response with the result.

window.addEventListener('webxr-virtual-room-request', event => {
  fetch(chrome.runtime.getURL('assets/hall_empty.glb')).then(response => {
    return response.arrayBuffer();
  }).then(buffer => {
    dispatchCustomEvent('webxr-virtual-room-response', {
      buffer: buffer
    });
  });
}, false);

// No synchronous storage and fetch APIs so reluctantly
// reflecting configuration asynchronously

ConfigurationManager.createFromJsonFile('src/devices.json').then(manager => {
  manager.loadFromStorage().then(() => {
    // send the configuration parameters to the polyfill as an event
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
