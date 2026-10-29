import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { Capabilities, DeviceDefinition, ControllerName } from '../types/contracts';
import ConfigurationManager from '../ConfigurationManager';
import type { ExtensionMessage, RuntimeMessage } from '../types/contracts';
import {isDeviceMessage, type HapticState} from '../types/contracts';
import { sendRuntimeMessage } from '../extension/messaging';
const tabId = chrome.devtools.inspectedWindow.tabId;

// Entries are scoped to the browser-stamped frame and source/session. An old
// source's idle event must never clear a replacement or another frame's effect.
const hapticEntries = new Map<string, HapticState & {frameId: number; timer: number}>();
function renderHaptics() {
  for (const objectName of ['leftController', 'rightController'] as const) {
    const element = document.getElementById(objectName + 'Haptics')!;
    const entries = [...hapticEntries.values()].filter(entry => entry.objectName === objectName);
    element.dataset.state = entries.some(entry => entry.state === 'playing') ? 'playing' : entries.length ? 'delayed' : 'idle';
    element.textContent = entries.length ? entries.map(entry =>
      `Haptics: ${entry.state} · strong ${entry.strongMagnitude.toFixed(2)} / weak ${entry.weakMagnitude.toFixed(2)} · ${entry.duration} ms` +
      (entry.startDelay ? ` · delay ${entry.startDelay} ms` : '') + ` (frame ${entry.frameId})`).join('\n') : 'Haptics: idle';
  }
}
function clearHaptics(frameId?: number) {
  for (const [key, entry] of hapticEntries) if (frameId === undefined || entry.frameId === frameId) {
    clearTimeout(entry.timer); hapticEntries.delete(key);
  }
  renderHaptics();
}
function updateHaptics(message: HapticState, frameId: number) {
  const key = `${frameId}:${message.sessionId}:${message.sourceId}`;
  const previous = hapticEntries.get(key);
  if (previous) clearTimeout(previous.timer);
  hapticEntries.delete(key);
  if (message.state !== 'idle') {
    // Bounded fallback clears feedback if a frame or extension disappears
    // before its final notification. No perpetual animation or UI work.
    const timer = window.setTimeout(() => { hapticEntries.delete(key); renderHaptics(); }, message.startDelay + message.duration + 250);
    // Bound page-controlled diagnostics, including forged source identifiers.
    if (hapticEntries.size >= 32) {
      const oldest = hapticEntries.keys().next().value!;
      clearTimeout(hapticEntries.get(oldest)!.timer); hapticEntries.delete(oldest);
    }
    hapticEntries.set(key, {...message, frameId, timer});
  }
  renderHaptics();
}
chrome.devtools.network.onNavigated.addListener(() => clearHaptics());

// receive message from contentScript via background

chrome.runtime.onMessage.addListener((envelope: RuntimeMessage) => {
  if (envelope?.source !== 'background' || envelope.message.tabId !== tabId) return;
  const message = envelope.message;
  switch (message.action) {
    case 'device-haptics':
      if (isDeviceMessage(message)) updateHaptics(message, message.frameId ?? 0);
      break;
    case 'webxr-startup':
      clearHaptics(message.frameId ?? 0);
      // notify the poses to sync
      // if main page is reloaded while panel is opened
      notifyPoses();
      break;
    case 'device-pose':
      // @TODO: Make function?
      {
        const node = assetNodes[DEVICE.HEADSET];
        if (!node) {
          return;
        }
        node.position.fromArray(message.position);
        node.quaternion.fromArray(message.quaternion);
        updateHeadsetPropertyComponent();
        render();
      }
      break;
    case 'device-input-pose':
      {
        // @TODO: Make function?
        const objectName = message.objectName;
        const key = objectName === 'rightController' ? DEVICE.RIGHT_CONTROLLER : DEVICE.LEFT_CONTROLLER;
        const node = assetNodes[key];
        if (!node) {
          return;
        }
        node.position.fromArray(message.position);
        node.quaternion.fromArray(message.quaternion);
        updateControllerPropertyComponent(key);
        render();
      }
      break;
    case 'device-enter-immersive':
      states.inImmersive = true;
      notifyPoses();
      break;
    case 'device-leave-immersive':
      states.inImmersive = false;
      break;
  }
});

// send message to contentScript via background

const postMessage = (message: ExtensionMessage) => {
  sendRuntimeMessage({source: 'panel', message: {...message, tabId}});
};

const notifyPoseChange = (node: THREE.Object3D) => {
  postMessage({
    action: 'webxr-pose',
    position: node.position.toArray([]), // @TODO: reuse array
    quaternion: node.quaternion.toArray([]) // @TODO: reuse array
  });
};

const notifyInputPoseChange = (key: string, node: THREE.Object3D) => {
  postMessage({
    action: 'webxr-input-pose',
    objectName: OBJECT_NAME[key],
    position: node.position.toArray([]), // @TODO: reuse array
    quaternion: node.quaternion.toArray([]) // @TODO: reuse array
  });
};

const notifyInputButtonPressed = (key: string, buttonKey: number, pressed: boolean) => {
  postMessage({
    action: 'webxr-input-button',
    objectName: OBJECT_NAME[key],
    buttonIndex: buttonKey,
    pressed: pressed
  });
};

const notifyDeviceChange = (deviceDefinition: DeviceDefinition) => {
  clearHaptics();
  postMessage({
    action: 'webxr-device',
    deviceDefinition: deviceDefinition
  });
};

const notifyStereoEffectChange = (enabled: boolean) => {
  postMessage({
    action: 'webxr-stereo-effect',
    enabled: enabled
  });
};

const notifyPoses = () => {
  for (const key in assetNodes) {
    if (assetNodes[key]) {
      if (key === DEVICE.HEADSET) {
        notifyPoseChange(assetNodes[key]!);
      } else {
        notifyInputPoseChange(key, assetNodes[key]!);
      }
    }
  }
};

const notifyExitImmersive = () => {
  postMessage({
    action: 'webxr-exit-immersive'
  });
};

//

const DEVICE = {
  HEADSET: '0',
  CONTROLLER: '1', // use this in case you don't distinguish left/right
  RIGHT_CONTROLLER: '2',
  LEFT_CONTROLLER: '3',
  POINTER: '4',
  TABLET: '5'
};

const BUTTON = {
  SELECT: 0,
  SQUEEZE: 1
};

const ASSET_PATH: Record<string, string> = {};
ASSET_PATH[DEVICE.HEADSET] = '../../assets/headset.obj';
ASSET_PATH[DEVICE.CONTROLLER] = '../../assets/oculus-go-controller.glb';

const OBJECT_NAME: Record<string, ControllerName> = {};
OBJECT_NAME[DEVICE.RIGHT_CONTROLLER] = 'rightController';
OBJECT_NAME[DEVICE.LEFT_CONTROLLER] = 'leftController';

const states = {
  inImmersive: false,
  buttonPressed: {} as Record<string, Record<number, boolean>>,
  handheld: false
};
states.buttonPressed[DEVICE.RIGHT_CONTROLLER] = {};
states.buttonPressed[DEVICE.RIGHT_CONTROLLER][BUTTON.SELECT] = false;
states.buttonPressed[DEVICE.RIGHT_CONTROLLER][BUTTON.SQUEEZE] = false;
states.buttonPressed[DEVICE.LEFT_CONTROLLER] = {};
states.buttonPressed[DEVICE.LEFT_CONTROLLER][BUTTON.SELECT] = false;
states.buttonPressed[DEVICE.LEFT_CONTROLLER][BUTTON.SQUEEZE] = false;

const deviceCapabilities: Record<string, Capabilities> = {};
deviceCapabilities[DEVICE.HEADSET] = {
  hasPosition: false,
  hasRotation: false
};
deviceCapabilities[DEVICE.CONTROLLER] = {
  hasPosition: false,
  hasRotation: false,
  hasSqueezeButton: false
};

const transformControls: Record<string, TransformControls | null> = {};
transformControls[DEVICE.HEADSET] = null;
transformControls[DEVICE.RIGHT_CONTROLLER] = null;
transformControls[DEVICE.LEFT_CONTROLLER] = null;

const assetNodes: Record<string, THREE.Object3D | null> = {};
assetNodes[DEVICE.HEADSET] = null;
assetNodes[DEVICE.RIGHT_CONTROLLER] = null;
assetNodes[DEVICE.LEFT_CONTROLLER] = null;

// @TODO: Currently the values are　groundless.
//        Set more appropriate values.
const defaultTransforms: Record<string, {position: THREE.Vector3; rotation: THREE.Euler}> = {};
defaultTransforms[DEVICE.HEADSET] = {
  position: new THREE.Vector3(0, 1.6, 0),
  rotation: new THREE.Euler(0, 0, 0)
};
defaultTransforms[DEVICE.RIGHT_CONTROLLER] = {
  position: new THREE.Vector3(0.5, 1.5, -1.0),
  rotation: new THREE.Euler(0, 0, 0)
};
defaultTransforms[DEVICE.LEFT_CONTROLLER] = {
  position: new THREE.Vector3(-0.5, 1.5, -1.0),
  rotation: new THREE.Euler(0, 0, 0)
};
// The parameters should be shared with ARScene.js
defaultTransforms[DEVICE.POINTER] = {
  position: new THREE.Vector3(0.0, 1.6, -0.15),
  rotation: new THREE.Euler(0, 0, 0)
};
defaultTransforms[DEVICE.TABLET] = {
  position: new THREE.Vector3(0.0, 1.6, -0.2),
  rotation: new THREE.Euler(0, 0, 0)
};

// initialize Three.js objects

// renderer

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(1, 1);
document.getElementById('renderComponent')!.appendChild(renderer.domElement);

// Canvas size relying on browser's flexbox
// then waiting for the flex box determines the size.
const onResize = () => {
  const div = document.getElementById('renderComponent')!;
  renderer.setSize(1, 1);
  // Not sure if 1ms is long enough but seems working fine for now.
  setTimeout(() => {
    const width = div.offsetWidth;
    const height = div.offsetHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    render();
  }, 1);
};

onResize();

// scene, camera, light, grid

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f3f3);

const camera = new THREE.PerspectiveCamera(45, 1 / 1, 0.1, 100);
camera.position.set(-3, 3, 4);
camera.lookAt(new THREE.Vector3(0, 2, 0));

const render = () => {
  renderer.render(scene, camera);
};

// Retain legacy brightness with modern physically correct light intensities.
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(-1, 1, -1);
scene.add(light);

const gridHelper = new THREE.GridHelper(20, 20);
scene.add(gridHelper);

// orbit controls for camera

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.screenSpacePanning = false; // Preserve the legacy ground-plane pan.
orbitControls.addEventListener('change', render);
orbitControls.target.set(0, 2, 0);
orbitControls.update(); // seems like this line is necessary if I set non-zero as target

// transform controls for device assets

const createTransformControls = (target: THREE.Object3D, onChange: () => void) => {
  const controls = new TransformControls(camera, renderer.domElement);
  controls.setSpace('local');
  controls.attach(target);
  controls.setSize(1.5);
  controls.enabled = false;
  controls.getHelper().visible = false;

  controls.addEventListener('mouseDown', () => {
    orbitControls.enabled = false;
  });

  controls.addEventListener('mouseUp', () => {
    orbitControls.enabled = true;
  });

  controls.addEventListener('change', () => {
    onChange();
    render();
  });

  return controls;
};

// @TODO: Rename
const setupTransformControlsMode = (controls: TransformControls, capabilities: Capabilities) => {
  // change the mode if the device doesn't support
  if (controls.enabled) {
    // Translate -> Rotate -> Disable
    if (controls.getMode() === 'translate' && !capabilities.hasPosition) {
      controls.setMode('rotate');
    }
    if (controls.getMode() === 'rotate' && !capabilities.hasRotation) {
      controls.getHelper().visible = false;
      controls.enabled = false;
    }
  }
};

// device assets

let assetGeneration = 0;
const loadHeadsetAsset = (handheld: boolean) => {
  const generation = assetGeneration;
  new OBJLoader().load(ASSET_PATH[DEVICE.HEADSET], headset => {
    if (generation !== assetGeneration) return;
    const parent = new THREE.Object3D();
    parent.position.copy(defaultTransforms[DEVICE.HEADSET].position);
    parent.rotation.copy(defaultTransforms[DEVICE.HEADSET].rotation);
    headset.rotation.y = -Math.PI;

    scene.add(parent.add(handheld
      ? new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.08), new THREE.MeshStandardMaterial({color: 0x888888}))
      : headset));
    assetNodes[DEVICE.HEADSET] = parent;

    const onChange = () => {
      updateHeadsetPropertyComponent();
      notifyPoseChange(parent);
    };

    const controls = createTransformControls(parent, onChange);
    scene.add(controls.getHelper());
    transformControls[DEVICE.HEADSET] = controls;
    onChange();
    render();
  });
};

const loadControllersAsset = (loadRight: boolean, loadLeft: boolean, handheld: boolean) => {
  const generation = assetGeneration;
  new GLTFLoader().load(ASSET_PATH[DEVICE.CONTROLLER], gltf => {
    if (generation !== assetGeneration) return;
    const baseController = gltf.scene;
    baseController.scale.multiplyScalar(6);

    const recursivelyClone = (node: THREE.Object3D) => {
      const cloneWithMaterial = (object: THREE.Object3D) => {
        const clonedObject = object.clone(false) as THREE.Object3D & {material?: THREE.Material};
        // @TODO: support material array?
        if (clonedObject.material) {
          clonedObject.material = clonedObject.material.clone();
        }
        return clonedObject;
      };
      const traverse = (object: THREE.Object3D, parent?: THREE.Object3D): THREE.Object3D => {
        const clonedObject = cloneWithMaterial(object);
        if (parent) {
          parent.add(clonedObject);
        }
        for (const child of object.children) {
          traverse(child, clonedObject);
        }
        return clonedObject;
      };
      return traverse(node);
    };

    const setupController = (key: string) => {
      const parent = new THREE.Object3D();
      const controller = handheld
        ? new THREE.Mesh(key === DEVICE.RIGHT_CONTROLLER ? new THREE.SphereGeometry(0.025) : new THREE.BoxGeometry(0.075, 0.15, 0.008),
          new THREE.MeshStandardMaterial({color: key === DEVICE.RIGHT_CONTROLLER ? 0xff8888 : 0x333333}))
        : recursivelyClone(baseController);

      // @TODO: Simplify
      let keyForDefaultTransform = key;
      if (handheld) {
        keyForDefaultTransform = key === DEVICE.RIGHT_CONTROLLER ? DEVICE.POINTER :
              key === DEVICE.LEFT_CONTROLLER ? DEVICE.TABLET :
              key;
      }

      parent.position.copy(defaultTransforms[keyForDefaultTransform].position);
      parent.rotation.copy(defaultTransforms[keyForDefaultTransform].rotation);
      parent.add(controller);

      scene.add(parent);

      assetNodes[key] = parent;

      const onChange = () => {
        updateControllerPropertyComponent(key);
        notifyInputPoseChange(key, parent);
      };

      const checkboxId = key === DEVICE.RIGHT_CONTROLLER ?
        'rightControllerCheckbox' : 'leftControllerCheckbox';

      const controls = createTransformControls(parent, onChange);
      scene.add(controls.getHelper());
      transformControls[key] = controls;
      onChange();
    };

    if (loadRight) {
      setupController(DEVICE.RIGHT_CONTROLLER);
    }

    if (loadLeft) {
      setupController(DEVICE.LEFT_CONTROLLER);
    }

    render();
  });
};

const updateAssetNodes = (deviceDefinition: DeviceDefinition) => {
  assetGeneration++;
  const handheld = deviceDefinition.formFactor === 'handheld';
  states.handheld = handheld;
  document.getElementById('headsetTitle')!.textContent = handheld ? 'Observer camera' : 'Headset';
  document.getElementById('rightControllerTitle')!.textContent = handheld ? 'Touch pointer (virtual)' : 'Right controller';
  document.getElementById('leftControllerTitle')!.textContent = handheld ? 'Phone' : 'Left controller';
  document.getElementById('questModeLabel')!.style.display = handheld ? 'none' : '';
  document.getElementById('modeHelp')!.textContent = handheld
    ? 'Phone AR: move the phone and observer camera. Right-click the phone screen in the page to touch.'
    : 'Choose VR or MR, then start that session in the page. Changing mode ends the active session.';

  // Reset input feedback before replacing device assets.
  if (assetNodes[DEVICE.RIGHT_CONTROLLER]) {
    states.buttonPressed[DEVICE.RIGHT_CONTROLLER][BUTTON.SELECT] = false;
    states.buttonPressed[DEVICE.RIGHT_CONTROLLER][BUTTON.SQUEEZE] = false;
    updateControllerColor(DEVICE.RIGHT_CONTROLLER);
  }
  if (assetNodes[DEVICE.LEFT_CONTROLLER]) {
    states.buttonPressed[DEVICE.LEFT_CONTROLLER][BUTTON.SELECT] = false;
    states.buttonPressed[DEVICE.LEFT_CONTROLLER][BUTTON.SQUEEZE] = false;
    updateControllerColor(DEVICE.LEFT_CONTROLLER);
  }

  // firstly remove all existing resources and disable all panel controls

  for (const key in assetNodes) {
    const node = assetNodes[key];
    const controls = transformControls[key];

    if (!node) {
      continue;
    }

    if (node.parent) {
      node.parent.remove(node);
    }

    controls!.detach();
    scene.remove(controls!.getHelper());
    controls!.dispose();

    assetNodes[key] = null;
    transformControls[key] = null;
  }

  deviceCapabilities[DEVICE.HEADSET].hasPosition = false;
  deviceCapabilities[DEVICE.HEADSET].hasRotation = false;
  deviceCapabilities[DEVICE.CONTROLLER].hasPosition = false;
  deviceCapabilities[DEVICE.CONTROLLER].hasRotation = false;
  deviceCapabilities[DEVICE.CONTROLLER].hasSqueezeButton = false;
  document.getElementById('stereoEffectLabel')!.style.display = 'none';
  document.getElementById('headsetComponent')!.style.display = 'none';
  document.getElementById('rightControllerComponent')!.style.display = 'none';
  document.getElementById('leftControllerComponent')!.style.display = 'none';
  document.getElementById('resetPoseButton')!.style.display = 'none';
  document.getElementById('exitButton')!.style.display = 'none';
  document.getElementById('rightSelectButton')!.style.display = 'none';
  document.getElementById('leftSelectButton')!.style.display = 'none';
  document.getElementById('rightSqueezeButton')!.style.display = 'none';
  document.getElementById('leftSqueezeButton')!.style.display = 'none';
  updateTriggerButtonColor(DEVICE.RIGHT_CONTROLLER, BUTTON.SELECT, false);
  updateTriggerButtonColor(DEVICE.RIGHT_CONTROLLER, BUTTON.SQUEEZE, false);
  updateTriggerButtonColor(DEVICE.LEFT_CONTROLLER, BUTTON.SELECT, false);
  updateTriggerButtonColor(DEVICE.LEFT_CONTROLLER, BUTTON.SQUEEZE, false);

  // secondly load new assets and enable necessary panel controls

  const hasTrackedControllers = !handheld;
  const hasHeadset = !! deviceDefinition.headset;
  const hasRightController = !!deviceDefinition.controllers && deviceDefinition.controllers.length > 0;
  const hasLeftController = !!deviceDefinition.controllers && deviceDefinition.controllers.length > 1;

  deviceCapabilities[DEVICE.HEADSET].hasPosition = hasHeadset && deviceDefinition.headset!.hasPosition;
  deviceCapabilities[DEVICE.HEADSET].hasRotation = hasHeadset && deviceDefinition.headset!.hasRotation;
  deviceCapabilities[DEVICE.CONTROLLER].hasPosition = hasRightController && deviceDefinition.controllers![0].hasPosition;
  deviceCapabilities[DEVICE.CONTROLLER].hasRotation = hasRightController && deviceDefinition.controllers![0].hasRotation;
  deviceCapabilities[DEVICE.CONTROLLER].hasSqueezeButton = hasRightController && deviceDefinition.controllers![0].hasSqueezeButton;

  const hasPosition = deviceCapabilities[DEVICE.HEADSET].hasPosition ||
    deviceCapabilities[DEVICE.CONTROLLER].hasPosition;

  if (hasTrackedControllers) {
    document.getElementById('stereoEffectLabel')!.style.display = '';
  }

  if (hasHeadset) {
    loadHeadsetAsset(handheld);
    document.getElementById('headsetComponent')!.style.display = 'flex';
    document.getElementById('exitButton')!.style.display = '';
  }

  if (hasRightController || hasLeftController) {
    loadControllersAsset(hasRightController, hasLeftController, handheld);
  }

  if (hasRightController) {
    document.getElementById('rightControllerComponent')!.style.display = 'flex';
    if (hasTrackedControllers) {
      document.getElementById('rightSelectButton')!.style.display = '';
    }
    if (deviceCapabilities[DEVICE.CONTROLLER].hasSqueezeButton) {
      document.getElementById('rightSqueezeButton')!.style.display = '';
    }
  }

  if (hasLeftController) {
    document.getElementById('leftControllerComponent')!.style.display = 'flex';
    if (hasTrackedControllers) {
      document.getElementById('leftSelectButton')!.style.display = '';
    }
    if (deviceCapabilities[DEVICE.CONTROLLER].hasSqueezeButton) {
      document.getElementById('leftSqueezeButton')!.style.display = '';
    }
  }

  if (hasHeadset || hasRightController || hasLeftController) {
    document.getElementById('resetPoseButton')!.style.display = '';
  }

  onResize();
  render();
};

const updateControllerColor = (key: string) => {
  const node = assetNodes[key];
  const pressed = states.buttonPressed[key][BUTTON.SELECT] || states.buttonPressed[key][BUTTON.SQUEEZE];
  node!.traverse(child => {
    const object = child as THREE.Object3D & {material?: THREE.Material & {emissive?: THREE.Color}};
    if (!object.material) {
      return;
    }
    // @TODO: Support material array?
    const material = object.material;
    // I tried .color first but the looking of the current controller
    // models didn't differ well with changing .color so using emissive instead for now.
    if (!material.emissive) {
      return;
    }
    if (material.userData.originalEmissive === undefined) {
      material.userData.originalEmissive = material.emissive.clone();
    }
    if (pressed) {
      // blue if button is being pressed
      // @TODO: what if the origial emissive is blue-ish?
      material.emissive.set(0x004e9c);
    } else {
      material.emissive.copy(material.userData.originalEmissive);
    }
  });
  render();
};

render();

// Raycasting for transform controls enable/disable

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mousedownTime = 0;
let intersectKey: string | null = null;
const thresholdTime = 300;

const raycast = (event: MouseEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  // left-top (0, 0), right-bottom (1, 1)
  const point = {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  };
  mouse.set(point.x * 2 - 1, -(point.y * 2) + 1);
  raycaster.setFromCamera(mouse, camera);
  const targetObjects = [];
  for (const key in assetNodes) {
    const node = assetNodes[key];
    if (node) {
      targetObjects.push(node);
    }
  }
  return raycaster.intersectObjects(targetObjects, true);
};

const getNearestIntersectedObjectKey = (event: MouseEvent): string | null => {
  // @TODO: Optimize
  const intersects = raycast(event);
  if (intersects.length === 0) {
    return null;
  }
  const intersect = intersects[0];
  let target: string | null = null;
  const check = (object: THREE.Object3D) => {
    for (const key in assetNodes) {
      const node = assetNodes[key];
      if (!node) {
        continue;
      }
      if (object === node) {
        target = key;
      }
    }
  };
  check(intersect.object);
  intersect.object.traverseAncestors(check);
  return target;
};

renderer.domElement.addEventListener('mousedown', event => {
  // Modern controls use pointer events, before compatibility mouse events.
  // A quick gizmo drag must not also count as a model click/mode switch.
  intersectKey = Object.values(transformControls).some(controls => controls?.dragging)
    ? null : getNearestIntersectedObjectKey(event);
  mousedownTime = performance.now();
}, false);

renderer.domElement.addEventListener('mouseup', event => {
  if (intersectKey === null) {
    return;
  }
  const currentTime = performance.now();
  if (currentTime - mousedownTime < thresholdTime) {
    toggleControlMode(intersectKey);
    // We add event listener to transformControls mouseUp event to set orbitControls.enabled true.
    // But if disabling transformControls, its mouseUp event won't be fired.
    // Then setting orbitControls.enabled true here as workaround.
    orbitControls.enabled = true;
  }
}, false);

// event handlers

const updateDevicePropertyContent = (positionId: string, rotationId: string, position: THREE.Vector3, rotation: THREE.Euler) => {
  document.getElementById(positionId)!.textContent =
    position.x.toFixed(2) + ' ' + position.y.toFixed(2) + ' ' + position.z.toFixed(2);
  document.getElementById(rotationId)!.textContent =
    rotation.x.toFixed(2) + ' ' + rotation.y.toFixed(2) + ' ' + rotation.z.toFixed(2);
};

const updateHeadsetPropertyComponent = () => {
  const headset = assetNodes[DEVICE.HEADSET];
  if (!headset) { return; }
  updateDevicePropertyContent('headsetPosition', 'headsetRotation',
    headset.position, headset.rotation);
};

const updateControllerPropertyComponent = (key: string) => {
  const controller = assetNodes[key];
  if (!controller) { return; }
  updateDevicePropertyContent(
    key === DEVICE.RIGHT_CONTROLLER ? 'rightControllerPosition' : 'leftControllerPosition',
    key === DEVICE.RIGHT_CONTROLLER ? 'rightControllerRotation' : 'leftControllerRotation',
    controller.position, controller.rotation
  );
};

const updateTriggerButtonColor = (key: string, buttonKey: number, pressed: boolean) => {
  let buttonId = key === DEVICE.RIGHT_CONTROLLER ? 'right' : 'left';
  buttonId += buttonKey === BUTTON.SELECT ? 'Select' : 'Squeeze';
  buttonId += 'Button';
  const button = document.getElementById(buttonId)!;
  button.classList.toggle('pressed', pressed);
};

// Show/Hide device property component

for (const component of document.querySelectorAll<HTMLElement>('.device-property-component')) {
  // Expects device-property-component class has a title-bar class element and
  // a device-property-content class element as children
  const title = component.querySelector<HTMLElement>('.title-bar')!;
  const content = component.querySelector<HTMLElement>('.device-property-content')!;
  const icon = title.getElementsByClassName('icon')[0];
  title.addEventListener('click', event => {
    if (content.style.display === 'none') {
      icon.innerHTML = '&#9660;';
      content.style.display = 'flex';
    } else {
      icon.innerHTML = '&#9654;';
      content.style.display = 'none';
    }
  });
}

document.getElementById('devicePropertiesExpandIcon')!.addEventListener('click', event => {
  const component = document.getElementById('devicePropertiesComponent')!;
  if (component.style.display === 'none') {
    component.style.display = 'flex';
    (event.currentTarget as HTMLElement).innerHTML = '&#9660;';
  } else {
    component.style.display = 'none';
    (event.currentTarget as HTMLElement).innerHTML = '&#9654;';
  }
  onResize();
}, false);

window.addEventListener('resize', event => {
  onResize();
}, false);

const toggleControlMode = (key: string) => {
  const controls = transformControls[key];
  if (!controls) {
    return;
  }
  // Translate -> Rotate -> Disable -> Translate -> ...
  if (!controls.enabled) {
    controls.enabled = true;
    controls.getHelper().visible = true;
    controls.setMode('translate');
  } else if (controls.getMode() === 'translate') {
    controls.setMode('rotate');
  } else {
    controls.enabled = false;
    controls.getHelper().visible = false;
  }
  setupTransformControlsMode(controls,
    deviceCapabilities[key === DEVICE.HEADSET ? key : DEVICE.CONTROLLER]);
  render();
};

const toggleButtonPressed = (key: string, buttonKey: number) => {
  states.buttonPressed[key][buttonKey] = !states.buttonPressed[key][buttonKey];
  const pressed = states.buttonPressed[key][buttonKey];
  notifyInputButtonPressed(key, buttonKey, pressed);
  updateTriggerButtonColor(key, buttonKey, pressed);
  updateControllerColor(key);
};

document.getElementById('rightSelectButton')!.addEventListener('click', event => {
  toggleButtonPressed(DEVICE.RIGHT_CONTROLLER, BUTTON.SELECT);
}, false);

document.getElementById('leftSelectButton')!.addEventListener('click', event => {
  toggleButtonPressed(DEVICE.LEFT_CONTROLLER, BUTTON.SELECT);
}, false);

document.getElementById('rightSqueezeButton')!.addEventListener('click', event => {
  toggleButtonPressed(DEVICE.RIGHT_CONTROLLER, BUTTON.SQUEEZE);
}, false);

document.getElementById('leftSqueezeButton')!.addEventListener('click', event => {
  toggleButtonPressed(DEVICE.LEFT_CONTROLLER, BUTTON.SQUEEZE);
}, false);

document.getElementById('resetPoseButton')!.addEventListener('click', event => {
  for (const key in assetNodes) {
    const device = assetNodes[key];

    if (!device) {
      continue;
    }

    let defaultTransformKey = key;
    // @TODO: Simplify
    if (states.handheld) {
      defaultTransformKey = key === DEVICE.RIGHT_CONTROLLER ? DEVICE.POINTER :
                            key === DEVICE.LEFT_CONTROLLER ? DEVICE.TABLET :
                            key;
    }
    device.position.copy(defaultTransforms[defaultTransformKey].position);
    device.rotation.copy(defaultTransforms[defaultTransformKey].rotation);
  }
  updateHeadsetPropertyComponent();
  updateControllerPropertyComponent(DEVICE.RIGHT_CONTROLLER);
  updateControllerPropertyComponent(DEVICE.LEFT_CONTROLLER);
  notifyPoses();
  render();
}, false);

document.getElementById('exitButton')!.addEventListener('click', event => {
  notifyExitImmersive();
}, false);

// copy values to clipboard on click
const onTransformFieldClick = (event: Event) => {
  const el = event.currentTarget as HTMLElement;
  navigator.clipboard.writeText(el.innerHTML.split(' ').join(', '));
}

for (const field of document.querySelectorAll<HTMLElement>('.value')) {
  field.addEventListener('click', onTransformFieldClick, false);
  field.title = 'Click to copy to clipboard';
}

// setup configurations and start
// 1. load external devices.json file
// 2. set up dom elements from it
// 3. load configuration from storage and load assets

ConfigurationManager.createFromJsonFile('src/devices.json').then(manager => {
  const deviceSelect = document.getElementById('deviceSelect') as HTMLSelectElement;
  const overlayLayout = document.getElementById('domOverlayPreviewLayout') as HTMLSelectElement;
  const overlayCheckbox = document.getElementById('domOverlayPreviewCheckbox') as HTMLInputElement;
  const stereoCheckbox = document.getElementById('stereoCheckbox') as HTMLInputElement;

  // set up devices select element

  const questModeSelect = document.getElementById('questModeSelect') as HTMLSelectElement;
  const devices = manager.devices;
  const deviceKeys = Object.keys(devices);
  for (const key of deviceKeys) {
    const deviceDefinition = devices[key];
    const option = document.createElement('option');
    option.text = deviceDefinition.name;
    option.value = key;
    if (key === manager.defaultDeviceKey) {
      option.selected = true;
    }
    deviceSelect.add(option);
  }

  // setup stereo effect checkbox element

  stereoCheckbox.checked = manager.defaultStereoEffect;

  // update assets and store configuration if selects are changed

  const onChange = () => {
    const deviceKey = deviceSelect.options[deviceSelect.selectedIndex].value;
    const stereoEffect = stereoCheckbox.checked;

    const deviceKeyIsUpdated = manager.updateDeviceKey(deviceKey);
    const stereoEffectIsUpdated = manager.updateStereoEffect(stereoEffect);
    const overlayLayoutIsUpdated = manager.updateDOMOverlayPreviewFlat(overlayLayout.value === 'screen');
    const overlayIsUpdated = manager.updateDOMOverlayPreview(overlayCheckbox.checked);
    const modeIsUpdated = manager.updateQuestMode(questModeSelect.value as 'immersive-vr' | 'immersive-ar');

    if (deviceKeyIsUpdated || modeIsUpdated || stereoEffectIsUpdated || overlayIsUpdated || overlayLayoutIsUpdated) {
      manager.storeToStorage().then(storedValues => {
        // console.log(storedValues);
      });
    }

    if (deviceKeyIsUpdated || modeIsUpdated || overlayIsUpdated || overlayLayoutIsUpdated) {
      notifyDeviceChange(manager.deviceDefinition);
      updateAssetNodes(manager.deviceDefinition);
    }

    if (stereoEffectIsUpdated) {
      notifyStereoEffectChange(stereoEffect);
    }
  };

  deviceSelect.addEventListener('change', onChange);
  questModeSelect.addEventListener('change', onChange);
  stereoCheckbox.addEventListener('change', onChange);
  overlayCheckbox.addEventListener('change', onChange);
  overlayLayout.addEventListener('change', onChange);

  // load configuration and then load assets

  manager.loadFromStorage().then(result => {
    const deviceKey = manager.deviceKey;
    const stereoEffect = manager.stereoEffect;

    for (let index = 0; index < deviceSelect.children.length; index++) {
      const option = deviceSelect.options[index];
      if (option.value === deviceKey) {
        deviceSelect.selectedIndex = index;
        break;
      }
    }

    overlayCheckbox.checked = manager.domOverlayPreview;
    overlayLayout.value = manager.domOverlayPreviewFlat ? 'screen' : 'auto';
    questModeSelect.value = manager.questMode;
    stereoCheckbox.checked = stereoEffect;
    updateAssetNodes(manager.deviceDefinition);
  });
}).catch(error => {
  console.error(error);
});
