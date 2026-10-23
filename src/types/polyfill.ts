import type {XRSpace} from '../polyfill/api/geometry';
import type {XRSession} from '../polyfill/api/runtime';
import type XRRay from '../polyfill/api/XRRay';

export type PolyfillGlobal = Window & typeof globalThis;
/** Converted XRSessionInit snapshot; caller values enter the API as unknown. */
export interface SessionOptions { requiredFeatures?: string[]; optionalFeatures?: string[]; domOverlay?: {root: Element} | null; depthSensing?: {usagePreference: string[]; dataFormatPreference: string[]; depthTypeRequest?: string[]; matchDepthView: boolean} }
export interface HitTestOptions { space: XRSpace; offsetRay?: XRRay; entityTypes?: string[] }
export interface TransientHitTestOptions { profile: string; offsetRay?: XRRay; entityTypes?: string[] }
export interface BaseLayer { context: (WebGLRenderingContext | WebGL2RenderingContext); readonly framebufferWidth: number; readonly framebufferHeight: number; readonly _presentationCanvas: HTMLCanvasElement | OffscreenCanvas }
export interface RenderState { depthNear: number; depthFar: number; inlineVerticalFieldOfView: number }
export interface Viewport { x: number; y: number; width: number; height: number }
export interface HitTestState { session: XRSession; space: XRSpace; offsetRay: XRRay; active: boolean }
export interface TransientHitTestState { session: XRSession; profile: string; offsetRay: XRRay; active: boolean }
