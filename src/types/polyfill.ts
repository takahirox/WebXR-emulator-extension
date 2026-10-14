import type XRSpace from 'webxr-polyfill/src/api/XRSpace';
import type XRSession from 'webxr-polyfill/src/api/XRSession';
import type XRRay from '../polyfill/api/XRRay';

export type PolyfillGlobal = Window & typeof globalThis;
export interface SessionOptions { requiredFeatures?: string[]; optionalFeatures?: string[]; domOverlay?: {root: HTMLElement} }
export interface HitTestOptions { space: XRSpace; offsetRay?: XRRay; entityTypes?: string[] }
export interface TransientHitTestOptions { profile: string; offsetRay?: XRRay; entityTypes?: string[] }
export interface BaseLayer { context: (WebGLRenderingContext | WebGL2RenderingContext) & {canvas: HTMLCanvasElement} }
export interface RenderState { depthNear: number; depthFar: number; inlineVerticalFieldOfView: number }
export interface Viewport { x: number; y: number; width: number; height: number }
export interface HitTestState { session: XRSession; space: XRSpace; offsetRay: XRRay; active: boolean }
export interface TransientHitTestState { session: XRSession; profile: string; offsetRay: XRRay; active: boolean }
