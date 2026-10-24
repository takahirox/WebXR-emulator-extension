# Individual poses, view snapshots and viewport bindings

[Issue #49](https://github.com/takahirox/WebXR-emulator-extension/issues/49) completes the existing individual pose-to-rendering path for Quest VR, Quest MR, Android AR and viewer-only inline sessions. It adds no feature descriptor. The [inventory](webxr-conformance.md) retains the restrictions on sensing, layers, observer views and other deferred modules.

Frames, poses, viewer poses, views and viewports now expose branded readonly prototype getters. Their descriptors are enumerable/configurable; ordinary writes do not replace the attributes. Public construction of these interfaces throws TypeError. XRViewGeometry is an interface mixin: transform/projectionMatrix are installed directly on XRView and XRDepthInformation, without a global constructor or extra prototype. Pose transform, viewer views and view transform retain identity per result; the views array is frozen. Separate pose/view queries produce fresh snapshots.

Individual pose methods validate receivers, required arguments and interface brands before frame state. Missing, forged, proxy and wrong-interface arguments throw TypeError synchronously. Genuine foreign-session spaces and valid calls on inactive frames throw InvalidStateError. Both spaces are validated before tracking availability. Event frames allow getPose but reject getViewerPose. Same-origin injected iframe/popup methods and objects interoperate in both directions. getPose allocates in the frame's realm; viewer poses, views and transforms allocate in the session's realm. Retained attributes remain readable after callbacks/end; querying the retained frame still checks its lifetime.

Virtual tracking providers supply exact 6DoF positions, so their known relationships report emulatedPosition=false. A statically shared native origin (including self and reference offsets) has an exact relative relationship even if its absolute position is unavailable or estimated. Providers explicitly supplying an estimated position propagate true when a relative query depends on that estimate. This metadata is not a physical sensor-fidelity claim. Velocities remain null. Existing unavailable joint/source transitions remain in place.

Each view owns independent projection calibration and caches its exposed mutable Float32Array. Detaching the buffer regenerates an array in the view's realm from calibration. Array writes affect that exposed array until transfer; they do not change another snapshot, later queries, CPU depth or compositor calibration. Rigid-transform matrix guarantees from Issue #47 remain in force.

getViewport checks layer/view brands and current animation-frame/session ownership. It reuses a layer's viewport for the underlying view while dimensions are unchanged, including fresh snapshots within the frame. The first query locks dimensions through that frame; inline canvas resizing takes effect on the next frame without mutating retained viewports. Old/foreign views throw InvalidStateError. requestViewportScale converts its required nullable double (including numeric coercion exceptions, BigInt/Symbol and nonfinite rejection). Explicit null/undefined and finite values remain advisory no-ops at fixed resolution. Retained views can call this method; no stale-view gate or dynamic-scaling capability is added. Projection subimage consumers use shared view/layer brands and allocate in the binding's realm even through borrowed methods. Projection rendering still works without requesting `layers`.

## Pinned contracts and WPT adaptations

Implementation references are [Device CRD 9 June 2026 §§5–9 and 11.2](https://www.w3.org/TR/2026/CRD-webxr-20260609/), [WebIDL 622910c](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs) and [Layers WD 11 August 2026 §6.9](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/). Device §6.1 defines emulatedPosition by the relative relationship, including statically known positions; §7.1 requires a new projection array after detachment; §7.2 defines required nullable-double scaling and includes no lifetime gate; §11.2 returns the cached viewport associated with the underlying view.

The following [WPT e185958](https://github.com/web-platform-tests/wpt/tree/e1859580b5fcf74940a18d2f783296b4961035e3/webxr) assertions were inspected against evaluation baseline `baf056097b1a366a61927e75666473ce44793ba9` before adaptation:

| WPT file | Applicable assertion and adaptation |
| --- | --- |
| xrFrame_getPose.https.html | Offset geometry with actual extension spaces: individual/bulk translation in the new selection, composed rotation in the existing transform regression. |
| xrFrame_getViewerPose_getPose_identities.https.html | Self/shared-origin relative identity and false emulation, including unavailable absolute providers. Its native fake controller/null-origin setup is not available in the extension. |
| getViewerPose_emulatedPosition.https.html | Known positions report false; estimated provider reports true. The fixture explicitly marks one estimated provider rather than inventing physical tracking or adding a panel capability. |
| xrFrame_lifetime.https.html | Calls after callbacks fail with InvalidStateError; separately test retained attributes remaining readable. |
| xrView_sameObject.https.html, xrViewerPose_views_sameObject.https.html, xrPose_transform_sameObject.https.html | Identity of attributes on an existing object; do not turn this into cross-query identity. Attached projections reuse their array, with the Device §7.1 detachment exception tested separately. |
| xrWebGLLayer_viewports.https.html, xr_viewport_scale.https.html | Positive contained mono/stereo viewports, stable results within a frame, optional scaling. Fixed-resolution no-op is permitted; no dynamic scaling success claim. |

The baseline hardcodes true emulation, omits view.index, exposes writable fields, inherits from a public XRViewGeometry and returns detached projections/new viewports. These inspected assertions expose those gaps; the new selection also checks binding order, real realms, transfers and pixels not established by the old five-file standalone WPT runner. The pinned WPT files themselves are **not executed** by this selection. No correction to Issue #49 acceptance was needed.

## Reproduce

```sh
npm ci
npm run build:firefox
npm run test:pose-view:chromium
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
npm run test:pose-view:firefox
npm run test:environment
git diff --check
```

The selection is `tsx tests/reference-space-browser.ts chromium poses` or `firefox poses`. It runs the three immersive profiles and inline on both device profiles per browser (ten scenarios total), through the existing real extension drivers. Chromium uses the locked Playwright browser; `WEBXR_CHROMIUM_EXECUTABLE` can select another executable. Firefox setup is documented in [Firefox reproduction](firefox-runtime.md#reproduce). The runner saves JSON and PNGs as `test-results/pose-view-*`; [the versioned execution record](webxr-pose-view-validation-2026-10-24.json) identifies tested source/bundle hashes, versions, outcomes, resolved failures and unperformed checks.

The same page fixture runs in each browser. It first obtains real inline animation frames in the main document, injected iframe and popup, exercising all borrowed getters/methods in both directions. Those sessions end and the foreign documents close before immersive rendering, preserving normal visibility and inline suppression. Captured foreign constructors/operations remain genuine values from the independent injections. Firefox WebDriver activates the actual main or popup window for each inline realm frame because script window.focus() can be ignored; document visibility and suppression are never replaced.

Instrumentation reads internal ownership/current frame, callbacks.size, device state and the actual presentation canvas. It constructs controlled unavailable/estimated providers, temporarily removes/restores a gamepad slot during synchronous joint queries, toggles/restores one existing input slot to exercise retirement/reacquisition, waits for actual AR room readiness, and uses the real device button path for input-event frames. It replaces no GL operations, frame callbacks or timers. CPU depth is exercised only on negotiated AR profiles; hands only on Quest. Inline has no source/hand/depth feature and no immersive projection binding, so those cases run in the immersive scenarios instead.

Rendering uses WebGL2 triangles at z=-2 m: red left, green right, yellow mono. Base and existing projection layers are checked before/after mutable projection-array transfer and after a 0.6 m reference-origin navigation offset. Source and immersive presentation pixels must agree exactly. Projection transfer preserves triangle pixel counts/centroids; navigation moves the centroid right by more than 5% of viewport width. Every triangle covers over 100 matching pixels; color error is below 3/255 and geometry tolerance below 0.0001. Restart renders again and cleanup checks cancellation/end delivery. Inline source pixels and canvas captures are recorded; it has no immersive presentation canvas.

The standalone WPT runner, generic application suite and optional unchanged Three.js teleport example are outside this focused execution. Required post-merge verification: none.

## Recorded execution

Chromium 156.0.8078.4 and Firefox 157.0 (build 20260924084938, geckodriver 0.37.1) each passed 31,647 counted pose/view assertions across five scenarios. Counts include the repeated realm/receiver combinations. All 58 final mono/stereo captures are versioned under [docs/validation/issue-49](validation/issue-49); their pixel counts, centroids and hashes are in the execution record. The existing rigid-transform selection passed 3,015 assertions per browser and the reference-space/shutdown selection passed 1,160 per browser, again across the same five scenarios each. Browser sessions, temporary profiles and Firefox's temporary addon were cleaned up.

`npm run build:firefox`, the four environment/depth/play-area tests and `git diff --check` passed. The generated Chromium and Firefox polyfill bundles have identical SHA-256 hashes; their changes were inspected against the source. Earlier harness failures (constructor capture, render-state setup, room readiness and Firefox focus) and the resolved Node WebGL import failure are recorded separately from these final passes. No final check failed. No generic application-suite, standalone WPT or optional Three.js teleport execution is claimed.
