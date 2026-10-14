/** The small public WebXR surface exercised by the browser regression sample. */
import type { SessionMode } from '../src/types/contracts';
interface Transform { matrix: ArrayLike<number> }
interface Pose { transform: Transform }
interface Space {}
interface InputSource { handedness: string; gripSpace: Space; targetRaySpace: Space }
interface HitResult { getPose(space: Space): Pose | null }
interface Frame {
  getViewerPose(space: Space): (Pose & {views: {transform: Transform}[]}) | null;
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
  frames: number;
  viewerPosition: number[];
  inputPositions: Record<string, number[]>;
  events: Record<string, number>;
  hits: number;
  hitPosition: number[] | null;
  transientHits: number;
  ended: boolean;
  errors: string[];
}
export interface SmokeWindow extends Window {
  navigator: Navigator & {xr: {requestSession(mode: SessionMode, options: {requiredFeatures: string[]}): Promise<Session>}};
  XRWebGLLayer: new (session: Session, context: WebGLRenderingContext) => object;
  XRRigidTransform: new (position?: DOMPointInit) => {matrix: Float32Array};
  XRRay: new (transform?: {matrix: Float32Array}) => {origin: DOMPointReadOnly; direction: DOMPointReadOnly};
  smoke: {
    state: SmokeState;
    start(mode: SessionMode): Promise<void>;
    stop(): Promise<void>;
    cancelHitTests(): void;
  };
}

export interface PanelProbeWindow extends Window {
  panelProbe?: {
    renderer: import('three').WebGLRenderer;
    scene: import('three').Scene;
    camera: import('three').Camera;
  };
}
