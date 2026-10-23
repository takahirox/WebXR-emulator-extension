# Reference-space requests (Issue #39)

`XRSession.requestReferenceSpace()` now validates the genuine receiver before
converting its required enum argument once. Binding failures return rejected
Promises, preserving thrown coercion values. Supported calls return fresh
session-owned spaces, including viewer spaces. The session's allocation closure
keeps the reference object, bounded subclass and successful Promise in the
session's realm when methods are borrowed across injected same-origin frames or
popups. The regular operation is writable, enumerable and configurable, with
one required argument.

Successful creation/resolution and unsupported rejection are queued as tasks.
These results remain pending through the calling task's microtasks; binding
failures are already rejected. Timer tasks are the polyfill's scheduling
mechanism; the tests make no assertion about ordering relative to other task
sources. Local/floor origins, the authored 2 × 2 m bounded polygon and fixed
unbounded origin remain unchanged. Each viewer space samples the virtual viewer
at pose-query time; independent origin offsets compose without sharing state.

The existing capability policy is unchanged: immersive sessions default to
`viewer` and `local`, with explicit negotiation required for `local-floor`,
`bounded-floor` and `unbounded`. Inline grants only `viewer`; unsupported optional
features are omitted and unsupported required features reject. Quest VR/MR are
mutually exclusive selected modes. Android has no immersive VR mode.

## Retained requirement correction

**Original assumption:** every request on an ended session must reject with
`InvalidStateError`.

**Correction:** the pinned [Device request algorithm (§4.1)](https://www.w3.org/TR/2026/CRD-webxr-20260609/#dom-xrsession-requestreferencespace)
and [support/allocation algorithms (§6.2)](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrreferencespace-interface)
contain no general ended-session gate. Valid granted types still allocate fresh
spaces after end, or when end occurs while requests are pending. Ungranted types
still reject with `NotSupportedError`, and binding errors still reject before
support processing.

**Primary evidence and rationale:** those algorithms condition requests on
support and allocate in the session's relevant realm. Requesting a space does
not reactivate presentation. Existing checks on frames, render-state changes,
input and repeated `end()` remain intact. Pending and after-end requests are
verified to settle once without callbacks, inputs, presentation canvases or
previously disposed framebuffers restarting.

**Recorded divergence:** [Chromium source at f842f52](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/third_party/blink/renderer/modules/xr/xr_session.cc#L837)
checks `ended_` and returns an immediately resolved Promise for supported spaces.
This implementation follows the agreed pinned Device baseline. Chromium-hosted
extension results below are emulator results, not native Chromium conformance.
The [pinned WebIDL source (622910c)](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs)
provides receiver validation before overload conversion, enum `ToString`,
Promise rejection on operation exceptions, and the regular-operation descriptor.

Carry this original assumption, correction, primary references and rationale into
the eventual Issue/PR record. This implementation node does not edit GitHub,
open a PR or perform independent AI review. No further requirement correction
was necessary. No post-merge verification is required.

## Focused reproduction

Use the repository's locked dependencies and real extension builds:

```sh
npm ci
npm run build:firefox
npm run test:reference-space:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver \
npm run test:reference-space:firefox
git diff --check
```

Chromium defaults to Playwright's installed Chromium; optionally set
`WEBXR_CHROMIUM_EXECUTABLE`. Firefox uses the same official 157.0 build and
geckodriver 0.37.1 as the [existing Firefox runner](firefox-runtime.md). The two
commands execute the same [page cases](../tests/reference-space.ts) through the
[focused runner](../tests/reference-space-browser.ts). They install the actual
unpacked/temporary extension, select profiles with the real DevTools panel and
create sessions with real activation clicks. No native fake-device service or
manual page injection substitutes for the extension. Cross-realm cases use
separately injected `/frame` documents and popups, borrow methods both ways,
and retain borrowed functions after closing their documents. Deterministic
geometry movement uses the existing `webxr-pose` / `webxr-input-pose` bridge
consumed by the actual adapter, with the phone following its virtual tablet.
The harness drives this bridge directly for numerical pose assertions; it does
not claim new pointer-driven TransformControls coverage.

Both browsers exercise Quest VR, Quest MR, Android AR, Quest inline and Android
inline. Cases include receiver/proxy/prototype rejection; required enum,
boxed/coercible strings, Symbols and thrown coercion values; microtask versus
task settlement; default/required/optional/omitted grants; concurrent/sequential
identity; allocation and Promise realms; moving viewer identity and composed
offsets; fresh bounded geometry; local/floor origins and distant unbounded
navigation; foreign ownership and inactive frames separately; pending-at-end and
after-end allocation; and shutdown/resource retention. Local JSON reports are
`test-results/reference-space-{chromium,firefox}.json`. The versioned
[validation record](webxr-reference-space-validation-2026-10-24.json) records
actual outcomes, versions, exact source/package hashes, resolved harness failures
and unperformed checks. Earlier six-application Firefox evidence does not count
as execution of these contracts.

## WPT attribution and adaptations

Applicable assertions were adapted from these files at pinned WPT revision
**e1859580b5fcf74940a18d2f783296b4961035e3**:

- [xrSession_requestReferenceSpace](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/xrSession_requestReferenceSpace.https.html): invalid enum rejection, successful reference-space types and inline bounded/unbounded rejection.
- [xrSession_requestReferenceSpace_features](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/xrSession_requestReferenceSpace_features.https.html): default viewer/immersive local grants, explicit floor grants and ungranted-type rejection.
- [xrSession_viewer_referenceSpace](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/xrSession_viewer_referenceSpace.https.html): viewer-relative pose identity before and after virtual viewer movement.

WPT's `TRACKED_IMMERSIVE_DEVICE`, native fake-device setup and
`fakeDeviceController.setViewerOrigin()` are replaced by the installed emulator,
real selected profiles/activation and its existing pose bridge. Numerical matrix
comparisons use a 1e-4 tolerance for gl-matrix float32 arithmetic. The WPT fixtures
that require or optionally grant inline `local`/`local-floor` are replaced by
explicit rejection/omission assertions under the emulator's viewer-only inline
policy; no capability was enabled to make fixtures pass. Tests extend the
applicable assertions to MR/phone, fresh identity, realms, conversion, queuing
and shutdown. These are focused adaptations, not verbatim upstream WPT execution
or a full WPT/IDL pass. The optional pinned Three.js startup scenario was not run;
existing Three.js application evidence remains separate. Generic suites and
independent AI re-review were not run for this Issue.
