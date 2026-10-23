(function () {
    'use strict';

    function dispatchCustomEvent(type, detail) {
        window.dispatchEvent(new CustomEvent(type, {
            detail: typeof cloneInto !== 'undefined' ? cloneInto(detail, window) : detail,
        }));
    }

    WebXRPolyfillInjection();
    new CustomWebXRPolyfill();
    let extensionWatch = 0;
    let extensionAlive = false;
    window.addEventListener('webxr-extension-alive', () => { extensionAlive = true; });
    window.addEventListener('device-enter-immersive', () => {
        window.clearInterval(extensionWatch);
        extensionWatch = window.setInterval(() => {
            extensionAlive = false;
            dispatchCustomEvent('webxr-extension-check', {});
            if (extensionAlive)
                return;
            window.clearInterval(extensionWatch);
            dispatchCustomEvent('webxr-exit-immersive', {});
        }, 1000);
    });
    window.addEventListener('device-leave-immersive', () => window.clearInterval(extensionWatch));
    window.addEventListener('pagehide', () => window.clearInterval(extensionWatch));

})();
