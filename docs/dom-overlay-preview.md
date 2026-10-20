# Interactive DOM Overlay Preview — Issue #17

This is the current, limited emulator product scope: show an application's original live HTML root and run its existing event listeners through ordinary desktop input. It is explicitly opt-in and **does not claim native WebXR DOM Overlay conformance**. Issues #13 and #15 were administratively closed with unfinished standards scope; the [earlier report](dom-overlay-implementation.md) preserves that work and its limitations.

## Use the preview

Select **Generic Android Phone (ARCore)** or **Meta Quest 3 → MR** in the WebXR DevTools panel. Enable **Interactive DOM Overlay Preview**, then enter AR using the application's existing request:

```js
const session = await navigator.xr.requestSession('immersive-ar', {
  optionalFeatures: ['dom-overlay'],
  domOverlay: {root: document.getElementById('overlay')}
});
// Enabled only for the opted-in preview: frozen {type: 'screen'}.
console.log(session.domOverlayState);
```

No app event-listener replacement is needed. Mouse clicks, checkbox changes, text entry, input/change events, focus, and scrolling use browser-native controls. The root retains its DOM parent and identity. Android normally projects it onto the virtual phone; body roots and roots with fixed descendants use a flat panel. For small text or complex layout, **Android layout → Flat desktop panel** provides an explicit fallback without changing application API calls. Quest MR always uses one flat desktop panel above its MR preview. The panel is not duplicated into eye views and has no controller/hand targeting.

Both controls persist in local extension storage. Missing/invalid values default to off/automatic layout. Changing either control, profile or Quest mode ends an active immersive session before applying the new configuration. Opt-in alone does not present UI. The option is emulator configuration, not a privileged application permission.

## Negotiation and root limits

| Request | Result |
| --- | --- |
| Opt-in + eligible AR mode/root + optional or required `dom-overlay` | Feature in `enabledFeatures`; frozen `{type: 'screen'}` state |
| Opt-in off, inline/Quest VR, unsupported root or unavailable popover API | Optional omission/null state; required `NotSupportedError`; no root mutation |
| Application cancels `beforetoggle` / root cannot enter popover top layer | Restore root; optional omission/null state or required `NotSupportedError` |
| Malformed dictionary root, including a non-Element | `TypeError` during conversion, even if optional or opt-in off |
| `domOverlay` supplied but feature not requested | No preview |

Roots must be connected HTML Elements in the current document's body/light tree. Document-element, SVG, foreign-document, disconnected, embedded/replaced-control roots (`iframe`, `frame`, `object`, `embed`, `canvas`, `video`, `audio`, `img`, `input`, `select`, `textarea`), roots inside shadow trees, existing popovers, inert roots/ancestors and documents with active modal dialogs are declined. Shadow/custom-element descendants and iframe controls are not validated as supported components. Native browser boundaries still apply if these exist: the emulator neither inspects opaque content nor forwards events/poses into it.

`screen` describes desktop composition, including the projected phone surface, and remains observable after the enabled session ends. It does not assert that the browser enabled its native DOM Overlay subsystem. Missing dictionaries/root requests cannot enable the feature. Genuine foreign-realm Element brand conversion still precedes root eligibility; dictionary getters remain single-read.

## Presentation, input and cleanup

`DOMOverlay.ts` uses a manual native popover on the original root. This gives top-layer painting without reparenting, serialization, capture permissions or duplicate form state. Temporary inline rules size, position and clip the root; its original display layout, color and background are retained where possible. Initially hidden/boxless roots receive a visible box. Phone projection uses the actual screen world matrix, observer camera and canvas CSS viewport; display DPR updates its logical dimensions. Back-facing/behind-camera screens remove the whole subtree from painting/hit testing. A native wheel listener keeps perspective scrolling on the main thread without canceling the browser default action. Flat layout uses a maximum 560-CSS-pixel-wide panel inset 24 pixels from the viewport, with native overflow scrolling.

The previous pointer-to-XR touch queue, DOM hit-target ray mapping, frame style blocking and synthesized `beforexrselect` path were removed. Preview code has **no pointer listener that creates XR input**. The session dispatches ordinary XR actions only through its existing device input path. Desktop DOM actions and XR device controls are independent. In particular, there is no claim of the specification's cross-origin XR forwarding guarantees: this preview does not perform that forwarding at all. No global shadow API patches, privileged message bridge, browser permissions, remote code or experimental flags were added.

Startup preserves the focused element where connected. The scene updates the preview even before the application submits an XR layer. End, profile/mode/setting changes, root removal/reparenting, top-layer dismissal and pagehide dispose it; document hiding temporarily removes it from painting/hit testing. Cleanup aborts listeners, disconnects the observer, clears dismissal timers and restores the original inline style/popover attribute state. Pending CSSOM serialization is flushed before removing a previously absent style attribute. It never reparents or resurrects an application root. Application edits to the root's inline style during presentation are replaced by the startup snapshot on cleanup.

During immersive presentation the isolated content script checks its local extension runtime identity once per second. Extension reload/disable invalidates that context and ends presentation; ordinary service-worker suspension leaves it intact. This uses no worker polling or keepalive. Reload the inspected page before restarting after extension reload so the new polyfill/configuration is applied.

## Intentional limits and future work

There is no native `:xr-overlay` matching, UA-origin overlay stylesheet, native fullscreen/backdrop isolation, `beforexrselect`, world-space ray interaction, XR pose delivery to DOM descendants, eye-correct stereo DOM composition or general CSS/viewport emulation. Apps relying only on `:xr-overlay` to reveal descendants need another visible preview layout. Percentages use preview dimensions, while viewport units/media queries and native control popups use the desktop viewport. Root styles, custom popover backdrops, custom elements, shadow content and iframe UI can require application layout changes. The flat fallback makes simple HTML UI usable without depending on experimental HTML-in-Canvas support or a new rendering library.

Full standards work remains future scope, including the unfinished security/input/CSS/stereo requirements recorded for Issues #13/#15. These preview results must not be described as full DOM Overlay WPT conformance or physical headset certification. See [WebXR conformance](webxr-conformance.md).

## Validation

The [validation record](dom-overlay-preview-validation.json) records the actual command results, browser version and public-preview evidence. The browser suite loads the real unpacked MV3 extension and DevTools panel. Its representative app installs listeners and mutable state before normal `requestSession` calls; the tests never call `_startDOMOverlay` or bypass feature negotiation. It verifies original-root/parent identity, screenshot button pixels, phone/camera projection error below 2 CSS pixels, native app actions/events, focus, checkbox/input state, scrolling before/after resize/DPR/hide transitions, automatic/manual fallback, optional/required/off/on policy and teardown. Late closed-shadow cross-origin frame entry/release produces no XR events or stranded sources. Existing non-overlay VR/AR, renderer, device/bridge, API and separately labeled feasibility tests remain.

| Profile | Visible original-root screenshot |
| --- | --- |
| Android phone projection | [Android preview](images/dom-overlay-preview-android.png) |
| Quest flat MR panel | [Quest preview](images/dom-overlay-preview-quest.png) |

`test:samples` runs seven published Immersive Web scenarios: VR, both profiles' hit-test samples, and Barebones AR with preview off/on on both profiles. It keeps the sample's `domOverlay: {root}` call unchanged and clicks the original enabled preview's Exit AR button, proving the application's listener ends the session. `test:wpt` runs only the five pinned geometry/identity files documented in the conformance report; it is not DOM Overlay conformance testing.

```sh
npm ci
npm run typecheck
npm run build
npm run build:firefox
npm run test:browser
npm run test:wpt
npm run test:samples
# Faster focused reproduction; the full browser suite also runs these cases:
npx tsx tests/dom-overlay-preview.ts
```

The automated `chrome.runtime.reload()` check verifies active-preview cleanup. In command-line-sideloaded Chromium it unloads the extension without restarting its worker; the test then relaunches the same temporary browser profile with the unpacked extension and verifies persisted settings, synchronous injection and a fresh preview session.

Firefox packaging is checked. Firefox runtime/DevTools, physical hardware, arbitrary custom components and full DOM Overlay WPT remain unperformed/out of scope. No post-merge verification is required. This node leaves a local implementation commit; PR publication, review and Issue closure belong to the downstream workflow.
