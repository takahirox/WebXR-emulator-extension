import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Object3D,
  OrthographicCamera,
  Mesh,
  Matrix3,
  MeshBasicMaterial,
  MeshStandardMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3
} from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import MyControls from './MyControls';
import type DOMOverlay from './DOMOverlay';
import {roomMeshes} from './api/environment';
import {roomHitTestGeometry, intersectHitTestGeometry, type HitTestGeometry} from './api/hit-test-geometry';
import type {DeviceSize} from '../types/contracts';

// @TODO: These default values should be imported from somewhere common place
const DEFAULT_CAMERA_POSITION = [0, 1.6, 0];
const DEFAULT_TABLET_POSITION = [0, 1.6, -0.2];
const DEFAULT_POINTER_POSITION = [0, 1.6, -0.15];

const dummyCanvasTexture = new CanvasTexture<HTMLCanvasElement | OffscreenCanvas>(document.createElement('canvas'));
dummyCanvasTexture.colorSpace = SRGBColorSpace;
const raycaster = new Raycaster();

export default class ARScene {
  renderer!: WebGLRenderer;
  scene!: Scene;
  camera!: PerspectiveCamera;
  tablet!: Mesh & {material: MeshStandardMaterial};
  pointer!: Mesh & {material: MeshBasicMaterial};
  screen!: Mesh & {material: MeshBasicMaterial};
  tabletCamera!: PerspectiveCamera;
  room: Object3D | null = null;
  stereoEffectEnabled = true;
  domOverlay: DOMOverlay | null = null;
  private disposed = false;
  private resetControls = () => {};
  private cleanup: (() => void)[] = [];
  private readonly appTexture = {value: dummyCanvasTexture};
  isTouched: boolean;
  onCameraPoseUpdate: ((position: number[], quaternion: number[]) => void) | null;
  onTabletPoseUpdate: ((position: number[], quaternion: number[]) => void) | null;
  onTouch: ((position: number[]) => void) | null;
  onRelease: (() => void) | null;

  constructor(deviceSize: DeviceSize, private handheld = true) {

    // for mouse click on the tablet screen
    this.isTouched = false;
    this.onCameraPoseUpdate = null;
    this.onTabletPoseUpdate = null;
    this.onTouch = null; // callback fired when mouse clicks the tablet screen
    this.onRelease = null; // callback fired when the tablet screen touch is released

    this._init(deviceSize);
  }

  _init(deviceSize: DeviceSize) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const canvas = document.createElement('canvas');
    // Modern Three.js requires WebGL2 for both render passes.
    const context = canvas.getContext('webgl2', {antialias: true});

    if (!context) throw new Error('WebXR Emulator AR rendering requires WebGL2.');
    const renderer = new WebGLRenderer({canvas, context});
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.oncontextmenu = () => { return false; };

    // Using 1024 without any special reasons so far
    const renderTarget = new WebGLRenderTarget(1024, 1024);

    const scene = new Scene();
    scene.background = new Color(0x444444);

    const camera = new PerspectiveCamera(90, width / height, 0.001, 1000.0);
    camera.position.fromArray(DEFAULT_CAMERA_POSITION);

    // @TODO: near and far should be from renderState
    // @TODO: Proper fov
    const tabletCamera = new PerspectiveCamera(90, deviceSize.width / deviceSize.height, 0.1, 1000.0);

    // Convert the legacy light intensity to modern physical units.
    const light = new DirectionalLight(0xffffff, 4 * Math.PI);
    light.position.set(-1, 1, -1);
    scene.add(light);

    const outsideFrameWidth = 0.005;
    const screen = new Mesh(
      new PlaneGeometry(deviceSize.width - outsideFrameWidth, deviceSize.height - outsideFrameWidth),
      new MeshBasicMaterial({color: 0xffffff, map: renderTarget.texture, toneMapped: false})
    ) as Mesh & {material: MeshBasicMaterial};
    screen.position.z = deviceSize.depth * 0.5 + 0.0001;  // 0.0001 is for not hiding the screen by the device
    screen.add(tabletCamera);

    // The render target contains linear light; CanvasTexture is tagged sRGB so
    // WebGL2 decodes it on sampling. Composite straight alpha in linear light,
    // then let the material's output chunk encode to the display exactly once.
    // CanvasTexture.flipY keeps the application's top at the tablet's top.
    screen.material.onBeforeCompile = shader => {
      shader.uniforms.appTexture = this.appTexture;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>',
          '#include <map_pars_fragment>\nuniform sampler2D appTexture;')
        .replace('#include <map_fragment>', `
          vec4 roomColor = texture2D(map, vMapUv);
          vec4 appColor = texture2D(appTexture, vMapUv);
          diffuseColor *= vec4(mix(roomColor.rgb, appColor.rgb, appColor.a), roomColor.a);
        `);
    };
    screen.material.customProgramCacheKey = () => 'ar-screen-composite-v1';

    const tablet = new Mesh(
      new BoxGeometry(deviceSize.width, deviceSize.height, deviceSize.depth),
      new MeshStandardMaterial({color: 0x000000})
    ) as Mesh & {material: MeshStandardMaterial};
    tablet.position.fromArray(DEFAULT_TABLET_POSITION);
    tablet.add(screen);
    scene.add(tablet);

    const pointer = new Mesh(
      new SphereGeometry(0.01),
      new MeshBasicMaterial({color: 0xff8888, transparent: true, opacity: 0.6})
    ) as Mesh & {material: MeshBasicMaterial};
    pointer.visible = false;
    pointer.position.fromArray(DEFAULT_POINTER_POSITION);
    scene.add(pointer);

    // Controls

    const cameraControls = new MyControls(camera, renderer.domElement);
    this.resetControls = () => {
      cameraControls.enabled = false;
      cameraControls.enabled = true;
    };
    cameraControls.addEventListener('change', () => {
      if (this.onCameraPoseUpdate) {
        this.onCameraPoseUpdate(camera.position.toArray(), camera.quaternion.toArray());
      }
    });

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.attach(tablet);
    transformControls.addEventListener('change', () => {
      if (this.onTabletPoseUpdate) {
        this.onTabletPoseUpdate(tablet.position.toArray(), tablet.quaternion.toArray());
      }
    });
    transformControls.addEventListener('mouseDown', () => {
      cameraControls.enabled = false;
    });
    transformControls.addEventListener('mouseUp', () => {
      cameraControls.enabled = true;
    });
    scene.add(transformControls.getHelper());
    if (!this.handheld) {
      transformControls.enabled = false;
      transformControls.getHelper().visible = false;
      tablet.visible = false;
      screen.remove(tabletCamera);
    }
    this.cleanup.push(() => { cameraControls.dispose(); transformControls.dispose(); renderTarget.dispose(); });

    // Raycasting for
    //   - switching transform operation mode by left clicking
    //   - firing input event by right clicking the tablet

    const mouse = new Vector2();
    const targetObjects = [screen, tablet];

    let mouseDownTime: number | null = null;
    const transformModes = {
      disabled: 0,
      translate: 1,
      rotate: 2
    };
    let transformMode = transformModes.translate;

    const raycast = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      // left-top (0, 0), right-bottom (1, 1)
      const point = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
      };
      mouse.set(point.x * 2 - 1, -(point.y * 2) + 1);
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects(targetObjects, false);
    };

    renderer.domElement.addEventListener('mousedown', event => {
      if (!this.handheld) return;
      if (event.button === 0) {
        // left click for translate operation mode
        mouseDownTime = null;
        if (!transformControls.dragging && raycast(event).length > 0) {
          mouseDownTime = performance.now();
        }
      } else if (event.button === 2) {
        // right click for input event 
        if (this.isTouched) {
          return;
        }
        const results = raycast(event);
        if (results.length > 0 && results[0].object === screen) {
          this.isTouched = true;
          cameraControls.enabled = false;
          if (this.onTouch) {
            this.onTouch(results[0].point.toArray());
          }
        }
      }
      event.preventDefault();
    }, false);

    renderer.domElement.addEventListener('mouseup', event => {
      if (!this.handheld) return;
      if (event.button === 0) {
        // left click for translate operation mode
        if (mouseDownTime === null) {
          return;
        }
        const mouseUpTime = performance.now();
        const thresholdTime = 300;
        if (mouseUpTime - mouseDownTime > thresholdTime) {
          return;
        }
        transformMode = transformMode === transformModes.disabled ? transformModes.translate :
                        transformMode === transformModes.translate ? transformModes.rotate :
                        transformModes.disabled;
        switch (transformMode) {
          case transformModes.disabled:
            transformControls.getHelper().visible = false;
            transformControls.enabled = false;
            break;
          case transformModes.translate:
            transformControls.getHelper().visible = true;
            transformControls.enabled = true;
            transformControls.setMode('translate');
            break;
          case transformModes.rotate:
            transformControls.getHelper().visible = true; // just in case
            transformControls.enabled = true; // just in case
            transformControls.setMode('rotate');
            break;
        }
      } else if (event.button === 2) {
        // right click for input event
        cameraControls.enabled = true;
        if (!this.isTouched) {
          return;
        }
        this.isTouched = false;
        if (this.onRelease) {
          this.onRelease();
        }
      }
      event.preventDefault();
    }, false);

    renderer.domElement.addEventListener('mousemove', event => {
      event.preventDefault();
      if (!this.isTouched) {
        return;
      }
      const results = raycast(event);
      if (results.length === 0 || results[0].object !== screen) {
        this.isTouched = false;
        if (this.onRelease) {
          this.onRelease();
        }
        return;
      }
      if (this.onTouch) {
        this.onTouch(results[0].point.toArray());
      }
    }, false);

    // animation frame

    // MR composites the same application texture over a stereo virtual room,
    // without the handheld phone or its touch gizmo in the headset view.
    const compositeScene = new Scene();
    const compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const composite = new Mesh(new PlaneGeometry(2, 2), screen.material.clone());
    composite.material.depthTest = false;
    composite.material.depthWrite = false;
    composite.material.onBeforeCompile = screen.material.onBeforeCompile;
    composite.material.customProgramCacheKey = screen.material.customProgramCacheKey;
    compositeScene.add(composite);
    this.cleanup.push(() => { composite.geometry.dispose(); composite.material.dispose(); });

    const animate = () => {
      if (this.disposed) return;
      requestAnimationFrame(animate);
      if (!renderer.domElement.isConnected) return;
      if (!this.handheld) {
        cameraControls.update();
        this.appTexture.value.needsUpdate = true;
        const width = renderer.domElement.width;
        const height = renderer.domElement.height;
        if (renderTarget.width !== width || renderTarget.height !== height) renderTarget.setSize(width, height);
        const eyes = this.stereoEffectEnabled ? [-0.02, 0.02] : [-0.02];
        const eyeCamera = tabletCamera;
        eyeCamera.fov = 90;
        renderTarget.scissorTest = true;
        for (let i = 0; i < eyes.length; i++) {
          const leftWidth = Math.floor(width / eyes.length);
          const eyeWidth = eyes.length === 1 ? width : i === 0 ? leftWidth : width - leftWidth;
          eyeCamera.aspect = this.applicationAspects?.[i] ?? eyeWidth / height;
          eyeCamera.updateProjectionMatrix();
          eyeCamera.position.copy(camera.position);
          eyeCamera.quaternion.copy(camera.quaternion);
          eyeCamera.translateX(eyes[i]);
          // Render target rectangles use physical pixels. Renderer setters use
          // logical pixels and would apply the display pixel ratio a second time.
          renderTarget.viewport.set(i === 0 ? 0 : leftWidth, 0, eyeWidth, height);
          renderTarget.scissor.copy(renderTarget.viewport);
          renderer.setRenderTarget(renderTarget);
          renderer.render(scene, eyeCamera);
        }
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(compositeScene, compositeCamera);
        return;
      }

      // First pass. Rendering ARScene to renderTarget.

      screen.visible = false;
      scene.traverse(object => {
        if (object.userData.virtual) {
          object.visible = true;
        }
      });
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, tabletCamera);

      // Second pass. Rendering ARScene and screen.
      // renderTarget and WebXR app Canvas is mixed on screen.

      cameraControls.update();
      // @TODO: If possible, update the canvas texture only when the canvas is updated
      this.appTexture.value.needsUpdate = true;
      screen.visible = true;
      scene.traverse(object => {
        if (object.userData.virtual) {
          object.visible = false;
        }
      });
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      this.domOverlay?.update();
    };

    animate();

    //

    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.screen = screen;
    this.tablet = tablet;
    this.pointer = pointer;
    this.tabletCamera = tabletCamera;
    this.room = null;
  }

  inject(div: HTMLElement) {
    const appendCanvas = () => {
      div.appendChild(this.renderer.domElement);
    };

    if (document.body) {
      appendCanvas();
    } else {
      document.addEventListener('DOMContentLoaded', appendCanvas);
    }
  }

  eject() {
    this.domOverlay?.dispose(); this.domOverlay = null;
    const element = this.renderer.domElement;
    element.remove();
    this.isTouched = false;
    this.resetControls();
    this.released();
  }

  dispose() {
    this.disposed = true;
    this.eject();
    this.releaseCanvas();
    for (const cleanup of this.cleanup) cleanup();
    this.scene.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    this.renderer.dispose();
  }

  applicationAspects: readonly number[] | null = null;

  setCanvas(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.releaseCanvas();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.appTexture.value = texture;
  }

  releaseCanvas() {
    if (this.appTexture.value !== dummyCanvasTexture) this.appTexture.value.dispose();
    this.appTexture.value = dummyCanvasTexture;
  }

  // Raycasting for AR hit testing API
  getHitTestGeometry() { return roomHitTestGeometry(this.room); }

  getHitTestResults(origin: ArrayLike<number>, direction: ArrayLike<number>, types?: readonly string[], geometry?: HitTestGeometry) {
    if (types) return intersectHitTestGeometry(origin, direction, geometry ?? this.getHitTestGeometry(), types);
    // Depth and independent room probes use the source mesh raycaster directly.
    raycaster.set(new Vector3().fromArray(origin), new Vector3().fromArray(direction));
    this.room?.updateWorldMatrix(true, true);
    return raycaster.intersectObjects(roomMeshes(this.room), false).map(hit => ({...hit,
      normal: hit.face!.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(), entityType: 'mesh' as const}));
  }

  loadVirtualRoomAsset(buffer: ArrayBuffer) {
    const loader = new GLTFLoader();
    loader.register(parser => {
      // ImageBitmapLoader fetches embedded blob URLs under connect-src. Use
      // image elements so the room retains its existing img-src CSP contract.
      parser.textureLoader = new TextureLoader(parser.options.manager)
        .setCrossOrigin(parser.options.crossOrigin)
        .setRequestHeader(parser.options.requestHeader);
      return {name: 'WEBXR_emulator_image_textures'};
    });
    loader.parse(buffer, '', gltf => {
      this.scene.add(gltf.scene);
      this.room = gltf.scene;
    }, error => {
      console.error(error);
    });
  }

  updateCameraTransform(positionArray: ArrayLike<number>, quaternionArray: ArrayLike<number>) {
    this.camera.position.fromArray(positionArray);
    this.camera.quaternion.fromArray(quaternionArray);
  }

  updateTabletTransform(positionArray: ArrayLike<number>, quaternionArray: ArrayLike<number>) {
    this.tablet.position.fromArray(positionArray);
    this.tablet.quaternion.fromArray(quaternionArray);
  }

  updatePointerTransform(positionArray: ArrayLike<number>, quaternionArray: ArrayLike<number>) {
    this.pointer.position.fromArray(positionArray);
    this.pointer.quaternion.fromArray(quaternionArray);
  }

  touched() {
    this.pointer.material.color.setHex(0x8888ff);
    this.pointer.visible = true;
  }

  released() {
    this.pointer.material.color.setHex(0xff8888);
    this.pointer.visible = false;
  }
}
