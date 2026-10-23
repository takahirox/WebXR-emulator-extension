# Firefox runtime validation (Issue #37)

The generated MV3 extension executes on **official Firefox 157.0, build 20260924084938**, with **geckodriver 0.37.1 (300705c65d1b)** on macOS arm64. This is a bounded runtime result for the three emulator profiles and six applications below. Firefox 128 remains the package's manifest minimum; other Firefox versions have not been runtime validated by this runner.

## Reproduce

Install the locked npm dependencies, obtain the selected browser and driver, and build the actual extension:

```sh
npm ci
npm run build:firefox
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver \
npm run test:firefox
git diff --check
```

Use the [official Firefox 157.0 archive](https://archive.mozilla.org/pub/firefox/releases/157.0/mac/en-US/Firefox%20157.0.dmg) and [geckodriver 0.37.1 macOS arm64 release](https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-macos-aarch64.tar.gz). Extract them outside tracked files; browser downloads are not npm dependencies. The runner requires absolute executable paths and checks the browser version/build and driver version. It uses the executable hashes recorded in the evidence, not a personal installed profile or Playwright's modified Firefox. WebGL2 and a desktop display are required. The observed environment used Node.js 24.12.0 and the repository's locked tsx/TypeScript tooling; no Selenium library, web-ext, CDP or Playwright Firefox is used.

The runner writes `test-results/firefox-applications.json`, six screenshots and `firefox-driver.log`. Its local server serves pinned upstream application/library/asset bytes without rewriting them. Downloads are cached under `test-results/firefox-cache/`; exact source URLs, SHA-256 hashes and sizes identify the bytes served. Browser-fetched external dependencies and assets have their actual response URLs/status/MIME/ETag recorded separately. In particular these include Rapier 0.17.3 and its resolved Skypack module, the input-profiles motion-controller module and Quest Touch Plus JSON/GLBs, and the Sample's Karla font. Their upstream URL/version choices remain unchanged.

For the shared lifetime bridge, `npm run test:extension-lifetime` runs the targeted real-extension Chromium regression on all three profiles. It uses the same optional `WEBXR_CHROMIUM_EXECUTABLE` override as the existing Chromium runner.

## Installation and real panel control

[Mozilla's geckodriver system-access option](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html#allow-system-access) enables control of Firefox UI in this temporary test process. The runner binds geckodriver to loopback, selects dynamic HTTP/BiDi ports, creates a fresh temporary profile directory, and temporarily installs **`build/firefox/`** through `/moz/addon/install`. It grants only the loopback test origins through Firefox's real extension-permissions store, equivalent to granting site access in Firefox's UI. The extension's production storage, MAIN/ISOLATED scripts, event-page router and `cloneInto` bridge run normally.

Firefox's own `gDevTools.showToolboxForTab` opens the inspected tab's toolbox in a separate window. The runner waits for the extension-registered WebXR tool in the toolbox's additional tools, selects it, and controls its actual remote `panel.html` through Firefox's existing Marionette actor. `chrome.devtools.inspectedWindow.tabId` comes from Firefox. It is never fabricated. Controls are the panel's selectors, select/squeeze buttons and real TransformControls change handlers. A second tab receives no commands intended for the inspected tab; an injected child frame does receive them.

On success and assertion failure, `finally` uninstalls the temporary add-on, deletes the WebDriver session, stops the owned driver and removes its temporary profile. SIGINT/SIGTERM use the same cleanup. The result records separate cleanup outcomes, including that the managed Firefox process exited. Existing exploratory assertion failures also returned through this cleanup path. No persistent installation or personal profile is modified.

## Observation and setup adaptations

Observation code is under `tests/`, outside the Firefox package. `firefox-scenes.js` uses Three.js's existing `__THREE_DEVTOOLS__` observation event and wraps the existing scene callback while preserving its receiver, arguments, result and exceptions. BiDi preloads it into application pages. A test-only privileged process script installs the same observer before the genuine remote panel's bundle executes; this supplies no extension APIs, emulation or XR input. Firefox UI automation and this observation script are separate from the production extension's no-eval injection path.

`firefox-observation.ts` observes the original request promise, XR callbacks, poses and hit-test results. It does not edit feature requests, suppress errors or hide `XRWebGLBinding`. Compositor-internal viewer-relative identity poses are excluded from the application's world/local pose observation. The Sample Node `clone` and Rapier `RigidBody.setTranslation` observers execute in the page's BiDi realm, sharing the application's existing module instances, and preserve calls/results/exceptions. These record placement and firing rather than replacing either behavior. Application source and library source remain unchanged.

Pixel checks read the owned presentation canvas for every eye and the mono view. AR additionally samples opaque application texels in the next **natural** final renderer pass, and checks that transparent texels retain nonblack opaque room pixels. Quest MR matches opaque source texels within two channel values. On the minified phone display, the check requires visible foreground contrast against a neighboring transparent room pixel in the direction of the application color; raw source-texel differences are recorded, not treated as a filtering invariant. Screenshots provide the presented scene evidence. The phone is moved closer through the genuine panel to make its application output legible; actual right-button pointer input on its screen produces transient `screen` sources. Quest input comes from the panel's tracked controllers. DOM Overlay Preview stays disabled.

The pinned [WPT `navigator_xr_sameObject.https.html`](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/navigator_xr_sameObject.https.html) and its two frame-to-frame identity assertions are served unchanged. Setup replaces the native fake-device utility with a real emulator **inline** session and base layer, and replaces the report UI with a result collector. The assertion body and testharness remain upstream code. This is an adapted WPT, not a full/unmodified WPT suite. The restrictive-CSP first-script check is the existing emitted `tests/fixture.ts` fixture, independently of WPT setup.

## Evidence and scope

The [execution record](webxr-firefox-validation-2026-10-24.json) and [screenshots](validation/issue-37/) distinguish packaging, executed checks, working results and historical failures. The six required application/profile entries use:

| Profile | Mode | Samples `fb41c3416496974672e2c766a41c6febcba2d07e` | Three.js r186 `9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8` |
| --- | --- | --- | --- |
| quest-vr | immersive-vr | immersive-vr-session.html | webxr_xr_ballshooter.html |
| quest-mr | immersive-ar | hit-test.html | webxr_ar_hittest.html |
| android-ar | immersive-ar | hit-test.html | webxr_ar_hittest.html |

The final Firefox command passed **26 focused checks** and all six scenarios with **zero application errors**. Initial/restarted XR callbacks were: Quest VR Sample **159/38**, Quest VR Three.js **159/36**, Quest MR Sample **95/33**, Quest MR Three.js **92/33**, Android AR Sample **147/37**, and Android AR Three.js **150/34**. Each first session stopped callbacks on end, each restarted session had fresh inputs and ended once, and extension uninstall stopped the final active presentation. All five recorded cleanup outcomes passed. The focused Chromium lifetime regression passed on **156.0.8078.4** for all three profiles, including background-worker suspension without presentation shutdown.

Samples select base layers and Three.js selects projection layers with normal capability exposure. The AR applications retain their required `hit-test`; optional features are recorded as requested and negotiated. Ballshooter retains its GPU-only optional depth request, which is omitted, and the ARButton retains its unsupported optional DOM Overlay request. A projection layer does **not** require requesting the `layers` descriptor: [Layers WD 2026-08-11 §2](https://www.w3.org/TR/2026/WD-webxrlayers-1-20260811/#initialization) requires projection support independently. This explains the ARButton path without changing application requests; no Issue acceptance correction was necessary.

Other pinned references are the [Device CRD 2026-06-09](https://www.w3.org/TR/2026/CRD-webxr-20260609/), [AR CRD 2025-04-25](https://www.w3.org/TR/2025/CRD-webxr-ar-module-1-20250425/) and [Hit Test WD 2025-12-11](https://www.w3.org/TR/2025/WD-webxr-hit-test-1-20251211/). No normative requirement was relaxed for a failure.

The focused fixture covers first-script globals/CSP, privileged bridge buffers, an injected frame, tab isolation, inline/immersive support, activated unsupported-mode/required-feature rejection, optional omission, fresh no-activation rejection, viewer/controller poses, select/squeeze sequencing, configuration reload, profile/mode switch, explicit end/restart, foreign-session spaces/layers, inactive retained frames and extension unload. A Firefox unload defect was fixed: isolated-world timers disappear on unload, so the MAIN-world active-session timer now synchronously checks for the isolated bridge. The check does not wake or keep alive the event page; background suspension is not extension unload.

Historical failures remain meaningful:

- The earlier Playwright Firefox 157 `about:debugging` navigation timed out before installation; it was never a runtime pass. This runner bypasses that route with a selected official browser and temporary installation API.
- This implementation's initial actor/resource and observer attempts failed, then the real remote-panel route and process-script observer were established. Default configuration has no storage key until changed; its absence is not a persistence failure. WebDriver sandbox `instanceof ArrayBuffer` is a cross-realm test mistake; the final bridge assertion reads the actual GLB magic bytes instead.
- A Sample placement observer imported through the WebDriver sandbox observed a separate module instance. The final observer uses the application's BiDi realm. Left-click manipulates the phone gizmo; the documented right-click route supplies screen input. These were harness failures, not application-source workarounds. A direct source-texel equality check also failed on the minified phone despite visible application output; the final phone check measures resampled foreground contrast and retains screenshots and raw differences. Sample clone counts describe the cloned hierarchy, not a count of flowers.
- Before the production lifetime fix, uninstall left Firefox presentation active. The corrected check and targeted Chromium suspension/unload regression are recorded separately.
- Three.js/Rapier/controller-model warnings and Firefox's own privileged UI/driver diagnostics are retained separately from application errors. The runner checks application error logs. It does not count driver diagnostics as successful rendering evidence.

This establishes only the bounded Firefox prerequisite. Additional application scenarios in the parent compatibility goal, full WPT/IDL/permission behavior, broader Firefox versions and physical-device results remain untested here. GPU depth, persistent anchors, reflection cubemaps, additional layer types/arrays/formats, marker tracking, raw camera, observer views, WebGPU and haptics retain the capability inventory's unfinished/deferred statuses. Required post-merge verification: none.
