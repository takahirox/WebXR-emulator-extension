# WebXR API inventory — revision 2 (2026-10-20)

This records the consolidated simulation pass for [Issue #19](https://github.com/takahirox/WebXR-emulator-extension/issues/19) and the earlier implementation for [Issue #11](https://github.com/takahirox/WebXR-emulator-extension/issues/11). It describes **simulated capabilities**, not Quest/ARCore hardware certification or a claim of full WPT conformance. The API implementation is maintained in strict TypeScript under `src/polyfill/api/`; the former Git dependency and private `webxr-polyfill` imports have been removed. The packaged entry point remains `polyfill/webxr-polyfill.js` for manifest compatibility.

## Specification baseline

The following published revisions were checked on 2026-10-16; the Device, Layers, Depth, Anchors and Lighting references were rechecked for the 2026-10-20 pass. Working and Editor's Drafts remain proposals subject to change.

| API | Pinned reference | Status |
| --- | --- | --- |
| Device API | [9 June 2026](https://www.w3.org/TR/2026/CRD-webxr-20260609/) | Candidate Recommendation Draft |
| AR | [25 April 2025](https://www.w3.org/TR/2025/CRD-webxr-ar-module-1-20250425/) | Candidate Recommendation Draft |
| Hit test | [11 December 2025](https://www.w3.org/TR/2025/WD-webxr-hit-test-1-20251211/) | Working Draft |
| DOM overlays | [24 September 2024](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/) | Working Draft |
| Gamepads | [7 July 2025](https://www.w3.org/TR/2025/WD-webxr-gamepads-module-1-20250707/) | Working Draft |
| Hand input | [5 June 2024](https://www.w3.org/TR/2024/WD-webxr-hand-input-1-20240605/) | Working Draft |
| Layers | [11 August 2026](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/) | Working Draft |
| Depth | [25 August 2026](https://www.w3.org/TR/2026/WD-webxr-depth-sensing-1-20260825/) | Working Draft |
| Anchors | [27 April 2026 ED](https://immersive-web.github.io/anchors/), [source d9c6266](https://github.com/immersive-web/anchors/tree/d9c6266d5e28caf98bff046dcbba31abd0b6d3f1) | Editor's Draft |
| Lighting | [11 December 2025 ED](https://immersive-web.github.io/lighting-estimation/), [source 67af0d5](https://github.com/immersive-web/lighting-estimation/tree/67af0d5eaaf5a41273c403dff5bccc33004c7d04) | Editor's Draft |

Additional drafts inspected on 2026-10-20 (source hashes pin the exact reviewed revision):

| API | Pinned reference | Status |
| --- | --- | --- |
| Plane Detection | [30 March 2026 ED](https://immersive-web.github.io/plane-detection/), [394f13ee76d31f3885eb1237777cf2ecb1b87cbc](https://github.com/immersive-web/plane-detection/tree/394f13ee76d31f3885eb1237777cf2ecb1b87cbc) | Editor's Draft |
| Mesh Detection | [2 February 2026](https://immersive-web.github.io/real-world-meshing/), [539768590eb39cdff665d8e7a63f37b85eb6440b](https://github.com/immersive-web/real-world-meshing/tree/539768590eb39cdff665d8e7a63f37b85eb6440b) | Draft Community Group Report |
| Marker/Image Tracking | [current draft](https://immersive-web.github.io/image-tracking/), [5c2eebf3e8b2be93ce8788c72206db9ee08d50a2](https://github.com/immersive-web/image-tracking/tree/5c2eebf3e8b2be93ce8788c72206db9ee08d50a2) | Draft; current descriptor is `marker-tracking`, not historical `image-tracking` |
| Raw Camera Access | [draft](https://immersive-web.github.io/raw-camera-access/), [52d2f29b8a42f935646170143905b0117998db4b](https://github.com/immersive-web/raw-camera-access/tree/52d2f29b8a42f935646170143905b0117998db4b) | Draft Community Group Report |
| WebXR/WebGPU Binding | [draft](https://immersive-web.github.io/webxr-webgpu-binding/), [395bb2280c52c9874e3b6bb95e53ff0b99f97c5f](https://github.com/immersive-web/webxr-webgpu-binding/tree/395bb2280c52c9874e3b6bb95e53ff0b99f97c5f) | Draft module |
| Secondary views / observer view | Device and AR published revisions above | Core Device / AR behavior, not a separate standalone module |
| Haptics | [Gamepad](https://www.w3.org/TR/gamepad/), [81ad0752c4dd06011722b158314eef68cbc2460d](https://github.com/w3c/gamepad/tree/81ad0752c4dd06011722b158314eef68cbc2460d), [legacy extensions](https://w3c.github.io/gamepad/extensions.html) | Gamepad/platform APIs, not a WebXR feature descriptor |

## Negotiated capability matrix

`I` means implemented within the limits below; `—` means unsupported. Quest VR and MR are mutually exclusive panel modes. Phone VR is unsupported. Both profiles also support inline sessions with only the default `viewer` feature and a monoscopic `none` view. Unsupported required features reject with `NotSupportedError`; unsupported optional features are omitted from the frozen `session.enabledFeatures` array. Constructors being present do not grant a feature.

| Capability / feature descriptor | Quest VR | Quest MR (`immersive-ar`) | Android AR |
| --- | --- | --- | --- |
| `viewer`, `local` | I | I | I |
| `local-floor` (explicit request) | I | I | I |
| `unbounded` (explicit request; fixed virtual origin) | I | I | I |
| `bounded-floor` | — | — | — |
| Two stereo views, tracked controllers | I | I | — |
| Single `none` view, transient screen input | — | — | I |
| `hit-test` (plane/mesh room intersections) | — | I | I |
| `dom-overlay` | — | Opt-in desktop preview only | Opt-in phone/desktop preview only |
| `anchors` (session lifetime) | — | I | I |
| `hand-tracking` (deterministic skeletons) | I | I | — |
| `layers` (WebGL2 projection + mono quad) | I | I | I |
| `depth-sensing` (CPU, float32 / unsigned-short / luminance-alpha) | — | I | I |
| `light-estimation` (virtual room light) | — | I | I |
| `plane-detection`, `mesh-detection` (room triangle patches) | — | I | I |
| GPU depth, marker/image tracking, camera access, secondary views, WebGPU, haptics | — | — | — |

Profile declarations in [devices.json](../src/devices.json) are constrained further by `EmulatedXRDevice.isFeatureSupported(feature, mode)`. Inline sessions cannot enable the immersive modules. WebGL1 remains usable with `XRWebGLLayer`; composition layers require WebGL2. Requesting `layers` does not imply that every layer type or texture format is supported.

## Consolidated triage and decisions (Issue #19)

This is the single status matrix for the investigated surface. “Implemented” means useful deterministic simulation within the documented scope, not native hardware conformance. QVR = Quest VR; QMR = Quest MR; AAR = Android AR. All new sensing capabilities exclude inline and QVR. The [publication handoff](issue-19-pr-comment.md) contains the required top-level PR blocker comment text; that local file does **not** satisfy the requirement to post the comment before merge.

| Module / operation | Applicable modes | Required core behavior | Feasibility and decision |
| --- | --- | --- | --- |
| Plane Detection | QMR, AAR | `detectedPlanes`, setlike, polygon, normal-aligned space, orientation, timestamps, lifecycle, `initiateRoomCapture()` | **Implemented** using room triangle patches; automatic capture completes once; no manual sensor capture, semantic classifier or merged room surfaces |
| Mesh Detection | QMR, AAR | `detectedMeshes`, indexed vertices, normal-aligned space, timestamps, lifecycle | **Implemented** using the same room patches; no reconstruction/recognition |
| `unbounded` reference space | QVR, QMR, AAR | Negotiation, fixed world origin, offset composition, unrestricted virtual viewer translation | **Implemented**; origin at initial local eye height; no drift/relocalization or promise of infinite scene geometry |
| `bounded-floor` reference space | QVR, QMR, AAR | `XRBoundedReferenceSpace`, usable floor boundary and inverse-transformed offset bounds | **Unsupported/deferred**; hall geometry is not an authored safe-play boundary. Derive/author and validate a walkable polygon first; required rejects, optional omitted |
| Marker/Image Tracking | QMR, AAR | `trackedImages`, trackability, target index/width, `imageSpace`, tracked/emulated/lost states | **Unsupported/deferred**; current draft changed descriptor and trackability API, and the scene/config bridge has no target identity/pose/visibility model. A deliberate opt-in target registry plus application-image association and panel controls is prerequisite. Both `marker-tracking` and legacy `image-tracking` reject/omit |
| Anchors / persistence | QMR, AAR | Frame/hit/surface anchor spaces; durable handle enumeration, restore/delete | **Partially implemented**; session anchors work. Persistence needs origin-scoped bounded storage, room identity/version and deletion/relocalization policy; handles reject, enumeration empty |
| CPU Depth formats | QMR, AAR | Preference negotiation, view-aligned samples, raw scaling, access lifetime | **Implemented** float32 meters and both 16-bit millimeter formats; out-of-range 16-bit depths are unknown (zero) |
| GPU Depth | QMR, AAR | Owned per-view WebGL depth textures, binding access/lifetime/state restoration | **Unsupported/deferred**; existing CPU raycast does not supply a texture upload/resource path. Implement and pixel-test R32F/R16UI resources first; required GPU-only preference rejects, optional omitted, binding access rejects |
| Lighting / reflections | QMR, AAR | SH/direction/intensity; reflection cubemap, format negotiation and change events | **Partially implemented**; deterministic light works. Room cubemap rendering needs six offscreen views, texture lifecycle and GL-state tests; cubemap remains null, no change event, rgba16f rejects |
| Layers: projection, mono quad | QVR, QMR, AAR | Real textures/subimages, placement, composition, destruction | **Partially implemented**; existing paths preserved and DEPTH_STENCIL/DEPTH24_STENCIL8 added. See next row for outstanding variants |
| Layers: cylinder/equirect/cube/media, arrays, static/mipmapped, alternate formats, depth/cross-context composition | QVR, QMR, AAR | Curved/environment projection, stereo/array allocation, media synchronization, format/depth handling | **Unsupported/deferred**; compositor currently samples 2D RGBA8 quads/projections, not curved/cube/media or array resources. Add one rendering/allocation path with output-pixel tests at a time; creation/unsupported options reject. Native opaque-texture guarantees remain unavailable |
| Raw Camera Access | QMR, AAR | Camera-aligned image/pose and owned frame texture, permissions semantics | **Unsupported/deferred**; no tracking camera exists and physical camera access is out of scope. Needs an explicitly synthetic camera design and aligned render target, never a pretend physical feed; required rejects, optional omitted, camera APIs absent |
| Secondary/observer views | Primarily Quest; potentially AAR | Capture-driven additional views and separate per-view viewport/subimage composition | **Unsupported/deferred**; no capture source or multi-view allocator/compositor beyond mono/stereo. Add an opt-in virtual observer and generalized allocation first; required rejects, optional omitted, observer flag false |
| WebXR/WebGPU binding | QVR, QMR, AAR | `XRGPUBinding`, GPU-owned projection/depth textures, submission/composition | **Unsupported/deferred**; presentation is WebGL/Three.js, with no WebGPU compositor. Requires a separate verifiable rendering backend; required `webgpu` rejects, optional omitted, binding absent |
| Gamepad haptics | Quest controllers; phone has no gamepad | Actuator effects/cancellation/results, or an explicitly visual simulation | **Unsupported/deferred** for Quest; **not applicable** to phone. Virtual controllers have no actuator/output controls; add observable panel feedback before claiming an actuator. No haptic actuators exposed; no WebXR `haptics` descriptor |
| DOM Overlay | QMR, AAR | Existing opt-in original-root desktop preview; full UA CSS/input/stereo/security semantics beyond preview | **Partially implemented**; preserve Issue #17 preview. Native compositor/pseudo-class/security enforcement cannot be supplied by the page polyfill; preview only, rejects/omits ineligible requests. Broader work needs UA support or a separately validated design |
| Broader core/IDL/permissions and native opaque buffers | All | Complete WebIDL conversion, native permission/opaque-resource behavior | **Partially implemented**; focused API tests and selected WPT only. Main-world emulation cannot enforce native opaque resources/permissions; broaden WPT/IDL and ownership coverage without claiming native enforcement |

## Implemented behavior and limits

### Sessions, frames, spaces and legacy rendering

[Session initialization](https://www.w3.org/TR/2026/CRD-webxr-20260609/#dom-xrsystem-requestsession), [frames](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrframe-interface), and [reference spaces](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrreferencespace-interface) guide the focused assertions in [conformance.ts](../tests/conformance.ts). Both system entry points wait for asynchronous configuration. Immersive requests require transient user activation, exclude concurrent/pending immersive sessions, and release that exclusion after end or failed negotiation. Inline sessions are hidden while immersive presentation is active. Document visibility produces `visibilitychange`; showing the document keeps inline sessions hidden until immersive presentation ends. No synthetic tracking loss or `visible-blurred` state is generated.

Animation callbacks run in registration order with cancellation, one active frame and one monotonic desktop RAF timestamp. Event frames permit poses but reject `getViewerPose`. Stored frames and hit/depth results reject access after their callback. Spaces, sources, probes, layers and views have session/frame ownership checks. Ending a session stops its loop, drops callbacks/inputs, deactivates hit sources, deletes anchors, releases layer GL resources, and restores canvas state. A profile/mode change ends active presentation before replacing the device. [Session shutdown](https://www.w3.org/TR/2026/CRD-webxr-20260609/#session-shutdown) queues the public `end` event and promise resolution; ending inside an input handler preserves the identity for the current action's paired events, then stops further input/frame processing.

`XRRigidTransform` validates finite components, point `w`, and nonzero normalizable quaternions, and caches the inverse. Offset spaces compose in world coordinates, including when used as either argument of `getPose`. The room floor is world Y=0; local eye height is 1.6 m. `emulatedPosition` is true, velocities are unavailable. Quest views have left/right eye transforms; the existing stereo-disable setting preserves its single-output viewport behavior. The phone follows the virtual tablet. Projection, physical drawing-buffer dimensions, viewport layout and MR DPR/resize behavior retain the existing regression checks. Legacy rendering uses the canvas default framebuffer, cleared each immersive frame with application GL state restored.

### Environmental geometry and navigation

Request `plane-detection` and/or `mesh-detection` for Quest MR or Android AR. The packaged hall's nondegenerate triangles become tracked patches; the decorative sky is excluded consistently from detection, Hit Test and depth. These are useful renderable surface patches, **not** recognized whole walls, merged polygons, scanned meshes or physical sensors. `semanticLabel` is null. Plane polygons are frozen point arrays with Y=0 in plane space; mesh data uses Float32 vertices and Uint32 triangle indices. Both origins are triangle centroids, with +Y along the world face normal. Orientation is horizontal/vertical within a small numerical tolerance, otherwise null.

Objects and spaces retain identity while their source mesh/triangle is present. Each active frame gets read-only membership snapshots. Shape/orientation changes update `lastChangedTime`; pure pose/viewer changes do not. Room removal drops tracking (old spaces return null), reacquisition creates fresh objects, and session end clears identities. Frame getters require an active frame; disabled detection returns empty sets. Foreign-session spaces reject through `getPose`. Surface spaces work with offset reference spaces and anchor creation. `initiateRoomCapture()` follows the draft's automatic-capture branch: it resolves once with plane detection enabled and rejects repeated calls with `InvalidStateError`; it never triggers a camera or capture UI.

`unbounded` must be requested explicitly. It shares the fixed local origin at Y=1.6 m, supports offset composition and arbitrary virtual viewer translation without clamping/recentering, and does not imply endless room geometry or physical tracking. `bounded-floor` remains unsupported because the room asset supplies no safe-play boundary.

### Hit tests and DOM interaction

[Hit test source/results algorithms](https://www.w3.org/TR/2025/WD-webxr-hit-test-1-20251211/#hit-test-source) drive feature, lifecycle, cancellation and error checks. The packaged room is the sensed environment. Plane and mesh queries intersect its polygon surfaces, return nearest-first intersections, apply `offsetRay` in the source's effective space and retain the transformed face normal as pose +Y. Point-cloud queries reject because there is no point cloud. Repeated cancellation throws `InvalidStateError`. A cancelled source remains in an already-created frame's snapshot, but is absent from subsequent frames. A transient query matches `generic-touchscreen` exactly and produces results only for the associated active screen source; Quest has no transient touchscreen.

[Issue #17](https://github.com/takahirox/WebXR-emulator-extension/issues/17) introduces an explicitly opt-in **Interactive DOM Overlay Preview**, disabled by default. It deliberately has a smaller product scope than the [DOM Overlays Module](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/). In the WebXR DevTools panel, enable the preview and select Android AR or Quest MR, then use existing application requests:

```js
await navigator.xr.requestSession('immersive-ar', {
  optionalFeatures: ['dom-overlay'],
  domOverlay: {root: document.getElementById('overlay')}
});
```

Eligible connected HTML roots in the current document's body/light tree are presented as the original live DOM in the native popover top layer, with no reparenting/copying. Android uses phone projection, falling back to a flat panel for body roots/fixed descendants (or choose **Android layout → Flat desktop panel** for small/complex UI); Quest uses one flat foreground desktop panel. Native desktop click, checkbox, keyboard/input/change, focus and scrolling work through the browser. No preview pointer is converted to an XR touch, controller pose, synthetic DOM event or `beforexrselect`. No privileged bridge or iframe/sandbox/shadow security bypass is provided. Existing non-overlay XR paths continue to work.

Required/optional `dom-overlay` requests enable the preview only with opt-in, a supported immersive AR profile/mode, popover availability and an eligible root. Enabled features include the descriptor; state is a frozen `{type: 'screen'}` retained after end. With opt-in off or an unsupported root/mode, required requests reject with `NotSupportedError`, optional requests omit with null state, and the root is untouched. Canceled/failed popover presentation restores root styles/attributes and follows the same required/optional policy. Malformed root brands reject with `TypeError` during conversion, regardless of opt-in. Inline/Quest VR, foreign-document/disconnected/SVG/document-element/embedded/replaced-control roots, shadow-tree roots, existing popovers, inert ancestors and active modal documents are declined. Changes to profile, mode or opt-in end the active session. End, removal/reparenting, pagehide and extension invalidation release resources and restore the startup style snapshot without changing app ownership.

**Standards compliance remains unfinished:** `:xr-overlay` never matches; there are no native XR UA styles/backdrop/fullscreen guarantees, world-space rays, XR-driven cross-origin forwarding restrictions, exact eye composition or full CSS/viewport emulation. Ordinary browser boundaries apply because the preview never forwards XR input into descendants. Root layout uses temporary inline styles and preview dimensions; viewport units/media queries remain desktop-based. Arbitrary custom elements, closed shadows and iframe controls are unvalidated. This is practical display/interaction support, not a standards-conformant DOM Overlay implementation. See [usage](../README.md#interactive-dom-overlay-preview-opt-in) and [implementation/validation](dom-overlay-preview.md). Administratively closed Issues #13/#15 did not complete their full standards acceptance; those gaps are preserved for future enhancement.

### Controllers, touch and hands

The [Quest Touch Plus registry profile](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/meta/meta-quest-touch-plus.json) supplies `meta-quest-touch-plus`, `oculus-touch-v3`, `oculus-touch`, and generic fallbacks. Trigger/squeeze are buttons 0/1, button 2 is an inert placeholder, and joystick axes are 2/3 after the required placeholders. Gamepads retain identity, expose frozen per-frame state and hide identifying IDs. The existing panel supplies trigger/squeeze state; haptics are absent. Transient phone sources expose `screen`, handedness `none`, no grip/gamepad, and a fresh source identity per touch. Added-source events precede `selectstart`; `select`, `selectend` precede removal. Release-event poses retain the final tracked input transform.

When Quest sessions explicitly enable [hand input](https://www.w3.org/TR/2024/WD-webxr-hand-input-1-20240605/#xrhand-interface), both input sources use `generic-hand-select` with 25 ordered joints. The controller pose moves the hand; the panel trigger curls its fingers. Joint spaces, radii, poses and bulk pose/radius fills are implemented. Without that feature controllers have `hand === null`; the phone cannot negotiate it. This is a reproducible skeleton, not optical tracking, and does not simulate hand/controller switching within an active session.

### Anchors, depth and light

[Anchor creation](https://immersive-web.github.io/anchors/#anchor-creation) from frames and hit results retains a world-space transform independently of viewer motion. Subsequent frames expose a read-only anchor set. Deleted anchors lose tracking; accessing their `anchorSpace` throws. Session end deletes all anchors. Persistent anchor handles/storage are explicitly unsupported (`NotSupportedError`); there is no claim of cross-session relocalization.

[Depth configuration](https://www.w3.org/TR/2026/WD-webxr-depth-sensing-1-20260825/#session-configuration) supports `cpu-optimized` with `float32`, `unsigned-short` and `luminance-alpha`. Empty preference lists select `cpu-optimized` and `float32`; nonempty lists must include a supported value; the first supported format wins. Invalid preference enums reject with `TypeError`. Required incompatible combinations reject; optional ones are omitted. Each view gets a 32×32 room raycast buffer: float32 meters (`rawValueToMeters=1`) or Uint16 millimeters (`rawValueToMeters=0.001`, including luminance-alpha with the low byte in the luminance channel), containing camera-plane depth rather than ray length. Zero denotes no geometry; no room loaded or paused sensing returns null. Depth results expose `transform` and `projectionMatrix` matching their associated view, with an identity `normDepthBufferFromNormView` for the aligned grid. Tests cover every eye on Quest MR and Android AR, including translated/rotated offset reference spaces and unchanged world-space depth samples. Data access requires the producing active frame; coordinates outside [0,1] throw `RangeError`. GPU depth is unsupported. Sixteen-bit depths outside 1–65535 mm are zero rather than wrapped or saturated. No camera or physical depth sensor is accessed.

The session's depth configuration getters throw `InvalidStateError` when depth sensing was not enabled. `pauseDepthSensing()` and `resumeDepthSensing()` require a live session and its active animation frame, otherwise throwing `InvalidStateError`; during a valid frame they throw `NotSupportedError` if the feature was not enabled. Repeated calls are idempotent, and the paused/resumed state persists across frames.

[Lighting probes](https://immersive-web.github.io/lighting-estimation/#xrsession) expose 27 SH coefficients, a normalized direction toward the renderer's white light at (-1,1,-1), and its 4π intensity, in a stable world-aligned probe space. Probes obey feature/session/frame checks. Only `srgba8` reflection format is accepted; no reflection cube map is available (`getReflectionCubeMap` returns null), so no `reflectionchange` is generated. Values describe virtual lighting, never the user's environment.

### Composition layers

[Layers binding/subimages](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#xrwebglbinding) provide real RGBA8 2D textures, optional DEPTH_COMPONENT24 or packed DEPTH24_STENCIL8 textures, per-eye projection subimages and mono quad subimages. The compositor draws these to the presentation canvas with quad world transforms, opacity and alpha blending, then restores application GL state. Texture size follows the drawing buffer and resources are released on destruction/end; foreign/stale views or destroyed layers reject. Both layer types honor `clearOnAccess`: the default `true` clears color/depth on the first subimage access per frame; `false` clears only newly allocated storage on first access and retains content across frames until resized. Repeated accesses, including the other projection eye, preserve writes within the frame. Consecutive-frame pixel tests exercise omitted/true/false options on Quest VR/MR and Android AR. Tests also read output pixels for projection and quad rendering, including application stencil rejection, rasterizer discard, sample coverage and sampler state, then switch back to `XRWebGLLayer`. Setting `layers` clears the pending legacy `baseLayer`, and setting `baseLayer` clears pending composition layers; applications supply only the property they are switching to.

As required by [Layers initialization](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#initialization), immersive sessions can create and submit a single projection layer without requesting `layers`. Quad creation and submission of multiple layers still require that feature. Creation allocates usable textures immediately, using the device's presentation dimensions for projection layers before the first frame resizes the canvas. Allocation and resizing preserve application pixel-unpack buffer and texture bindings. The browser suite renders a Three.js 0.186.1 mesh through projection layers, with and without `layers`, on all three immersive profile/mode combinations; it checks dimensions, framebuffer completeness, output pixels, and GL errors.

[Quad layers](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#xrquadlayer) render only their front faces, with culling evaluated per eye and application culling enable, face mode and winding restored afterward. Pixel regressions cover front/back orientations on all three profile/mode combinations and a quad visible to only one eye in stereo. Quad creation and `space` assignment reject null, non-space and foreign-session values with `TypeError`, preserving the previous space on failed assignment. Valid viewer and offset-space assignments affect composition. [Layer destruction](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#dom-xrcompositionlayer-destroy) immediately prevents subimage access/presentation and schedules removal from render state, preserving other pending layers, their order and pending depth/legacy-layer changes; repeated destruction does nothing.

The [projection initialization dictionary](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#xrprojectionlayerinit) defaults to depth textures; explicit `depthFormat: null` converts to zero and disables depth. The [quad initialization dictionary](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#xrlayerinit) creates no depth texture for omitted/null formats. Subimages expose `imageIndex: 0`, `motionVectorTexture: null`, and depth attachment dimensions (or null without depth). Browser regressions check both layer types with omitted, undefined, null, zero, DEPTH_COMPONENT/DEPTH_COMPONENT24 and DEPTH_STENCIL/DEPTH24_STENCIL8. Packed textures attach at DEPTH_STENCIL_ATTACHMENT, clear both aspects and preserve application front/back stencil masks and clear values; pixel probes verify zero initialization and stencil rejection. Three.js 0.186.1 with `depth: false` now creates its no-depth XR layer, but then fails in its own unconditional `DepthTexture` construction with a null format; the integration regression verifies the XR layer/subimage before ending that session and does not claim successful Three.js rendering in this configuration. Bindings sharing a session and WebGL context can submit layers together and access each other's subimages; pixel tests exercise both directions, while cross-context submission/access still reject.

Texture arrays, static/mipmapped layers, other color/depth formats, cylinder/equirect/cube/media layers, depth-based composition, and cross-context composition are explicitly unsupported. Their creation methods reject rather than returning stubs. The compositor does not claim native opaque-texture enforcement or hardware scan-out timing.

## Reproducing validation

Use a desktop display and current Playwright Chromium (or set `WEBXR_CHROMIUM_EXECUTABLE` to Chrome for Testing):

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run build
npm run build:firefox
npm run test:environment
npm run test:browser
npm run test:wpt
npm run test:samples
```

`test:browser` loads the unpacked MV3 extension, opens the actual DevTools panel and runs both the original rendering/bridge regressions and the new API cases on all three immersive profile/mode combinations. Deliberate required-feature rejection, optional-feature omission, input event ordering, source/frame ownership, ended sessions, default-off overlay negotiation across light/open/closed shadow configurations, opt-in public previews for Android AR/Quest MR with native UI events and screenshot pixels, anchor movement/deletion, hand joints, depth and actual layer pixels are exercised. It also tests packed depth/stencil texture allocation, stencil pixels/state preservation, geometry negotiation, real populated plane/mesh sets, Hit Test agreement, offsets, surface anchors, identity/removal/reacquisition, active-frame errors, unbounded navigation, and both 16-bit depth formats on AR/MR. `test:environment` separately checks transformed indexed/non-indexed fixtures, geometry updates, degenerate triangles, snapshot membership and cleanup. Its JSON report and screenshots are written to ignored `test-results/`. The tsx naming helper installed by the test runner is a harness-only identity function needed when Playwright serializes nested functions.

`test:wpt` downloads a pinned upstream WPT revision, **e1859580b5fcf74940a18d2f783296b4961035e3**, and runs these unchanged assertion bodies:

- `xrRigidTransform_constructor.https.html`
- `xrRigidTransform_inverse.https.html`
- `xrRigidTransform_matrix.https.html`
- `xrRigidTransform_sameObject.https.html`
- `navigator_xr_sameObject.https.html`

The harness replaces `testharnessreport` with a JSON collector. For the constructor and navigator identity cases it replaces native fake-device session setup with a real emulator inline session and a legacy WebGL layer. Those assertions do not depend on immersive hardware. This adaptation does **not** validate the native fake-device infrastructure or immersive session setup. Other WPT files, including IDL and native permission/opaque-framebuffer tests, were not executed. Focused equivalent tests cover the listed emulator behaviors; five passing WPT files are not full-suite conformance. Downloads require network access; files are served locally and not included in extension packages.

`test:samples` loads the published Immersive Web VR-session, hit-test, Plane Detection, Mesh Detection and Barebones AR DOM Overlay samples with the unpacked extension, clicks their actual entry buttons, observes at least 120 XR callbacks and nonempty hit-test results where requested, verifies default-off omission and opt-in original-root preview on phone and Quest, clicks the enabled preview’s original Exit AR button to demonstrate app behavior, checks style restoration, and captures screenshots. The pages and extension are unmodified; only a test observer wraps requests/callbacks. These externally hosted samples can change independently of this revision.

## Validation record and remaining Issue scope

The [Issue #19 validation record](webxr-validation-2026-10-20.json) records passing `npm ci`, typecheck, Chromium/Firefox builds, three focused geometry/depth fixture tests, the full unpacked-extension browser suite on Chromium **156.0.8078.4** (Quest VR: 515 distinct assertions; Quest MR: 586; Android AR: 475), the five pinned WPT files and all **11** external sample/profile combinations. Published Plane and Mesh Detection samples each ran at least 120 XR callbacks and received **100** hall patches on both AR/MR profiles. The mesh sample also exercises the added packed depth/stencil layer path through its own Three.js client. New module WPT/IDL files were not run because the existing harness only adapts the five geometry/identity cases; native fake-device geometry capture requires separate harness work.

An additional exploratory published CPU Depth sample failed in shader setup (`attachShader` received a non-WebGLShader), after session creation but before any XR callback/base layer. It is excluded from the final regression suite and is **not** claimed as passing; CPU formats instead have real extension API tests plus analytic depth/quantization/range fixtures. This failure is recorded separately in the JSON. No sample sources were modified. Firefox runtime and physical-device validation were not run. The prepared [PR blocker comment](issue-19-pr-comment.md) must still be posted by the downstream publisher before merge; no GitHub write was authorized here.

The following is the earlier Issue #11 validation history:

The [machine-readable record](webxr-validation-2026-10-16.json) records actual command results on desktop Chromium **156.0.8078.4**. Firefox packaging is checked separately; Firefox runtime/DevTools behavior was not exercised in this run. No physical-device results are claimed. Required post-merge verification: none.

**Keep Issue #11 open.** This is a substantial implementation checkpoint, not a complete standards-conformance certification. Remaining acceptance work includes Quest stereo DOM overlay geometry/input and the arbitrary-root, CSS and security limitations recorded in the historical Issue #15 report (administratively closed with unfinished scope), broader WebIDL/permission/opaque-framebuffer conformance, and validation of those behaviors. Persistent anchors and the additional layer/texture paths above remain explicitly unsupported. The implemented targets have real simulated paths, but the outstanding core/overlay behavior must not be hidden by marking the whole Issue complete.
