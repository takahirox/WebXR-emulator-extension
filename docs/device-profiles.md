# Device profiles and emulation modes

Issue [#9](https://github.com/takahirox/WebXR-emulator-extension/issues/9) consolidates the picker to **Meta Quest 3** (default) and **Generic Android Phone (ARCore)**. Both retain inline sessions. These are representative development configurations; neither claims hardware fidelity or new WebXR API conformance. The packaged hall, headset, and controller assets remain local and unchanged. Issue #11 subsequently added simulated hand input, anchors, CPU depth, lighting and composition layers. See the [current feature matrix](webxr-conformance.md) for negotiation, tests and remaining standards work; real camera passthrough remains unavailable.

`src/devices.json` describes supported modes and a `formFactor`. ConfigurationManager adds the selected `emulationMode` to the definition sent through the existing typed device message and startup event. The Quest mode preference is stored separately from the profile and stereo setting, so selecting the phone does not erase it. Legacy Samsung AR settings map to the phone; other removed/unknown IDs map to Quest with the default VR preference. Invalid stored JSON falls back to defaults.

The panel's **Quest mode** control selects VR or MR (immersive AR). A page sees support for inline and the chosen immersive mode. Applications that cache session support may need to query it again or reload after a change. Requesting an unavailable mode rejects with `NotSupportedError`. Profile/mode changes end presentation before rebuilding inputs; applications must request a new session. Ending also clears touch state, hit-test sources/results, and presentation textures, including sessions ended before a base layer exists.

Quest VR and MR both derive viewer and eye poses from the headset, retain two tracked controllers with select/squeeze, and use separate eye projections and viewports. Stereo-off renders the left view over the full canvas and gives the right view a zero-width viewport. MR uses the existing room and canvas-texture compositor across the full headset display, with matching room eye offsets, rather than treating an AR-capable headset as a handheld phone. The MR renderer preserves the existing linear-light alpha composition and sRGB output contract. The phone has one `none` eye using the maintained monoscopic view path, with its viewer pose attached to the virtual phone. The outside observer camera remains separately movable.

MR room viewports and scissor rectangles use physical render-target pixels without applying the display pixel ratio twice. Before each XR frame, the application drawing buffer follows the room display's dimensions; a size change also replaces the compositor's canvas texture to reallocate its immutable GPU storage. This keeps application and room eye projections aligned through window resizing and pixel-ratio changes.

For the phone, internal right/left virtual inputs remain the pointer/phone pose channels. The pointer reports a transient `screen` input with `none` handedness and a `generic-touchscreen` profile during touch; the virtual phone is never exposed as a second physical controller. The panel labels these controls **Observer camera**, **Touch pointer (virtual)**, and **Phone**, draws simple generic geometry, and hides select/squeeze buttons. Right-clicking the phone screen in the application supplies touch; persistent and transient room hit testing are preserved.

Profile changes invalidate pending panel asset loads so rapid switching cannot install stale models. AR renderer replacement disposes its controls, canvas texture, render targets, and renderer, and removes the window resize listener. Detached presentations skip rendering; re-entering a session reuses the room when the form factor has not changed.

## Validation

Executed on macOS arm64, Node.js **24.12.0**, npm **11.6.2**, and Playwright desktop **Chromium 156.0.8078.4** (build 1248) on 2026-10-15. The browser used a fresh temporary profile, the actual unpacked MV3 extension and DevTools panel, and software WebGL. No personal browser profile or physical XR hardware was used.

| Check | Outcome |
| --- | --- |
| `npm ci` | Passed; 61 packages installed, zero vulnerabilities reported |
| `npm run typecheck` | Passed for source, declarations, tooling, and tests |
| `npm run build` | Passed; tracked panel, content-script, and polyfill bundles regenerated |
| `npm run build:firefox` | Passed; MV3 Firefox package generated in ignored `build/firefox/` |
| `npm run test:browser` | Passed on Chromium 156.0.8078.4 |
| `git diff --check` | Passed |

The build retains the existing upstream XRSession/XRFrame circular dependency warning. During development, an exploratory browser run against stale generated bundles timed out at the VR pose check; rebuilding the extension and rerunning passed. A TypeScript error in a test storage read was corrected before the successful builds. A later run exposed a quick camera drag finishing between animation frames; MyControls now applies the final mouse delta on release, and the regression was rerun. No failing check remains in the final artifact.

The browser regression verifies exactly two picker options and default selection; removed/unknown profile migration; malformed storage recovery; device/stereo persistence after panel reload; Quest mode persistence after panel and page reload; available session modes and rejection of an unavailable mode; inline sessions; VR/MR mode changes during presentation and session restarts; stereo eye poses/projections/viewports; MR stereo toggling without ending the session; MR reset poses and controller select/squeeze; phone monoscopic views and transient screen input; phone 6DoF transform updates; persistent/transient hit tests and cancellation; phone AR restart after page reload; active phone-to-Quest MR transitions; and ending/restarting MR before a base layer is supplied.

Retained checks cover real headset/controller gizmo drags, OrbitControls, bidirectional poses, worker shutdown/recovery in both directions, same-origin and cross-origin frames, frame removal, tab isolation, malformed message rejection, first-script WebXR availability under restrictive CSP, room texture loading, and absence of uncaught page/panel or shader/loader/WebGL errors. MR and phone pixel checks verify opaque patch orientation/color and preservation of the room through transparent pixels; the phone also checks half-alpha blending in linear light. Both compositor pixel reads report WebGL `NO_ERROR`.

The MR rendering review fixes were validated with the same install, typecheck, Chrome/Firefox build, and Chromium browser commands above. The added regression compares actual WebGL room viewports/scissors against application XR viewports and projection matrices at DPR 2, resizes an active session from 1280×720 to 900×900, and returns to 1280×720 at DPR 1. It checks both physical buffers and both eyes without restarting the session. The pre-fix bundle failed the new buffer-alignment check. An intermediate fix exposed a WebGL texture-size error after resizing; replacing the canvas texture corrected it, and the full regression then passed, including compositor pixel and phone hit-test checks. The existing upstream circular dependency warning remains.

Screenshots were inspected for readable controls, headset/controller geometry and gizmos, the two MR room views, the phone representation, and upright composited application output:

- [Quest panel](validation/issue-9/panel.png)
- [Quest MR panel](validation/issue-9/panel-mr.png)
- [Phone panel](validation/issue-9/panel-phone.png)
- [Quest VR fixture](validation/issue-9/quest-vr.png)
- [Quest MR room](validation/issue-9/quest-mr.png)
- [Quest MR texture patches](validation/issue-9/quest-mr-texture.png)
- [Phone AR room](validation/issue-9/ar.png)

Fresh test runs write screenshots to ignored `test-results/`. The additional `quest-mr-dpr2.png` and `quest-mr-resized.png` captures were visually inspected: both room eyes remain visible at DPR 2 and after the square resize. The VR regression fixture clears the canvas to a solid color; its view separation is asserted through XR poses and viewports rather than visually distinct app geometry. Screenshot review caught and corrected a narrow-panel control overlap before final validation.

Firefox runtime regression, external WebXR samples, and physical-device checks were not performed. Firefox packaging passed; runtime testing remains optional. Full WebXR conformance and physical-device fidelity are outside this Issue. No post-merge verification is required. The implementation checkpoint does not push, open a PR, comment, or merge; downstream PR authoring should target `dev` using the repository template and these validation results.
