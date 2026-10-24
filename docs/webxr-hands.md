# Simulated hand input

Issue [#59](https://github.com/takahirox/WebXR-emulator-extension/issues/59) completes individual hand bindings and validates the original Three.js hand example. The skeletons and radii are **simulated**, deterministic virtual input, not measurements of a physical hand. Quest VR (`immersive-vr`) and Quest MR (`immersive-ar`) retain `hand-tracking`. Android exclusion is emulator profile policy; inline sessions do not grant the feature. Unsupported required requests reject `NotSupportedError`; optional requests omit it. Sessions without granted hand tracking retain null hands and controller behavior.

## Bindings and articulation

`XRHand`, `XRJointSpace` and `XRJointPose` public constructors throw, including reflective construction. They retain `XRSpace`/`XRPose` inheritance. `size`, `jointName` and `radius` are branded readonly prototype accessors. Forged prototypes and proxies fail their receiver checks. Each hand retains 25 ordered joint identities, and its input source retains the same hand. Membership maps, joint records and radius records stay in closure-owned WeakMaps. Shared registry readers and returned metadata are frozen; readers expose no registration, replacement or deletion methods. Entry arrays and returned pose matrices cannot mutate subsequent membership or native joint samples.

The shared backend tracker initializes the canonical hand for a connected source before input-source events. Additional trackers retrieve that same hand, and cannot substitute prototypes or insert caller-supplied joints, membership lists, providers, radii or pose records. The general space superclass no longer has a boolean that brands an allocation as a joint. Binding protection is scoped to hands; arbitrary monkey-patching of emulator diagnostics/backend objects is not a native security-isolation boundary.

`get()` validates its receiver and required argument, then performs enum ToString conversion with the string hint. Boxed strings and coercible objects work; Symbols, invalid converted names and missing arguments throw `TypeError`. Abrupt coercions propagate unchanged. Pair iteration preserves specification order, `Symbol.iterator === entries`, independent cursors, a branded `next`, stable completion and the `XRHand Iterator` prototype/tag. `forEach` supplies `(joint, name, hand)` with the requested receiver and preserves callback exceptions. The relevant WebIDL descriptors and arities are exercised in both injected realms.

`getJointPose()` converts its receiver and required interface arguments before checking frame state. Invalid bindings throw synchronous `TypeError`; inactive frames and foreign-session joint/base spaces throw `InvalidStateError`. Both owners are checked before tracking availability. Borrowed bindings accept genuine interfaces from separately injected same-origin realms, and fresh poses/transforms/typed arrays use the session's relevant realm. Retained pose geometry and radius values survive later movement, curl, retirement and shutdown.

Positions are in metres. Wrist radius is simulated as 18 mm; tips are 7 mm and other joints 9 mm, exposed at WebIDL float precision. Controller translation/rotation move the whole hand; its primary trigger deterministically curls its fingers. Joint -Z follows the outgoing bone (tips continue the distal bone), with palm roll fixed by +Y. Whole-hand tracking loss makes individual and bulk queries unavailable, including self-relative joint queries; bulk matrices/radii contain NaNs. Recovery preserves identities. Source removal retires its joints permanently; reacquisition and session restart create replacement identities. Ordinary non-joint static geometry behavior is preserved.

Primary references are [Hands WD 2024-06-05](https://www.w3.org/TR/2024/WD-webxr-hand-input-1-20240605/), especially §§3.3–4.2; [Device CRD 2026-06-09](https://www.w3.org/TR/2026/CRD-webxr-20260609/); and [WebIDL 622910c](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs), enum conversion, interface bindings and pair iterators. The [pinned WPT IDL](https://github.com/web-platform-tests/wpt/blob/e1859580b5fcf74940a18d2f783296b4961035e3/interfaces/webxr-hand-input.idl) corroborates signatures; its IDL harness supplies no hand instances. This is source evidence, not an executed WPT pass.

The original unknown-key assumption suggested returning undefined based on Hands §3.3's final algorithm step. The corrected requirement is `TypeError` for invalid converted enum names: WebIDL enum conversion runs before that algorithm. This reconciliation was already explicit in #59; no new acceptance correction or requirement relaxation was needed. The tests also preserve all-or-none availability from Hands §3.4 rather than exposing a lost hand through a self-relative shortcut.

## Reproduce

Install locked dependencies with `npm ci`. Build and run only the focused selections:

```sh
npm run build:firefox
npm run test:hands:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/geckodriver npm run test:hands:firefox
npm run test:hand-applications:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/geckodriver npm run test:hand-applications:firefox
git diff --check
```

Use the official Firefox and geckodriver downloads in [Firefox setup](firefox-runtime.md#reproduce). Chromium defaults to the locked Playwright desktop browser; `WEBXR_CHROMIUM_EXECUTABLE` optionally selects another executable. Each runner uses a fresh owned profile, installs the unpacked extension, opens the genuine DevTools WebXR panel, records versions/hashes, and removes its browser/profile/add-on resources. Fresh output goes to ignored `test-results/`.

The contract commands use the existing `reference-space-browser.ts` runner with `hands`, selecting Quest VR, Quest MR, Android AR and inline on both profiles. A test-only COOP/COEP route gives parent and child real shared/growable buffer coverage. Both populated realms exercise borrowed hand/joint/pose/frame/iterator bindings in both directions. The fixture uses real WebGL and RAF/input-event frames. It temporarily removes/restores a native gamepad slot synchronously, moves/restores native poses/buttons and toggles/restores existing input activation. No production testing API was added. Bulk coverage includes conversion, cross-realm fixed outputs, offsets, duplicates, one-shot iterables, insufficient capacity, ownership before capacity, unchanged buffers on failure, wrong typed arrays, proxies, detached buffers, resizable buffers, shared/growable buffers, loss, retirement and recovery.

## Unchanged Three.js consumer

The application commands reuse `tracking-browser.ts` and `firefox-upstream.ts`. They fetch [the original r186 handinput example](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/examples/webxr_vr_handinput.html) and every dependency byte-for-byte at commit `9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8`. The HTML SHA-256 is `a3609dd5c64e3e4ef2e48daf26fefb478c967453ca1fbce405687dfdcf7b3afa`. All fetched module URLs, byte lengths and hashes are in the application reports. No application or dependency logic, materials or geometry is edited. Its default factory creates sphere instances, so no replacement hand asset or custom renderer is needed.

The example's original VRButton requests **immersive-vr**, with required hand tracking. Both browsers execute **Quest VR only** for this unchanged consumer; this is not unchanged Quest MR application coverage. API contracts separately cover Quest MR.

Observation is disclosed: the existing Three.js devtools event exposes original scene objects; scene callbacks and XR request/frame/joint-pose wrappers retain their original receivers, arguments, results and exceptions. After the application's original render callback, the observer compares every consumed joint transform/radius with its original Three.js joint and sphere-instance transform/scale. Presentation readback projects the actual instances through each eye's camera and counts bright sphere pixels near the joints. Reports retain per-joint matrices/radii, matrix/scale errors, per-eye pixel counts/changes, texture hashes and screenshots. Joint regions overlap, so their summed sample counts are not unique hand-area measurements. These measurements do not replace application rendering or results.

Controlled inputs use the real panel reset, retained TransformControls and trigger buttons. Each hand moves and curls independently while the other hand's consumed transforms stay fixed. Each run executes two complete sessions with meaningful movement/curl after restart. The presentation canvas covers the original exit button; the runner activates that original button with keyboard Enter using its existing `STOP|EXIT` path. End stops callbacks, clears layer registrations, disconnects presentation, and leaves retired joints unavailable. Cleanup restores panel inputs and closes owned browser resources.

## Execution evidence

The [execution record](webxr-hands-validation-2026-10-24.json) and [retained reports, logs and captures](validation/issue-59) distinguish this execution from historical #29/#30 bulk reports and earlier broad partial assessments. The previous 2,825 focused Chromium bulk assertions explicitly excluded official hand applications and are not represented as new hand-consumer evidence.

Both Chromium **156.0.8078.4** and Firefox **157.0** (build **20260924084938**, geckodriver **0.37.1**) pass **7,016 contract assertions each**, with no skips or runtime errors. Each browser also passes two complete Three.js hand sessions, five captured movement/curl states per session, all 25 consumed joints per hand, both eyes, fresh restart identities and cleanup. Consumed joint-matrix error is zero; the maximum sphere-instance matrix error is below **6.8e-10**. The smallest summed bright joint-region sample count per hand/eye is **302** in Chromium and **331** in Firefox. Panel buttons/poses are restored, presentation disconnects and callback/layer counts reach zero. The tested main/Firefox bundle SHA-256 is `157a88ba081c73255455a1c1945ceeb56c036198a78d3a608465d9e2c962fa79`.

The final record identifies tested source/bundle hashes, browser/tool versions, exact commands, assertion totals, upstream bytes, failures encountered during development, instrumentation, skips and cleanup. Build warnings describe the existing mesh/plane allocation import cycles and the analogous hand allocation cycle; the final build and both bundled browser startups are exercised. No generic full-suite rerun or independent AI re-review was added. Optional popup borrowing, another hand consumer and hardware checks were not performed. No post-merge verification is required.
