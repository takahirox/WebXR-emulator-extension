# DOM Overlay rendering investigation (Issue #13)

**Partial result; keep [Issue #13](https://github.com/takahirox/WebXR-emulator-extension/issues/13) open.** Neither Android AR nor Quest MR advertises `dom-overlay`. This checkpoint contains executable browser prototypes, argument-validation fixes, and removal of the unused desktop `z-index` overlay path. It does not implement session overlay presentation or XR/DOM input integration.

## Specification and support decision

On 2026-10-16, the [latest published DOM Overlay module](https://www.w3.org/TR/webxr-dom-overlays-1/) still identified the [24 September 2024 Working Draft](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/) as its current publication. It is not a Recommendation. The relevant requirements are:

- [Sections 3.1–3.2](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#webxr-device-api-integration): negotiate usable presentation and interaction, show the overlay from session start above XR imagery, reject unresolved required features, and report null state when disabled.
- [Section 4](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#initialization): accept an Element root; report a stable type matching the geometry. A phone `screen` overlay must match the XR viewport. Quest needs an actual stereo `head-locked` or `floating` projection.
- [Sections 2.1 and 3.3](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#onbeforexrselect): send a bubbling, composed, cancelable `XRSessionEvent` to the ray-intersected topmost DOM target. Cancellation suppresses the whole XR select sequence independently of DOM input.
- [Sections 2.2–2.4](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#css-pseudo-class): supply native `:xr-overlay`, transparent fixed overlay styling, and appropriate isolation from ancestor painting.
- [Section 5](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#event-handling-for-cross-origin-content): protect poses/gamepad state during cross-origin interaction; blocking that interaction is a permitted alternative.

The implemented negotiation policy remains unsupported in every mode. Required requests reject with `NotSupportedError`, optional requests omit the feature, and `domOverlayState` stays null, including after end. Null/omitted `domOverlay` is accepted as configuration; a supplied dictionary must contain an actual Element. Argument conversion rejects malformed roots with a promise `TypeError`, including for optional requests. Element validation now accepts genuine same-origin foreign-realm Elements and SVG Elements, instead of relying on realm-specific `instanceof`. Ownership/connection restrictions for an enabled overlay remain unimplemented; disconnected and foreign-document roots reach unsupported-feature negotiation without DOM changes.

## Concrete browser prototypes

[tests/dom-overlay-prototype.ts](../tests/dom-overlay-prototype.ts) runs inside the real unpacked extension's smoke test, against the existing ARScene and restrictive script CSP. It is test-only code, never included in the shipped extension. It creates elements with DOM APIs, uses browser-native controls and input, and does not serialize arbitrary page HTML.

### Android: a feasible single-view rendering path

The fixture maps a live 320×640 DOM section to the **actual phone screen mesh**, using its world matrix, observer camera projection/view matrices, and canvas CSS viewport. A CSS `matrix3d` places it over the screen, with transparent background and paint clipping. This differs from a desktop rectangle unrelated to the phone. The browser paints the DOM and performs native hit testing; the application canvas continues to supply XR imagery below it.

Pixel assertions sample a green button inside the phone, and a separately projected Three.js point checks geometric alignment within two CSS pixels. Tests click the original listener, edit a native input, and verify root identity, focus, and live value. They repeat after translating/rotating the phone and translating the observer camera, at 1280×720/DPR 1 and 900×900/DPR 2. Teardown removes the fixture, cancels its RAF, and restores the original phone/camera transforms.

This establishes a promising Android rendering approach. It does **not** establish arbitrary root layout preservation, scrolling/accessibility conformance, visibility behind the observer camera, complete clipping, root removal/adoption behavior, session-start timing, or XR input/security integration. The fixed fixture dimensions are not an application-independent layout contract. Android remains unsupported pending that implementation.

### Quest MR: why the tested stereo workaround fails

The fixture places head-relative DOM rectangles over both actual MR eye viewport regions at DPR 1, DPR 2, and a square resize. Pixel assertions see the controls in both eyes, and native clicks/focus work on the original tree. These are flat eye-region research rectangles, not a validated 3D projection with stereo disparity or controller intersections.

Moving the single root between eye containers leaves it only in the last container. The prototype then tries `cloneNode(true)` for the second eye: both controls are visible, but the copied button does not invoke the original listener, and typing in the original input does not update the copied input. That candidate fails the live-root requirement. Copying event listeners or observing mutations cannot generically synchronize JavaScript property changes, custom elements, shadow trees, selection, canvas/video frames, focus, or document ownership. No Quest overlay type is reported.

The blocker is the absence of a supported live DOM paint source that can be reused in two independently projected eye views while retaining the original DOM interaction targets. This is a blocker for the tested architecture and default browser capabilities, not a claim that every future browser or rendering design makes stereo DOM impossible.

### Native CSS and capture probes

Chromium 156.0.8078.4 parses a real `:xr-overlay` stylesheet (`CSS.supports` is true; one CSS rule survives), but the projected section does not acquire its custom property. The selector is recognized but does not match this emulated overlay. No extension API used here can set the browser's native XR overlay state. Replacing the selector with a class would not implement the specified pseudo-class, top layer, UA cascade, or backdrop isolation.

Passing a live Element to ordinary `CanvasRenderingContext2D.drawImage` produces `TypeError`. The [HTML canvas image-source contract](https://html.spec.whatwg.org/multipage/canvas.html#canvasimagesource) does not provide general DOM capture. In this default browser, the probes for `drawElement`, `drawElementImage`, `layoutSubtree`, `texElementImage2D`, `texElementSubImage2D`, and `updateElementGeometry` are all false.

The emerging [WICG HTML-in-Canvas proposal](https://wicg.github.io/html-in-canvas/) is a relevant future path: browser snapshots could feed both eye textures while DOM geometry supplies interaction. Its explainer describes flag-gated APIs, readback restrictions, and evolving geometry methods. [Chrome's origin-trial article](https://developer.chrome.com/blog/html-in-canvas-origin-trial) describes an earlier API revision and Three.js `HTMLTexture`. The installed Three.js does contain `HTMLTexture`, but that alone cannot supply the missing browser methods. No experimental flags or origin-trial tokens were enabled here; an experimental compositor prototype and multiple-eye input mapping remain future work, not a verified solution.

## Alternatives and security boundaries

| Candidate | Assessment |
| --- | --- |
| CSS perspective/CSS3DRenderer | Useful for the phone's one live view. Two independent renders still share one DOM element and one transform; it does not provide stereo DOM textures. [Three.js documents its renderer's scope and zoom limits](https://threejs.org/docs/pages/CSS3DRenderer.html). |
| Cloned DOM per eye | Tested and rejected for lost identity/listeners and diverging control state. It is not an interactive mirror of arbitrary live content. |
| SVG `foreignObject` / DOM screenshot libraries | Would require serialization or a partial CSS reimplementation. They do not preserve arbitrary live controls, iframe behavior or event identity. No arbitrary HTML serialization was introduced or executed. |
| CSS reflections or element-image backgrounds | Visual copies alone do not establish independent per-eye geometry, native focus/hit targets, or controller intersections. Not implemented or validated. |
| Native tab/display capture | Captures a broader page/display and requires a separate permission/consent flow. It does not supply the required root isolation, input semantics or session-start guarantee; capture feedback is another concern. No capture permission was added. |
| CDP screenshots | Used only by the test harness for pixel evidence. The extension does not have or acquire CDP/debugger privileges; screenshots are not a production rendering path. |
| HTML-in-Canvas | Promising browser-assisted option; unavailable in the tested default profile. Needs a separate experimental investigation, security tests and interaction geometry before feature negotiation can use it. |

No overlay-originated `beforexrselect`, pointer or click events are synthesized by production code. Normal page/iframe behavior remains ordinary desktop behavior. **This is not an implementation of the cross-origin overlay interaction policy.** A future enabled path should prevent embedded-frame XR interaction (conservatively block all embedded browsing contexts if origin/navigation classification cannot be made reliable), and test navigation, sandbox/opaque origins, nested frames and transitions. It must not forward controller state into another frame or grant frame poses while that frame receives XR-derived input. Existing isolated privileged messaging, MAIN-world synchronous injection, CSP and manifest permissions are unchanged.

## Reproduction and remaining acceptance

Run `npm ci`, `npm run typecheck`, `npm run build`, `npm run build:firefox`, then `npm run test:browser` with current Playwright desktop Chromium. The test uses a fresh owned browser profile and cleans it up. See the README for `WEBXR_CHROMIUM_EXECUTABLE` and desktop display requirements. The browser run writes `test-results/dom-overlay-feasibility.json`, `test-results/webxr-conformance.json` and `test-results/dom-overlay-*.png`. [Recorded evidence](dom-overlay-validation-2026-10-16.json) and selected [phone](validation/issue-13/phone-projection.png) / [Quest](validation/issue-13/quest-clone.png) screenshots are checked in.

| Issue #13 acceptance | State at this checkpoint |
| --- | --- |
| Rendering investigation and concrete automated prototype | Exercised; findings above, including rejected stereo clone and native selector/capture probes |
| Negotiation | Unsupported-path coverage only; no supported overlay state/type |
| Android display/input implementation | Unmet; rendering prototype works, XR integration absent |
| Quest MR display/input implementation | Unmet; no usable single-root stereo compositor |
| DOM/CSS behavior | Native selector limitation demonstrated; no full CSS conformance |
| Controller/phone rays, beforexrselect, event cancellation/order | Unmet for overlay; existing XR input regressions still run |
| Cross-origin overlay protection | Unmet for an enabled path; no overlay interactions exposed |
| Session overlay lifecycle and feature integration | Unmet for an enabled path; prototype teardown and existing session regressions covered |
| Required command checks and documentation | Actual results in the validation record; failures/skips distinguished |
| PR/review | Not performed: this GitWeave node is authorized to commit only, without push/PR/comments |

Firefox packaging was checked; Firefox runtime and physical-device fidelity were not tested. The existing WPT subset and published samples do not certify DOM Overlay conformance. No post-merge verification is required. Both Android and Quest display/input requirements must be satisfied before the Issue can be closed.
