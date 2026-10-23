// Test-only Three.js observation; no extension APIs or emulator input.
function observeScenes() {
  const observer = window.__THREE_DEVTOOLS__ ||= new EventTarget();
  window.firefoxScenes = [];
  observer.addEventListener('observe', event => {
    const scene = event.detail;
    if (!scene.isScene) return;
    const entry = {scene};
    window.firefoxScenes.push(entry);
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (...args) {
      [entry.renderer, , entry.camera] = args;
      return Reflect.apply(before, this, args);
    };
  });
}
