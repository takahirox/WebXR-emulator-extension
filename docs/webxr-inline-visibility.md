# Inline visibility and frame suspension (Issue #43)

Live inline sessions mirror the owning document's `visibilityState`. Immersive
presentation separately suspends inline frame processing: queued callbacks retain
registration order, cancellation remains effective, and surviving callbacks resume
when presentation ends and the document is visible. Entering or leaving immersive
presentation does not change inline visibility or emit a visibility event.

The original runtime, conformance fixture and inventory revision 12 incorrectly
assumed immersive presentation made inline sessions hidden. The correction follows
the [Device CRD, 9 June 2026, §4.1](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrsession-interface)
(document-mirrored inline visibility), [§4.3](https://www.w3.org/TR/2026/CRD-webxr-20260609/#animation-frames)
(independent inline loop suspension during immersive presentation) and
[§12.6](https://www.w3.org/TR/2026/CRD-webxr-20260609/#event-types)
(`XRSessionEvent` visibility notifications). Scheduling suppression must not
manufacture visibility transitions. The runtime now reads document visibility
without considering immersive ownership, and checks the independent suppression
flag before consuming frame callbacks or applying rendering work. Existing
`XRSystem` ownership and `_finish()` release that flag on explicit and adapter
shutdown. Ended sessions remove their document listener and drop callbacks.

The [historical report](webxr-validation-2026-10-16.json) is retained with an explicit
correction reference. Issues #41/#42 established reference-space shutdown behavior,
not this visibility correction. Historical broad partial outcomes do not establish
completion of deferred modules; the inventory retains those modules and limitations.
This correction adds no feature descriptor, changes no device profiles or negotiated
capability, and requires no post-merge verification.

Run the focused suites with locked dependencies and genuine packaged extensions:

```sh
npm ci
npm run build:firefox
npm run test:visibility:chromium
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
npm run test:visibility:firefox
git diff --check
```

Firefox tooling comes from the official archives linked in
[Firefox runtime reproduction](firefox-runtime.md). Paths may point to another
location containing those same pinned executables. Chromium defaults to the
installed Playwright Chromium; `WEBXR_CHROMIUM_EXECUTABLE` optionally selects an
executable. Both runners reuse `cdp-target.ts`, `firefox-driver.ts`, the real
DevTools panel and genuine extension injection route from the reference-space
runner. Every immersive session starts from a real automation click. Chromium uses
Playwright’s forced click to bypass its RAF-based stability wait; the browser
still dispatches native input to the real fixed-position entry button. No page-only
polyfill injection, fake XR service or profile substitution is used.

The [page fixture](../tests/visibility.ts) adapts the initial visible assertion,
hide event/state assertion and restore event/state assertion from pinned WPT
[`xrSession_visibilityState_inline.https.html`](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/xrSession_visibilityState_inline.https.html).
The existing `test:wpt` selection does not execute that file. These focused tests
extend the adapted sequence across Quest VR, Quest MR, Android AR and inline-only
operation on both profiles. They cover sessions created before/during presentation
and while hidden, visible explicit end, adapter end while hidden followed by
restoration, listener/property event identity and exact sequences, duplicate
unchanged document notifications, cancellation, ordered native RAF resumption,
independent canvas pixels, and ended-session listener/callback release.

Chromium is launched directly in a fresh temporary profile and connected through
Playwright `connectOverCDP({noDefaults: true})`. The installed Playwright otherwise
forces `Emulation.setFocusEmulationEnabled` on its own CDP session, causing native
background tabs and minimized windows to continue reporting visible. Disabling it
on a second CDP session does not clear the first session's override. No focus or
visibility emulation is enabled in the final runner. Normal background timer /
renderer scheduling flags prevent occlusion from stalling automation and preserve
native tab visibility; assertions still require actual hidden/visible states.
Chromium also uses the existing test-style mock keychain/basic password-store flags
in its disposable profile. The extension, panel and
browser control helpers remain the same genuine routes.

Native tab selection in the browser UI hides/restores the document. Both
`document.visibilityState` and `document.hidden` are checked; neither is overridden.
Repeated synthetic document events test only unchanged-notification deduplication.
The existing broad `conformance.ts` fixture retains a separately identified
synthetic visibility-state check; it is not evidence of native hide/restore.

Additional deterministic instrumentation is limited to invoking the real session
`tick(performance.now())` while suppressed/hidden, cancelling only its extra
scheduled RAF and retaining the original native handle. This forces the real
guard to run despite background-tab throttling. Resumed callbacks run through
native RAF. The fixture also observes callback queue sizes, briefly wraps document
listener registration/removal to verify exact release, and uses the real adapter
`endSession` notification for device exit. Wrappers are restored in `finally`.
Sessions, temporary profiles, browser processes and Firefox's temporary addon are
owned by the runner and removed on cleanup.

[Executed validation](webxr-inline-visibility-validation-2026-10-24.json) records
exact commands, versions, source/bundle hashes, observations, failures and cleanup.
Local detailed reports are written to `test-results/visibility-{chromium,firefox}.json`.
Fixture existence alone is not an execution claim. No generic application rerun,
independent AI review, PR, push, merge or GitHub comment is part of this task.
