# WebXR API inventory — revision 1 (2026-10-16)

This is the implementation and validation record for [Issue #11](https://github.com/takahirox/WebXR-emulator-extension/issues/11). It describes **simulated capabilities**, not Quest/ARCore hardware certification or a claim of full WPT conformance. The API implementation is maintained in strict TypeScript under `src/polyfill/api/`; the former Git dependency and private `webxr-polyfill` imports have been removed. The packaged entry point remains `polyfill/webxr-polyfill.js` for manifest compatibility.

## Specification baseline

The following published revisions were checked on 2026-10-16. Working and Editor's Drafts remain proposals subject to change.

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

## Negotiated capability matrix

`I` means implemented within the limits below; `—` means unsupported. Quest VR and MR are mutually exclusive panel modes. Phone VR is unsupported. Both profiles also support inline sessions with only the default `viewer` feature and a monoscopic `none` view. Unsupported required features reject with `NotSupportedError`; unsupported optional features are omitted from the frozen `session.enabledFeatures` array. Constructors being present do not grant a feature.

| Capability / feature descriptor | Quest VR | Quest MR (`immersive-ar`) | Android AR |
| --- | --- | --- | --- |
| `viewer`, `local` | I | I | I |
| `local-floor` (explicit request) | I | I | I |
| `bounded-floor`, `unbounded` | — | — | — |
| Two stereo views, tracked controllers | I | I | — |
| Single `none` view, transient screen input | — | — | I |
| `hit-test` (plane/mesh room intersections) | — | I | I |
| `dom-overlay` | — | — | — |
| `anchors` (session lifetime) | — | I | I |
| `hand-tracking` (deterministic skeletons) | I | I | — |
| `layers` (WebGL2 projection + mono quad) | I | I | I |
| `depth-sensing` (CPU, float32) | — | I | I |
| `light-estimation` (virtual room light) | — | I | I |
| GPU depth, camera access, plane/mesh detection, secondary views, WebGPU, haptics | — | — | — |

Profile declarations in [devices.json](../src/devices.json) are constrained further by `EmulatedXRDevice.isFeatureSupported(feature, mode)`. Inline sessions cannot enable the immersive modules. WebGL1 remains usable with `XRWebGLLayer`; composition layers require WebGL2. Requesting `layers` does not imply that every layer type or texture format is supported.

## Implemented behavior and limits

### Sessions, frames, spaces and legacy rendering

[Session initialization](https://www.w3.org/TR/2026/CRD-webxr-20260609/#dom-xrsystem-requestsession), [frames](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrframe-interface), and [reference spaces](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrreferencespace-interface) guide the focused assertions in [conformance.ts](../tests/conformance.ts). Both system entry points wait for asynchronous configuration. Immersive requests require transient user activation, exclude concurrent/pending immersive sessions, and release that exclusion after end or failed negotiation. Inline sessions are hidden while immersive presentation is active. Document visibility produces `visibilitychange`; showing the document keeps inline sessions hidden until immersive presentation ends. No synthetic tracking loss or `visible-blurred` state is generated.

Animation callbacks run in registration order with cancellation, one active frame and one monotonic desktop RAF timestamp. Event frames permit poses but reject `getViewerPose`. Stored frames and hit/depth results reject access after their callback. Spaces, sources, probes, layers and views have session/frame ownership checks. Ending a session stops its loop, drops callbacks/inputs, deactivates hit sources, deletes anchors, releases layer GL resources, and restores canvas state. A profile/mode change ends active presentation before replacing the device. [Session shutdown](https://www.w3.org/TR/2026/CRD-webxr-20260609/#session-shutdown) queues the public `end` event and promise resolution; ending inside an input handler preserves the identity for the current action's paired events, then stops further input/frame processing.

`XRRigidTransform` validates finite components, point `w`, and nonzero normalizable quaternions, and caches the inverse. Offset spaces compose in world coordinates, including when used as either argument of `getPose`. The room floor is world Y=0; local eye height is 1.6 m. `emulatedPosition` is true, velocities are unavailable. Quest views have left/right eye transforms; the existing stereo-disable setting preserves its single-output viewport behavior. The phone follows the virtual tablet. Projection, physical drawing-buffer dimensions, viewport layout and MR DPR/resize behavior retain the existing regression checks. Legacy rendering uses the canvas default framebuffer, cleared each immersive frame with application GL state restored.

### Hit tests and DOM interaction

[Hit test source/results algorithms](https://www.w3.org/TR/2025/WD-webxr-hit-test-1-20251211/#hit-test-source) drive feature, lifecycle, cancellation and error checks. The packaged room is the sensed environment. Plane and mesh queries intersect its polygon surfaces, return nearest-first intersections, apply `offsetRay` in the source's effective space and retain the transformed face normal as pose +Y. Point-cloud queries reject because there is no point cloud. Repeated cancellation throws `InvalidStateError`. A cancelled source remains in an already-created frame's snapshot, but is absent from subsequent frames. A transient query matches `generic-touchscreen` exactly and produces results only for the associated active screen source; Quest has no transient touchscreen.

[DOM overlay interaction](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#xrinputsource) is **unsupported**. A desktop DOM rectangle cannot supply correct overlay geometry in the Quest eye textures or the phone screen inside the virtual scene. Required `dom-overlay` requests reject with `NotSupportedError`; optional requests are omitted, `domOverlayState` stays null and the root is left unchanged. A supplied invalid `domOverlay.root` rejects with `TypeError` during argument validation. No `beforexrselect`, synthetic overlay clicks, or cross-origin overlay interaction are claimed. This corrects the old over-advertisement rather than treating a styled desktop element as conformance.

### Controllers, touch and hands

The [Quest Touch Plus registry profile](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/meta/meta-quest-touch-plus.json) supplies `meta-quest-touch-plus`, `oculus-touch-v3`, `oculus-touch`, and generic fallbacks. Trigger/squeeze are buttons 0/1, button 2 is an inert placeholder, and joystick axes are 2/3 after the required placeholders. Gamepads retain identity, expose frozen per-frame state and hide identifying IDs. The existing panel supplies trigger/squeeze state; haptics are absent. Transient phone sources expose `screen`, handedness `none`, no grip/gamepad, and a fresh source identity per touch. Added-source events precede `selectstart`; `select`, `selectend` precede removal. Release-event poses retain the final tracked input transform.

When Quest sessions explicitly enable [hand input](https://www.w3.org/TR/2024/WD-webxr-hand-input-1-20240605/#xrhand-interface), both input sources use `generic-hand-select` with 25 ordered joints. The controller pose moves the hand; the panel trigger curls its fingers. Joint spaces, radii, poses and bulk pose/radius fills are implemented. Without that feature controllers have `hand === null`; the phone cannot negotiate it. This is a reproducible skeleton, not optical tracking, and does not simulate hand/controller switching within an active session.

### Anchors, depth and light

[Anchor creation](https://immersive-web.github.io/anchors/#anchor-creation) from frames and hit results retains a world-space transform independently of viewer motion. Subsequent frames expose a read-only anchor set. Deleted anchors lose tracking; accessing their `anchorSpace` throws. Session end deletes all anchors. Persistent anchor handles/storage are explicitly unsupported (`NotSupportedError`); there is no claim of cross-session relocalization.

[Depth configuration](https://www.w3.org/TR/2026/WD-webxr-depth-sensing-1-20260825/#session-configuration) supports `cpu-optimized` + `float32` only. Empty preference lists select those supported defaults; nonempty lists must include the corresponding supported value. Required incompatible combinations reject; optional ones are omitted. Each view gets a 32×32 room raycast buffer in meters (`rawValueToMeters=1`), containing camera-plane depth rather than ray length. Zero denotes no geometry; no room loaded or paused sensing returns null. View geometry and the normalized transform describe the aligned grid. Data access requires the producing active frame; coordinates outside [0,1] throw `RangeError`. GPU depth and other data formats are unsupported. No camera or physical depth sensor is accessed.

The session's depth configuration getters throw `InvalidStateError` when depth sensing was not enabled. `pauseDepthSensing()` and `resumeDepthSensing()` require a live session and its active animation frame, otherwise throwing `InvalidStateError`; during a valid frame they throw `NotSupportedError` if the feature was not enabled. Repeated calls are idempotent, and the paused/resumed state persists across frames.

[Lighting probes](https://immersive-web.github.io/lighting-estimation/#xrsession) expose 27 SH coefficients, a normalized direction toward the renderer's white light at (-1,1,-1), and its 4π intensity, in a stable world-aligned probe space. Probes obey feature/session/frame checks. Only `srgba8` reflection format is accepted; no reflection cube map is available (`getReflectionCubeMap` returns null), so no `reflectionchange` is generated. Values describe virtual lighting, never the user's environment.

### Composition layers

[Layers binding/subimages](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#xrwebglbinding) provide real RGBA8 2D textures, optional DEPTH_COMPONENT24 textures, per-eye projection subimages and mono quad subimages. The compositor draws these to the presentation canvas with quad world transforms, opacity and alpha blending, then restores application GL state. Texture size follows the drawing buffer, resources are cleared for each frame and released on destruction/end, and foreign/stale views or destroyed layers reject. Tests read output pixels for projection and quad rendering, including application stencil rejection, rasterizer discard, sample coverage and sampler state, then switch back to `XRWebGLLayer`. Setting `layers` clears the pending legacy `baseLayer`, and setting `baseLayer` clears pending composition layers; applications supply only the property they are switching to.

As required by [Layers initialization](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#initialization), immersive sessions can create and submit a single projection layer without requesting `layers`. Quad creation and submission of multiple layers still require that feature. Creation allocates usable textures immediately, using the device's presentation dimensions for projection layers before the first frame resizes the canvas. Allocation and resizing preserve application pixel-unpack buffer and texture bindings. The browser suite renders a Three.js 0.186.1 mesh through projection layers, with and without `layers`, on all three immersive profile/mode combinations; it checks dimensions, framebuffer completeness, output pixels, and GL errors.

Texture arrays, static/mipmapped layers, alternate color/depth formats, cylinder/equirect/cube/media layers, depth-based composition, and cross-context composition are explicitly unsupported. Their creation methods reject rather than returning stubs. The compositor does not claim native opaque-texture enforcement or hardware scan-out timing.

## Reproducing validation

Use a desktop display and current Playwright Chromium (or set `WEBXR_CHROMIUM_EXECUTABLE` to Chrome for Testing):

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run build
npm run build:firefox
npm run test:browser
npm run test:wpt
npm run test:samples
```

`test:browser` loads the unpacked MV3 extension, opens the actual DevTools panel and runs both the original rendering/bridge regressions and the new API cases on all three immersive profile/mode combinations. Deliberate required-feature rejection, optional-feature omission, input event ordering, source/frame ownership, ended sessions, overlay feature rejection, anchor movement/deletion, hand joints, depth and actual layer pixels are exercised. Its JSON report and screenshots are written to ignored `test-results/`. The tsx naming helper installed by the test runner is a harness-only identity function needed when Playwright serializes nested functions.

`test:wpt` downloads a pinned upstream WPT revision, **e1859580b5fcf74940a18d2f783296b4961035e3**, and runs these unchanged assertion bodies:

- `xrRigidTransform_constructor.https.html`
- `xrRigidTransform_inverse.https.html`
- `xrRigidTransform_matrix.https.html`
- `xrRigidTransform_sameObject.https.html`
- `navigator_xr_sameObject.https.html`

The harness replaces `testharnessreport` with a JSON collector. For the constructor and navigator identity cases it replaces native fake-device session setup with a real emulator inline session and a legacy WebGL layer. Those assertions do not depend on immersive hardware. This adaptation does **not** validate the native fake-device infrastructure or immersive session setup. Other WPT files, including IDL and native permission/opaque-framebuffer tests, were not executed. Focused equivalent tests cover the listed emulator behaviors; five passing WPT files are not full-suite conformance. Downloads require network access; files are served locally and not included in extension packages.

`test:samples` loads the published Immersive Web VR-session and hit-test samples with the unpacked extension, clicks their actual entry buttons, observes at least 120 XR callbacks and nonempty AR hit results and captures screenshots. The pages and extension are unmodified; only a test observer wraps requests/callbacks. These externally hosted samples can change independently of this revision.

## Validation record and remaining Issue scope

The [machine-readable record](webxr-validation-2026-10-16.json) records actual command results on desktop Chromium **156.0.8078.4**. Firefox packaging is checked separately; Firefox runtime/DevTools behavior was not exercised in this run. No physical-device results are claimed. Required post-merge verification: none.

**Keep Issue #11 open.** This is a substantial implementation checkpoint, not a complete standards-conformance certification. Remaining acceptance work includes DOM overlay geometry inside the virtual phone/Quest eye views, full cross-origin overlay interaction semantics, broader WebIDL/permission/opaque-framebuffer conformance, and validation of those behaviors. Persistent anchors and the additional layer/texture paths above remain explicitly unsupported. The implemented targets have real simulated paths, but the outstanding core/overlay behavior must not be hidden by marking the whole Issue complete.
