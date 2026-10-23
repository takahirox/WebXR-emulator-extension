/** The small public WebXR surface exercised by the browser regression sample. */
import type { SessionMode } from '../src/types/contracts';
interface Transform { matrix: ArrayLike<number> }
interface Pose { transform: Transform }
interface Space {}
interface InputSource { targetRayMode: string; profiles: string[]; handedness: string; gripSpace: Space; targetRaySpace: Space }
interface HitResult { getPose(space: Space): Pose | null }
interface Frame {
  getViewerPose(space: Space): (Pose & {views: {eye: string; projectionMatrix: ArrayLike<number>; transform: Transform}[]}) | null;
  getPose(space: Space, reference: Space): Pose | null;
  getHitTestResults(source: object): HitResult[];
  getHitTestResultsForTransientInput(source: object): {results: HitResult[]}[];
}
interface Session {
  inputSources: InputSource[];
  end(): Promise<void>;
  updateRenderState(state: {baseLayer: object}): void;
  requestReferenceSpace(type: string): Promise<Space>;
  requestAnimationFrame(callback: (time: number, frame: Frame) => void): number;
  requestHitTestSource(options: {space: Space}): Promise<{cancel(): void}>;
  requestHitTestSourceForTransientInput(options: {profile: string}): Promise<{cancel(): void}>;
  addEventListener(type: string, callback: () => void): void;
}
export interface SmokeState {
  synchronousXR: boolean;
  startupSessionError?: string;
  synchronousGlobals: boolean;
  overridesNativeXR: boolean;
  frames: number;
  views: {eye: string; x: number; projection: number; viewport: {x: number; y: number; width: number; height: number}}[];
  framebuffer: {width: number; height: number};
  inputModes: string[];
  viewerPosition: number[];
  inputPositions: Record<string, number[]>;
  events: Record<string, number>;
  eventOrder: string[];
  hits: number;
  hitPosition: number[] | null;
  transientHits: number;
  ended: boolean;
  errors: string[];
}
export interface SmokeWindow {
  navigator: Omit<Navigator, 'xr'> & {xr: {isSessionSupported(mode: SessionMode): Promise<boolean>; requestSession(mode: SessionMode, options: {requiredFeatures: string[]}): Promise<Session>}};
  XRWebGLLayer: new (session: Session, context: WebGLRenderingContext) => {readonly framebuffer: WebGLFramebuffer | null; readonly framebufferWidth: number; readonly framebufferHeight: number; getViewport(view: object): {x: number; y: number; width: number; height: number}};
  XRRigidTransform: new (position?: DOMPointInit) => {matrix: Float32Array};
  XRRay: new (transform?: {matrix: Float32Array}) => {origin: DOMPointReadOnly; direction: DOMPointReadOnly};
  smoke: {
    state: SmokeState;
    start(mode: SessionMode): Promise<void>;
    stop(): Promise<void>;
    cancelHitTests(): void;
    setTextureMode(mode: 'default' | 'transparent' | 'pattern'): void;
  };
}

export interface PanelProbeWindow extends Window {
  roomViews?: {
    width: number;
    height: number;
    viewport: number[];
    scissor: number[];
    scissorTest: boolean;
    projection: number;
  }[];
  panelProbe?: {
    renderer: import('three').WebGLRenderer;
    scene: import('three').Scene;
    camera: import('three').Camera;
  };
}
