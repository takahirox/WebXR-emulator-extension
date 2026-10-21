import * as THREE from '../node_modules/three/build/three.module.js';

// Emulator developer demo only. Never display this as a physical safety boundary.
export async function startBoundedFloor(mode) {
  const session = await navigator.xr.requestSession(mode, {requiredFeatures: ['bounded-floor']});
  const renderer = new THREE.WebGLRenderer({alpha: true, antialias: false, preserveDrawingBuffer: true});
  renderer.setSize(800, 600);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('bounded-floor');
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const material = new THREE.LineBasicMaterial({color: 0x00ff00, depthTest: false});
  let geometry;
  let frames = 0;
  let resolveRendered;
  const rendered = new Promise(resolve => { resolveRendered = resolve; });
  const cleanup = () => {
    renderer.setAnimationLoop(null);
    geometry?.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
  };
  session.addEventListener('end', cleanup, {once: true});
  try {
    await renderer.xr.setSession(session);
    const reference = renderer.xr.getReferenceSpace();
    geometry = new THREE.BufferGeometry().setFromPoints(reference.boundsGeometry.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    scene.add(new THREE.LineLoop(geometry, material));
    renderer.setAnimationLoop((_time, frame) => {
      if (!frame) return; // Ignore Three.js desktop callbacks while presenting XR.
      renderer.render(scene, camera);
      if (++frames === 30) {
        const gl = renderer.getContext();
        const target = renderer.getRenderTarget();
        const width = target?.width ?? gl.drawingBufferWidth, height = target?.height ?? gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let greenPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 20 && pixels[i + 1] > 200 && pixels[i + 2] < 20 && pixels[i + 3] > 200) greenPixels++;
        resolveRendered({frames, greenPixels, bounds: reference.boundsGeometry.map(p => [p.x, p.y, p.z, p.w]), vertices: Array.from(geometry.getAttribute('position').array)});
      }
    });
    return {session, reference, rendered, capture: () => renderer.domElement.toDataURL('image/png'), getState: () => ({frames, ended: session.ended, presenting: renderer.xr.isPresenting, hidden: document.hidden, renderState: !!session.renderState.layers})};
  } catch (error) { await session.end(); throw error; }
}
