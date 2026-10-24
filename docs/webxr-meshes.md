# Mesh publication and rendered consumption

Issue [#55](https://github.com/takahirox/WebXR-emulator-extension/issues/55) corrects mesh bindings, publication and tracking lifetime. `mesh-detection` remains available for Quest MR and Android AR `immersive-ar`. Required requests reject with `NotSupportedError` and optional requests omit the feature for Quest VR and inline. Inline exclusion follows the module; AR-only availability is emulator policy. Active frames without the feature expose an empty collection.

The normative baselines are [Mesh Detection 5397685](https://github.com/immersive-web/real-world-meshing/blob/539768590eb39cdff665d8e7a63f37b85eb6440b/index.bs), [Device CRD 2026-06-09](https://www.w3.org/TR/2026/CRD-webxr-20260609/) and [WebIDL 622910c](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs). No baseline or acceptance requirement was relaxed.

## Publication and bindings

Original implementation assumption: comparing each shape with the preceding frame was sufficient, even while republishing vertices every frame. Correction: geometry and its notification must agree, including cumulative changes. The pinned [Sample's `processMeshes`](https://github.com/immersive-web/webxr-samples/blob/fb41c3416496974672e2c766a41c6febcba2d07e/proposals/mesh-detection.html) only rebuilds retained geometry when `lastChangedTime` advances. Per-frame comparisons discarded small accumulated deformation and could leave that consumer stale.

Mesh shapes now compare against their last published Float32 vertices with an absolute **1e-5 m (10 micrometre)** coordinate tolerance. Values within that tolerance remain unpublished; cumulative deformation eventually exceeds the retained baseline, publishing the shape and frame timestamp together. The current partition always exports one triangle with indices `[0, 1, 2]`. Source connectivity changes update that partition's local geometry or remove/add partitions. A congruent triangle under a different rigid pose is still the same shape. Translation, rotation and viewer motion do not advance timestamps. Meshes have no orientation attribute, so crossing a horizontal/vertical classification does not constitute a mesh attribute change.

The mesh draft's attribute-change prose explicitly excludes pose-only timestamp changes, while its update algorithm assigns timestamps unconditionally. This implementation follows the attribute-change interpretation already documented for planes. The pinned WPT plane timestamp assertion corroborates that **plane** interpretation; it is not a mesh behavioral test. The new mesh checks are emulator contract tests, not official mesh WPT passes.

`XRMesh` and `XRMeshSet` public constructors throw `TypeError`. Readonly mesh attributes are branded, enumerable, configurable prototype getters. `meshSpace` retains SameObject identity. Vertices and indices have no SameObject annotation: each read returns a writable copy of the last published arrays. Writes and buffer transfer cannot alter change comparisons, another session or shared room sensing. Tracking records stay in a module-private WeakMap; the shared cross-injection allocation registry exposes frozen readers and frozen records, without registry writers. Collection records expose only readonly operations over a private membership snapshot. Its iterators use the Set iterator prototype.

Readonly setlike bindings preserve insertion order, paired entries, `keys === values === Symbol.iterator`, callback arguments/thisArg, exception propagation and callback validation even when empty. `has()` converts its argument to genuine XRMesh; invalid values throw and genuine nonmembers return false. No mutators are exposed. Borrowed getters and methods accept genuine separately injected same-origin objects; proxies and prototype forgeries fail. `detectedMeshes` checks the frame brand before active state. Inactive genuine frames throw `InvalidStateError`.

Spaces belong to their session. Membership is copied per frame, while tracked objects retain identity until removal. A tracked mesh can have an unavailable pose. Removed spaces return null in valid owning-frame pose queries; foreign-session pose queries reject even when tracking is unavailable. Reacquisition and restart create fresh mesh identities. Shutdown retires tracking, callbacks, layers and presentation resources; retained metadata remains readable.

## Geometry and partition limits

[Independent fixture measurements](../tests/environment.ts) reconstruct indexed and nonindexed rectangles, sloped/transformed rectangles and degenerate input directly from source buffers and published vertices/indices plus meshSpace. They validate finite metre coordinates, indices, normal-aligned +Y and world agreement within `1e-4 m`. Degenerate triangles are omitted. Expected points and normals do not come from `roomSurfaces`.

The packaged `hall_empty.glb` contains **100 sensed triangles**, excluding the decorative sky. Independent source area is **675.8218116500444 m²**, published area **675.8218040290562 m²**, coverage ratio **0.9999999887233764**. Maximum vertex disagreement is **4.368218393774939e-7 m** and maximum normal-vector error **2.5840784579215407e-8**. Triangle partitions preserve the source coverage without filling openings or aggregating walls. Centroids and normals describe each triangle, not a universally reconstructed physical surface. Semantic labels remain null. Existing plane coverage, mesh hit intersections and CPU-depth calibration assertions also pass in `test:environment`.

## Reproduction

Install the lockfile dependencies and Playwright desktop Chromium, then run the focused selections sequentially because actual desktop focus is used:

```sh
npm ci
npx playwright install chromium
npm run build:firefox
npm run test:environment
npm run test:meshes:chromium
npm run test:mesh-applications:chromium
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
  npm run test:meshes:firefox
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
  npm run test:mesh-applications:firefox
```

Firefox tooling is the official macOS Firefox **157.0**, build **20260924084938**, and geckodriver **0.37.1** (macOS aarch64), installed under the ignored `test-results/browser-tools/`. Downloads: [Firefox release image](https://archive.mozilla.org/pub/firefox/releases/157.0/mac/en-US/Firefox%20157.0.dmg) and [geckodriver archive](https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-macos-aarch64.tar.gz). The run used Playwright desktop Chromium **156.0.8078.4**, Node **24.12.0**, Playwright **1.64.0**, TypeScript **5.9.3**, gl-matrix **3.4.4**, and extension Three.js **0.186.1**. `WEBXR_CHROMIUM_EXECUTABLE` optionally selects another desktop executable; the evidence identifies the actual tested executable hash.

The driver selections are `meshes` and `mesh-applications` in [reference-space-browser.ts](../tests/reference-space-browser.ts). The former covers five mode/profile scenarios, separately injected realms, forged/proxied receivers, negotiation, mutable exports, timestamps, unavailable poses, membership snapshots, foreign ownership, removal, reacquisition and shutdown. It controls actual room transforms and one native provider temporarily, restoring them in cleanup.

The application selection serves the **unchanged** [Mesh Detection Sample at fb41c34](https://github.com/immersive-web/webxr-samples/blob/fb41c3416496974672e2c766a41c6febcba2d07e/proposals/mesh-detection.html) and its original dependency requests, including **Three.js 0.152.2** from jsDelivr. That is separate from the extension's Three.js dependency. Only the Sample's existing optional DOM overlay checkbox is disabled. This earns WebXR Samples evidence, not an additional official Three.js application count.

[Observation](../tests/mesh-applications.ts) preserves original request/frame/pose calls, return values and exceptions. Three.js's existing scene-observation hook exposes natural application renders. The observer compares all original solid mesh geometry and transforms against returned meshes and independently read room buffers, and observes geometry identity and original disposal events. Viewer/phone movement uses genuine panel TransformControls. Controlled virtual-backend updates translate/rotate the room, scale it by 10%, remove its room pointer and restore it. These are disclosed synthetic backend controls; application geometry, requests and logic are unchanged.

Full browser captures and raw presentation textures show Quest's two eyes and Android's mono view before/moved, pose-only, shape, removed, reacquired and restarted states. Exact green/blue/yellow/cyan/magenta Sample material pixels identify triangle interiors independently of its red sphere reticle and neutral controllers. Pixel counts are positive in each eye, disappear on removal, and return after reacquisition/restart. Shape publication rebuilds and disposes all 100 consumer geometries; captured texture hashes change after deformation. Pose-only updates preserve timestamps and geometry identities while independently matching moved room coordinates.

## Execution record and limits

The [execution record](webxr-meshes-validation-2026-10-24.json) preserves exact commands, source/bundle/browser/tool/application/dependency hashes, measured geometry, pixel counts, captures, cleanup, failures and skips. Historical Issue #19 callback counts and unpinned hosted-sample results remain historical; they do not establish this task's rendered updates. Final evidence covers both AR profiles on Chromium and Firefox, four unchanged pinned Sample combinations, plus 18 environment tests and the Firefox build/typecheck.

Resolved fixture failures are recorded separately: the initial cumulative-change test scaled only an axis that did not deform the selected hall face; the replacement uniformly scales by a measured 2 micrometres per coordinate per step. The initial scene observer looked for the plane Sample's ring; the mesh Sample uses a sphere, so its scene selector was corrected. These are harness corrections, not changes to Sample logic or acceptance. A binding implementation check also replaced Array iterators with the pinned WebIDL Set iterator prototype before final runs.

No generic suite rerun, independent AI re-review, physical headset/sensor test, extra mesh consumer or full WPT suite was performed or claimed. Other incomplete and deferred modules remain within the fixed project goal. There are no required post-merge checks.


## PR review allocation correction

Review of PR #56 found that the exposed allocation superclasses could register caller-supplied mesh readers and collections through `Reflect.construct(Object.getPrototypeOf(XRMesh), ..., XRMesh)` and its set equivalent. Freezing reader records did not protect this registration path.

Public mesh interfaces now have no allocation superclass and always throw. Private functions in the shared mesh tracker allocate backend-owned geometry, spaces and membership snapshots without invoking public constructors or their mutable superclass chains. Tracker construction checks the session allocation brand; its membership, owner and retained geometry stay in private WeakMaps. Each injection retains its own interface objects and prototypes, and borrowed getters/methods continue accepting genuine objects from another injection. The unchanged room extraction helpers moved to `room-surfaces.ts` to avoid eager mesh-interface initialization through a module cycle.

The [revision execution record](validation/issue-55/mesh-allocation-fix.json) records the commands above, exact browser/tool/dependency/source/bundle versions and hashes, assertion counts, resolved development failures and limits. `npm run build:firefox`, all **18 environment tests**, and the five mesh contract scenarios on each browser passed with **15,918 assertions per browser**. The added assertions cover reflective allocation with interface/subclass targets and forged authorization arguments, rejection before caller callbacks, and distinct interface objects in each injected realm. The environment regression also replaces public constructor superclass chains and verifies that internal allocation never invokes them. Existing plane geometry, mesh intersections and CPU-depth assertions pass. Rollup reports a deferred geometry/brand allocation dependency cycle; actual extension initialization passed on both browsers.

This revision reran the focused mesh contracts, without repeating the application selections or claiming new rendered Sample evidence. The earlier application captures and measurements remain separate. No human confirmation was substituted, and no push or merge was performed.
