# Rigid transforms (Issue #47)

`XRRigidTransform` converts both `DOMPointInit` arguments before validating
position or quaternion values. Dictionary members are read and converted once in
`w,x,y,z` order, including inherited members. Null/undefined dictionaries use
defaults; explicit null components become zero. Numeric strings use `ToNumber`;
primitive dictionaries, Symbol/BigInt components and nonfinite converted values
reject with `TypeError`. Getter/coercion exceptions propagate unchanged.
Zero, underflowed-zero and overflowing quaternion squared lengths reject with
`InvalidStateError`; other quaternions normalize before use.

The four attributes are enumerable/configurable prototype getters without
setters. Shared identity records reject prototype forgeries and proxies while
accepting genuine separately injected same-origin iframe/popup transforms.
Position, orientation and inverse retain SameObject identities, with reciprocal
inverse identity. Borrowed getters allocate lazy inverse/matrix values in the
transform's realm. Ordinary strict assignments throw and sloppy assignments
leave the attributes unchanged; configurable attributes can still be shadowed
through explicit property definition as WebIDL permits.

Internal geometric matrices are independent of exported arrays. An attached
array is reused, and its elements remain mutable. Transferring its buffer makes
the next read allocate an equivalent 16-element array in the owning realm.
Element writes and detachment do not change points, inverse calculations or
reference offsets. Transform consumers (rays, anchors, hit results, layers,
input snapshots and bulk poses) use the same internal geometry. Retained
transforms and inverse pairs remain readable after frame/session completion.
This is ordinary application behavior, not native opaque-resource enforcement
or protection against deliberate interference with page-realm internals.

`getOffsetReferenceSpace` checks receiver and transform identity without reading
argument properties. Its allocation closure preserves the base space's realm,
session and bounded subclass when a foreign operation or transform is used.
Nested offsets compose rotation then translation; bounds are transformed once
by the inverse cumulative offset. Existing request/shutdown behavior and the
viewer-only inline policy are preserved. Immersive fixtures explicitly request
`local-floor` and `bounded-floor`; standalone transforms need no descriptor.

## Pinned references and reconciliation

- [Device CRD, 9 June 2026, §§6.2, 6.3 and 8](https://www.w3.org/TR/2026/CRD-webxr-20260609/)
  defines transform values, realm allocation, inverse identity, matrix regeneration
  and effective reference origins.
- [WebIDL 622910c](https://github.com/whatwg/webidl/blob/622910c67c724e362f71e8255a0380bade261acb/index.bs)
  supplies dictionary conversion (`#js-to-dictionary`), unrestricted doubles
  (`#js-to-unrestricted-double`), interface receiver/argument checks and readonly
  prototype descriptors. `document.all` remains an Object despite its legacy
  `typeof` and loose-null behavior.
- [Chromium rigid transform at f842f52](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/third_party/blink/renderer/modules/xr/xr_rigid_transform.cc)
  keeps `matrix_` separate from `matrix_array_`, regenerates detached arrays,
  and rejects zero/overflowing squared quaternion lengths. Its
  [reference-space implementation](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/third_party/blink/renderer/modules/xr/xr_reference_space.cc)
  uses `TransformMatrix()` for offset multiplication. This corroborates the
  separation demonstrated by the emulator fixture; no native-browser runtime
  result or native resource protection is inferred.
- The [Three.js r186 teleport example](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/examples/webxr_vr_teleport.html#L106)
  constructs a transform from the negated intersection and a Quaternion, calls
  `getOffsetReferenceSpace`, and installs that space on the renderer. This was
  inspected as consumer evidence; optional execution was not performed.

No Issue #47 acceptance correction was needed. Matrix is intentionally not
SameObject across detachment, and readonly does not imply frozen elements.
The remaining pose/view/IDL defects and every deferred module in the fixed
compatibility goal remain unfinished; this change completes only the transform
prerequisite and affected reference-offset integration.

## Reproduce

```sh
npm ci
npm run build:firefox
npm run test:wpt
npm run test:transform:chromium
npm run test:reference-space:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver \
npm run test:transform:firefox
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver \
npm run test:reference-space:firefox
git diff --check
```

Chromium uses the installed locked Playwright desktop browser, optionally
selected with `WEBXR_CHROMIUM_EXECUTABLE`. Official Firefox 157.0/build
20260924084938 and geckodriver 0.37.1 setup is in
[Firefox reproduction](firefox-runtime.md#reproduce). The runner uses fresh owned
profiles, real packaged extension injection, actual DevTools configuration and
activation clicks. No native fake XR device is substituted.

[The focused page fixture](../tests/rigid-transform.ts) executes the same cases
through both existing browser drivers on Quest VR, Quest MR, Android AR and
inline on both device profiles. A triangle at z = -2 m is red in the left eye,
green in the right eye and yellow in mono. A 0.6 m origin offset moves its pixel
centroid right in every view. Pose/matrix/bounds assertions use absolute error
less than 0.0001; color channels allow differences below 3/255; triangle coverage
exceeds 100 pixels and centroid displacement exceeds 5% of viewport width.
Immersive source counts must also match the real presentation canvas exactly.
The fixture reads `_session`, `callbacks.size` and the actual layer
`_presentationCanvas` only for ownership, teardown and presentation observation;
it replaces no GL methods, adapters or timers. Foreign documents close before
rendering; retained foreign constructors/operations/transforms are still used.

Raw results and before/after presentation PNGs are written to
`test-results/rigid-transform-{chromium,firefox}*`. The separate existing
reference-space commands retain the full request/shutdown acceptance, including
pending requests, delayed adapters, ownership and bounded-space behavior.

Four unmodified transform assertion HTML files from WPT
`e1859580b5fcf74940a18d2f783296b4961035e3` are retained in
[tests/vendor/wpt](../tests/vendor/wpt/manifest.json), with hashes, source URLs
and upstream license. `test:wpt` verifies these hashes, replaces the report UI
with a result collector and substitutes the native-device utility with a real
emulator inline session/base-layer adapter. Assertion bodies remain upstream
bytes. The existing navigator SameObject file is still included. This is a
five-file adapted selection, not full/unmodified WPT. No discrepancy was found
in these assertion bodies.

The [execution record](webxr-rigid-transform-validation-2026-10-24.json) records
versions, exact source/bundle hashes, outcomes, initial failures, skips and
unperformed checks. [Retained captures](validation/issue-47/) show actual
presentation output before/after navigation. No generic application-suite rerun,
optional teleport runtime, physical-device check or independent AI re-review was
performed. Required post-merge verification: none.

## Recorded outcome

The final build and whitespace check passed. Chromium 156.0.8078.4 and official
Firefox 157.0 each passed all five transform scenarios (**3,015 assertions per
browser**) and all five unchanged reference-space/shutdown scenarios (**1,160
assertions per browser**), with no application errors or skips and successful
owned-resource cleanup. The five adapted WPT files passed on Chromium. Both
packaged bundles have SHA-256
`4f5bdd4e74f0653b3fb112ffb7cd9eea462657f4f1bf79fd069be41180bfdd06`.
The execution record retains the initial typecheck/build helper failures and
Firefox timeout, their corrections, and one comment-only source hash variation;
no acceptance requirement was relaxed.
