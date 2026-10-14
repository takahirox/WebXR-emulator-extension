import type { EmulatorEvents } from './contracts';
import type * as Three from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls';

declare global {
  function cloneInto<T>(value: T, target: Window): T;
  function WebXRPolyfillInjection(): void;
  interface Window { THREE: typeof Three & { GLTFLoader: typeof GLTFLoader; OBJLoader: typeof OBJLoader; OrbitControls: typeof OrbitControls; TransformControls: typeof TransformControls }; }
  interface WindowEventMap extends CustomEvents {}
  interface WebGLRenderingContext { makeXRCompatible(): Promise<void> }
  interface WebGL2RenderingContext { makeXRCompatible(): Promise<void> }
}
type CustomEvents = {[K in keyof EmulatorEvents]: CustomEvent<EmulatorEvents[K]>};
