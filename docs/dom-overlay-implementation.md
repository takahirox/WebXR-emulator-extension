# DOM Overlay implementation checkpoint (Issue #15)

**Partial implementation; [Issue #15](https://github.com/takahirox/WebXR-emulator-extension/issues/15) must remain open.** Android has a production live HTML screen-overlay path with the restrictions below. Quest MR remains disabled. This is not full DOM Overlay or CSS conformance, and does not complete every Android acceptance requirement either. Issue #13 was administratively closed after the earlier investigation; it is not the current implementation tracker.

## Specification and negotiated support

Checked against the latest published module on 2026-10-16, pinned to the [24 September 2024 Working Draft](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/). The [earlier investigation](dom-overlay-feasibility.md) remains historical evidence, not production acceptance.

| Configuration | Production negotiation | Presentation/input |
| --- | --- | --- |
| Generic Android Phone, `immersive-ar`, connected HTML root in the requesting document | Enabled when native popover and `onbeforexrselect` facilities exist | Original live root projected onto the actual moving phone screen; `domOverlayState.type === 'screen'` |
| Quest 3 MR, `immersive-ar` | Required rejects; optional omitted; state null | No supported single-root stereo compositor/controller targeting |
| Quest VR / any inline session | Required rejects; optional omitted; state null | Unsupported |
| Disconnected, foreign-document, SVG, document-element, embedded-context, existing popover or modal root | Required rejects with `NotSupportedError`; optional omitted | No styling, adoption or presentation side effects |
| Malformed/missing dictionary `root` | Promise rejects with `TypeError`, including optional requests | WebIDL Element brand conversion precedes negotiation |

Omitted/null `domOverlay` is accepted as configuration; requesting the feature without a usable root cannot enable it. Dictionary getters are read once. Genuine foreign-realm Elements pass interface conversion; an adopted, connected HTML Element owned by the requesting document can be presented despite its foreign prototype. A foreign document's root cannot. Session features and the frozen `screen` state reflect negotiation; the state remains stable after end, as required by [initialization](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#initialization).

## Android production path

`src/polyfill/DOMOverlay.ts` puts the original root into the browser's **native popover top layer**, without reparenting or copying it. Its CSS matrix maps DOM layout pixels through the actual phone screen world matrix, observer view/projection matrices and canvas CSS viewport. Percentage layout uses the phone framebuffer dimensions divided by display DPR. A DPR change updates the root's logical size; camera/phone motion and resizing update the projection. Native browser painting, clipping and hit testing preserve listeners, control values, focus and scrollable descendants. A non-passive wheel listener leaves default scrolling intact while routing perspective-surface wheel hit testing through the main thread; this fixes the intermittent post-resize scrolling failure observed without it. Behind-camera, near-plane-crossing and back-facing screens hide the overlay instead of exposing a mirrored hit surface.

The emulator canvas is placed outside `body` for overlay sessions so that a supplied `body` root cannot transform the compositor itself. The renderer is present when the session promise resolves, before the application submits a layer. Paint containment clips descendants to the phone rectangle; the desktop viewport clips the full-screen renderer/overlay. XR imagery does not cover the overlay. The existing Layers compositor continues to supply the application image below it.

**Interaction:** use the primary/left mouse button on the projected controls; these are native DOM controls, not controller-click replacements. A captured native primary pointer also queues a transient phone screen touch. Down/up edges survive clicks shorter than an XR frame, moves are coalesced without losing the initial target, and held touches are recomputed against phone motion. Existing right-button phone interaction remains available for sessions without an overlay.

Before a touch generates XR `selectstart`, the session dispatches a bubbling, composed, cancelable `XRSessionEvent('beforexrselect')` at the browser-hit-tested topmost target. Cancellation suppresses `selectstart`, `select`, and `selectend` for that action, without canceling native DOM click/focus. It is remembered until release even if the pointer changes targets. Ending the session inside the handler prevents subsequent XR action dispatch. Existing non-overlay input/event ordering is preserved. As elsewhere in this emulator, XR action processing begins once an application submits a presentation layer; native DOM input works before that.

## Security and lifecycle

The implementation takes the conservative restriction permitted by [section 5](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#event-handling-for-cross-origin-content): embedded `iframe`, `frame`, `object`, and `embed` content in the inspected light/open-shadow tree cannot receive overlay pointer interaction, including same-origin contexts. Their pointer hit testing is disabled while the overlay is active; their displayed bounding regions also block transient touch creation. This deliberately over-blocks rotated/overlapped frame regions. Origin, sandbox and navigation changes cannot grant access. Outer blocked contexts also block their nested contexts. No events, poses or gamepad state are forwarded to an embedded document, and no bridge permissions were added.

This restriction concerns XR-derived/overlay pointer interaction; ordinary keyboard/assistive-technology navigation is not replaced. **Closed shadow trees/custom elements are not certified**: a page script cannot inspect their embedded contexts or provide the UA-level security guarantees for arbitrary hidden content. Complete arbitrary-root security acceptance remains outstanding; applications relying on opaque component internals are outside the verified subset.

End, device/profile switching, pagehide, root removal/reparenting and top-layer dismissal release the overlay. Closing from `beforetoggle` defers teardown to a later task so cleanup does not invalidate the browser's ongoing `hidePopover()` operation. Cleanup restores the original inline styles and popover attribute state, restores inspected frame styles, removes event listeners/observers and clears queued touches/timers. The implementation never resurrects a root removed by the application or moves a root back after an application reparenting. Hidden documents cancel active touches and hide the surface. The overlay runs in the existing MAIN world and does not depend on a live extension worker.

## Native CSS and browser limits

The native top layer escapes ancestor transforms, opacity and clipping while preserving DOM ancestry and inherited selectors. It is **not the native XR overlay state**:

- The browser parses `:xr-overlay` but it does not match this element. No class replacement, selector rewriting, patched `matches()`, or claimed native CSS conformance was introduced. Applications that reveal/style controls only through this pseudo-class will not work as native overlays do.
- [Sections 2.2–2.4](https://www.w3.org/TR/2024/WD-webxr-dom-overlays-1-20240924/#css-pseudo-class) require UA cascade, backdrop-root and fullscreen behavior beyond a scripted popover. Those semantics are not fully implemented. Author popover/backdrop rules can affect presentation. The root uses temporary inline layout/compositing rules; this is not a UA-origin stylesheet. Its pre-session computed color is retained to avoid the popover UA default changing inherited color; live changes to ancestor color are not fully reproduced at the root.
- Root percentages use phone dimensions; `vw`/`vh`, media queries, `window.innerWidth/innerHeight` and browser-native control popups still belong to the desktop viewport. Full arbitrary responsive CSS and viewport emulation are outstanding.
- SVG roots, existing popovers, modal roots and `documentElement` are deliberately not enabled. Complex shadow/custom-element, keyboard/accessibility and arbitrary-root behavior require further acceptance work.

These are material restrictions. The passing HTML fixtures and published sample establish a usable production subset, not completion of the Issue's arbitrary-root or full native CSS requirements.

## Quest: tested blocker and experimental alternative

Default Chromium **156.0.8078.4** still has no general Element canvas image source: ordinary `drawImage(Element)` throws `TypeError`; the proposed element-paint/upload/geometry methods are absent. The unpacked-extension research tests again demonstrate why two-eye `cloneNode(true)` loses listeners and live control state. Neither clones nor a desktop overlay are used in production, and no `floating`/`head-locked` type is reported.

A separate reproducible [capture probe](../tests/dom-overlay-capture.ts) launches isolated **headless** Chromium with and without `--enable-experimental-web-platform-features`. With that flag, `drawElementImage`, `captureElementImage` and `updateElementGeometry` are available. One live root paints into two canvas rectangles; changing its button color updates both snapshots. Default automatic native hit geometry belongs only to the last painted rectangle (`CANVAS` vs `BUTTON` at the two sampled locations). This is promising paint-source feasibility, **not validated stereo XR rendering or controller input**. It has no per-eye projection/disparity, controller ray mapping, security or lifecycle integration.

The [WICG explainer](https://wicg.github.io/html-in-canvas/) describes changing flag-gated APIs; the [Chrome origin-trial article](https://developer.chrome.com/blog/html-in-canvas-origin-trial) describes an earlier trial. A release cannot silently enable browser flags or provision trial tokens for arbitrary application origins. No supported deployment strategy is established here. A future compositor could paint one captured root into both eye textures and map controller intersections into its DOM geometry, but must validate those APIs, interaction/focus and cross-origin restrictions first. Native browser support would also be needed for exact `:xr-overlay` semantics. The standard extension launch uses no experimental DOM-capture flags.

## Validation and remaining acceptance

The [machine-readable record](dom-overlay-implementation-validation.json) contains actual results and links to selected screenshots. Run the following from the repository root with current Playwright desktop Chromium:

```sh
npm ci
npm run typecheck
npm run build
npm run build:firefox
npm run test:browser
npm run test:wpt
npm run test:samples
# Optional, isolated experimental capability test; never a release launch:
npx tsx tests/dom-overlay-capture.ts
```

`test:browser` runs production negotiation, native input, pixel/geometry assertions at DPR 1/2, active resizing, translation/rotation, observer motion, scrolling, frame restrictions, cancellation and cleanup, plus existing API/renderer/bridge regressions. The test uses the shipped runtime; the older projection/clone prototypes remain separately labeled research. Reports are written to `test-results/`. `test:samples` additionally exercises the real [Barebones AR DOM Overlay sample](https://immersive-web.github.io/webxr-samples/ar-barebones.html): Android reports `screen` and exits through its original live DOM button; Quest reports no overlay. The five pinned WPT files are a geometry/identity subset, **not DOM Overlay WPT conformance**. Native fake-device overlay WPT setup has not been ported; do not infer it from the passing subset.

| Issue #15 requirement | Checkpoint status |
| --- | --- |
| Android live HTML rendering and native controls | Implemented/tested for the restricted subset; arbitrary SVG/responsive/opaque-root acceptance remains unchecked |
| Quest single-root stereo rendering/controller input | **Unchecked**, default-browser paint-source/deployment blocker; experimental paint test only |
| API negotiation/state | Tested supported HTML phone path and unsupported paths; broader native WebIDL/IDL conformance not claimed |
| beforexrselect | Phone target/cancellation/order/held-input/shutdown checks; Quest interaction unchecked |
| Cross-origin security | Conservative inspected-frame blocking tested; arbitrary closed-component guarantees unchecked |
| Native CSS | Mismatches disclosed; **unchecked** full native pseudo-class/UA/backdrop semantics |
| Lifecycle/coexistence | Covered by focused phone and existing extension regressions; Firefox runtime and complex component lifecycle untested |
| Required commands, real sample and documentation | Recorded actual results; no full WPT or physical-device certification |
| PR/review | Not performed: this node is authorized to commit only, without push/PR/comments |

Do not close Issue #15 on this checkpoint. Firefox packaging is checked; Firefox runtime/DevTools and physical devices are not tested. No post-merge verification is required.
