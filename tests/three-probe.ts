/** Install only in test targets, before the bundled Three.js constructs a scene. */
export function installThreeProbe() {
  const probeWindow = window as unknown as import('./browser-types').PanelProbeWindow & {__THREE_DEVTOOLS__: EventTarget};
  const observer = new EventTarget();
  probeWindow.__THREE_DEVTOOLS__ = observer;
  observer.addEventListener('observe', event => {
    const scene = (event as CustomEvent<import('three').Scene>).detail;
    if (!scene.isScene) return;
    // Three.js's observation hook exposes the actual bundled scene without
    // installing a production window.THREE global or importing a second copy.
    scene.onBeforeRender = (renderer, scene, camera) => {
      probeWindow.panelProbe = {renderer, scene, camera};
      const target = renderer.getRenderTarget();
      if (target) {
        const gl = renderer.getContext();
        const viewport = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array);
        if (viewport[0] === 0) probeWindow.roomViews = [];
        (probeWindow.roomViews ||= []).push({
          width: target.width, height: target.height, viewport,
          scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),
          scissorTest: gl.isEnabled(gl.SCISSOR_TEST), projection: camera.projectionMatrix.elements[0],
        });
      }
    };
  });
}
