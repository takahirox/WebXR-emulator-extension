/** Read actual display pixels from the AR tablet, immediately after a render. */
export function readTabletPixels() {
  const {renderer, scene, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
  let screen: import('three').Mesh | undefined;
  scene.traverse(object => {
    const mesh = object as import('three').Mesh<import('three').BufferGeometry, import('three').Material>;
    if (mesh.material?.customProgramCacheKey() === 'ar-screen-composite-v1') screen = mesh;
  });
  if (!screen) throw new Error('AR screen not loaded');
  const geometry = screen.geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = [[0.2, 0.8], [0.2, 0.2], [0.8, 0.8], [0.8, 0.2]].map(([u, v]) => {
    const point = camera.position.clone().set(
      box.min.x + (box.max.x - box.min.x) * u,
      box.min.y + (box.max.y - box.min.y) * v, 0,
    );
    screen!.localToWorld(point).project(camera);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor((point.x + 1) * gl.drawingBufferWidth / 2),
      Math.floor((point.y + 1) * gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  });
  return {pixels, glError: gl.getError()};
}
