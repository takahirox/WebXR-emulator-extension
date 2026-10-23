import {dispatchCustomEvent} from '../types/contracts';
// Both files are packaged, manifest-declared MAIN-world document_start scripts.
// Install synchronously, before the page's first script can inspect navigator.xr.
// This world must never receive extension APIs or storage access.
WebXRPolyfillInjection();
new CustomWebXRPolyfill();
// Keep the watchdog in the page world, which survives extension unload. Check
// synchronously so throttled/suspended tabs cannot mistake delayed timers for
// lost extension contexts. The content script replies through the typed bridge.
let extensionWatch = 0;
let extensionAlive = false;
window.addEventListener('webxr-extension-alive', () => { extensionAlive = true; });
window.addEventListener('device-enter-immersive', () => {
  window.clearInterval(extensionWatch);
  extensionWatch = window.setInterval(() => {
    extensionAlive = false;
    dispatchCustomEvent('webxr-extension-check', {});
    if (extensionAlive) return;
    window.clearInterval(extensionWatch);
    dispatchCustomEvent('webxr-exit-immersive', {});
  }, 1000);
});
window.addEventListener('device-leave-immersive', () => window.clearInterval(extensionWatch));
window.addEventListener('pagehide', () => window.clearInterval(extensionWatch));
