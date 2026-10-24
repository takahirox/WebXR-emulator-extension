# Virtual room plane detection

Issue [#51](https://github.com/takahirox/WebXR-emulator-extension/issues/51) replaces per-triangle planes with deterministic, useful planar regions and completes the XRPlane/XRPlaneSet bindings. Support remains limited to Quest MR and Android AR `immersive-ar`; Quest VR and inline reject required plane detection and omit optional requests. Mesh detection remains the existing triangle representation. Semantic labels are null; there is no physical camera, recognition, manual capture, or sensor feed.

## Representation and measurements

[plane-regions.ts](../src/polyfill/api/plane-regions.ts) groups edge-connected coplanar triangles within each sensed mesh, cancels internal edges, and partitions the remaining boundary into convex strips. Even/odd boundary crossings preserve holes. Disconnected and noncoplanar surfaces remain separate. Mesh-local boundary axes give deterministic partitions under rigid motion. Each plane has an orthonormal space with normal-aligned +Y, local polygon Y=0, and an origin centered on its polygon extents. This makes the pinned XRPlanes helper's centered `BoxGeometry(width, 0.01, depth)` fit rectangular regions without shifted coverage or duplicate triangle proxies. There is no universal merging across meshes, recognition of whole walls, or guarantee of minimal plane count. Topology changes can retire partition identities; stable source regions keep session-owned objects and spaces.

[Environment tests](../tests/environment.ts) independently supply known rectangle boundaries, apply world transforms, reconstruct polygon/space geometry, and reproduce the exact pinned proxy footprint. Rectangle, yaw-rotated, sloped and vertical fixtures have 12 m² polygon and proxy areas. Maximum boundary disagreement is **0.000000200 m**, below the required `1e-4 m`; local centering displacement is zero. Normal error is at most `1.11e-8`. Sloped orientation is null; horizontal and vertical classifications match their fixtures. Disconnected/opening fixtures have exact area and no proxy overlap. A connected 16-triangle ring becomes four rectangles covering exactly 32 m², leaving its 4 m² opening empty.

The actual `hall_empty.glb`, loaded with its original node transforms and only texture decoding omitted in Node, measures:

| Measurement | Result |
| --- | ---: |
| Source triangles / resulting planes | 100 / 85 |
| Horizontal / vertical / unclassified planes | 20 / 59 / 6 |
| Original triangle area | 675.821812 m² |
| Reconstructed polygon area | 675.821804 m² |
| Original area covered by polygons | 675.821775 m² |
| Exact pinned rectangular proxy area | 732.509847 m² |
| Original area covered by proxies | 675.821785 m² |
| Pairwise coplanar polygon / proxy overlap | 0.00001082 / 0.00000643 m² |
| Maximum local centering displacement | `4.45e-16 m` |

Coverage and overlap use independent convex clipping against the original world-space triangles, not just sums of output areas. The residual numerical errors are from Float32 world transforms. Rectangular proxies have **56.688 m² (8.39%) excess** outside the sensed surfaces, attributable to oblique triangular/trapezoidal boundaries; polygons preserve those boundaries and the Sample renders them directly. The strips do not overlap in their interiors; measured coplanar overlap is below `1e-3 m²`. This bounded approximation avoids tessellation-driven duplication while keeping useful floor and wall coverage. Exact nonrectangular visualization requires polygon rendering, as the Sample does; the pinned Three helper approximates every polygon by a box and only creates/removes meshes. Dynamic shape/pose changes are therefore tested in the API fixture, not asserted as a capability of that unchanged helper.

## Bindings and lifecycle

XRPlane and XRPlaneSet are nonconstructible. Plane metadata and set size are branded readonly prototype getters. Polygon arrays and their DOMPointReadOnly values are frozen; unchanged polygons and planeSpace retain identity. Sets provide insertion-order values, paired entries, exact `keys === values === Symbol.iterator` aliases, and callback `(value, value, set)` with the supplied receiver. Every operation checks its receiver, `has` requires a genuine XRPlane, and `forEach` checks callability even on empty sets. Genuine nonmembers return false. Forged prototypes and proxies fail; operations borrowed from independently injected realms work with genuine objects from either realm.

Frame membership is a snapshot, while tracked plane attributes can change. Shape/orientation changes advance lastChangedTime, and pose-only changes do not. Numerical shape comparison uses the last published polygon, so accumulated sub-tolerance changes eventually publish rather than disappearing frame by frame. Removal clears poses but retains readable metadata; reacquisition allocates fresh identities. A tracked plane can temporarily have unavailable pose information without losing membership. Valid active owning-frame pose queries return null for removed spaces. Foreign-session spaces and inactive frames reject InvalidStateError; invalid plane-frame getter receivers reject TypeError first. Shutdown clears tracking, callbacks and presentation resources.

The [pinned plane draft 394f13e](https://github.com/immersive-web/plane-detection/blob/394f13ee76d31f3885eb1237777cf2ecb1b87cbc/index.bs) conflicts internally: its attribute-change prose excludes pose-only changes, but its update algorithm assigns lastChangedTime unconditionally. This implementation explicitly follows the attribute-change interpretation, corroborated by the pinned WPT unchanged-frame assertion. It does not claim the conflicting algorithm was removed from the source.

`initiateRoomCapture()` validates the session brand and returns a Promise, including for binding failures. For a genuine session, ended state precedes completion/feature checks. The first enabled automatic capture resolves with undefined, repeated or ended calls reject InvalidStateError, and unenabled live sessions reject NotSupportedError. Borrowed cross-realm operations use the owning session's captured implementation. No capture UI is introduced.

Primary contracts also include [Device CRD, 9 June 2026](https://www.w3.org/TR/2026/CRD-webxr-20260609/), [Anchors d9c6266](https://github.com/immersive-web/anchors/blob/d9c6266d5e28caf98bff046dcbba31abd0b6d3f1/index.bs), and [WebIDL 622910c](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs).

## Reproduce

Install the locked dependencies and the current Playwright desktop Chromium. Use the official Firefox/geckodriver setup in [Firefox reproduction](firefox-runtime.md#reproduce), then run:

```sh
npm ci
npm run build:firefox
npm run test:environment
npx tsx tests/reference-space-browser.ts chromium planes
npx tsx tests/reference-space-browser.ts chromium plane-applications
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
npx tsx tests/reference-space-browser.ts firefox planes
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
npx tsx tests/reference-space-browser.ts firefox plane-applications
npm run test:browser
npm run test:pose-view:chromium
WEBXR_FIREFOX_EXECUTABLE="$PWD/test-results/browser-tools/Firefox.app/Contents/MacOS/firefox" \
WEBXR_GECKODRIVER="$PWD/test-results/browser-tools/geckodriver" \
npm run test:pose-view:firefox
```

The focused selections extend the existing Chromium/Firefox driver and pinned upstream server. They load the actual extension in fresh profiles and configure devices through the genuine DevTools panel. JSON measurements and PNG captures go to `test-results/`. The versioned [execution record](webxr-planes-validation-2026-10-24.json) identifies exact tested hashes, commands, versions, source/dependency provenance, captures, resolved failures and unperformed checks. The generated Firefox package remains untracked; the tracked polyfill bundle is rebuilt.

## Pinned applications and observation

Both applications are served byte-for-byte from their pinned repository revisions by the existing local upstream server:

- [Samples fb41c34 plane detection](https://github.com/immersive-web/webxr-samples/blob/fb41c3416496974672e2c766a41c6febcba2d07e/proposals/plane-detection.html) requests anchors and plane-detection and imports **Three.js 0.127.0** from its unchanged unpkg URL. Its existing overlay checkbox is disabled. The grid image retains its original pinned ARCore URL.
- [Three.js r186 at 9b4a2ac](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/examples/webxr_ar_plane_detection.html) requests plane-detection and uses the build modules and XRPlanes helper from that same revision. These are separate from the extension's installed **Three.js 0.186.1** dependency.

The eight combinations use Chromium 156.0.8078.4 and Firefox 157.0 (build 20260924084938; geckodriver 0.37.1), Quest MR stereo and Android mono. Each verifies all 85 application meshes against returned geometry/poses, identifiable rendered application pixels, measured viewer movement with stable room coordinates, session end, fresh tracking on restart, and final cleanup. The Sample's real select handler creates its cylinder/anchor at the reticle's plane point. The observer accounts for the Sample's explicit 1 mm reticle offset on each axis and compares the anchor in world coordinates against an independent ray intersection with the original room. Maximum measured placement disagreement is `2.24e-7 m`.

[Test observation](../tests/plane-applications.ts) retains original API arguments, results and exceptions, and uses Three.js's existing observe events and natural rendering callbacks. It reads scene geometry, presentation canvases, session counters and retained spaces. Chromium briefly pauses the panel bootstrap to attach the same scene observer before resuming. Viewer/phone movement uses genuine panel TransformControls; Quest selection clicks the real panel button, and Android selection right-clicks the rendered phone display. These are synthetic desktop controls. The shared observer resets viewport counters on each viewer-pose query; the Sample makes a later query, so its retained counters are zero. Its stereo/mono evidence uses the actual public eye list and positive captured per-eye presentation regions, without substituting viewport values. No returned application geometry, application logic, GL implementation, animation clock or sensor output is replaced. The API-only fixture separately and temporarily moves/scales/removes the room and makes one native pose provider unavailable, restoring them in cleanup.

Application screenshots, raw application textures, before/moved coordinates, placement measurements and restart captures are versioned under [validation/issue-51](validation/issue-51). The execution record includes source bytes/hashes served by the local server and browser cache rereads of immutable external dependencies. The Sample dependency hash is distinct from the extension and the pinned r186 modules.

## WPT adaptations and resolved failures

The six [pinned plane tests at e185958](https://github.com/web-platform-tests/wpt/tree/e1859580b5fcf74940a18d2f783296b4961035e3/webxr/plane-detection) are retained unchanged under [tests/vendor/wpt/plane-detection](../tests/vendor/wpt/plane-detection), with URL/hash entries in the existing vendor manifest. [planes.ts](../tests/planes.ts) executes adapted assertions through genuine extension sessions:

| Pinned test | Executed adaptation |
| --- | --- |
| detectedPlanes plumbing | Multiple actual hall planes, horizontal/vertical classification, frozen polygons; labels are null rather than fake sensor labels |
| inactive frame | Retained actual RAF frame getter rejects InvalidStateError |
| identity | The same tracked room planes remain identical across frames |
| lastChangedTime no change | Unchanged and rigidly moved geometry retain timestamps; actual shape scaling advances them |
| incomplete update | Removed room yields empty collections; reacquisition yields fresh planes; a retained native provider can separately become unavailable |
| initiateRoomCapture | Automatic completion once, repeat/end/unenabled failures and Promise binding checks |

This is an assertion adaptation, not execution of WPT's native fake-device harness or an official WPT pass. Native `setWorld`, semantic labels, manual capture and `simulateIncompletePlaneDetectionData` have no emulator equivalents. In particular, WPT's third timestamp step resubmits the same fake world as a native update; this fixture changes the actual room shape so that an attribute change, rather than mere input resubmission, is tested. The original files remain available for comparison. Additional WebIDL and lifecycle cases cover the Issue's binding requirements.

The broader Chromium runner initially exposed a stale bounded-floor assertion: **original assumption**, a request pending at shutdown still allocates; **correction**, pending requests reject InvalidStateError while a separately initiated supported request after shutdown can allocate. This is already established by [Issue #41's documented reconciliation](webxr-reference-space.md#retained-requirement-correction), grounded in the pinned Device shutdown algorithm. The bounded-floor fixture now matches that existing contract; no runtime behavior was changed to satisfy it. Other resolved fixture failures involved constructing cross-realm layers/GL contexts in the wrong realm, comparing Firefox-injected Promises with the page's constructor rather than testing Promise behavior, choosing a co-located mesh with a different orientation, installing Chromium's panel observer too late, and failing to reset viewer/phone controls between scenarios. A cumulative small-shape-change regression also failed before its fix: comparison now retains the last published signature instead of discarding accumulated changes each frame. A final cleanup assertion was corrected to inspect disposed presentation resources and the emptied layer registry, rather than requiring the retained layer wrapper itself to become null. The Chromium driver now awaits panel model readiness before dispatching configuration changes. These failures are not counted as compatibility passes.

There are no required post-merge checks. Physical sensors/headsets, other browser versions, universal coplanar merging and dynamic geometry updates by the unchanged pinned XRPlanes consumer were not tested or claimed. Existing mesh binding and deferred-module limitations in the [inventory](webxr-conformance.md) remain.
