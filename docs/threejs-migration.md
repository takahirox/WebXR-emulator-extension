# Three.js r186 migration

Issue [#7](https://github.com/takahirox/WebXR-emulator-extension/issues/7) upgrades both renderer realms to **Three.js 0.186.1 (r186)**. On 2026-10-15, `npm view three dist-tags --json` reported only `latest: 0.186.1`, matching the [official npm metadata](https://registry.npmjs.org/three/latest) and [official r186 release](https://github.com/mrdoob/three.js/releases/tag/r186). This is a stable release, pinned exactly in `package.json` and `package-lock.json`. `@types/three` 0.186.0 supplies declarations for the same revision; Three.js itself no longer ships TypeScript declarations.

## Runtime and build changes

The panel imports core, GLTFLoader, OBJLoader, OrbitControls, and TransformControls from npm. Rollup resolves browser modules and deduplicates `three` so each bundle contains matching core/addons. All five legacy files under `src/app/three/` were removed; that directory contained no other assets. HTML now loads only the local panel bundle. There is no `window.THREE` application global, CDN, runtime JavaScript download, or eval. The npm license is copied to `licenses/three.txt` and included in the Firefox package.

The panel and AR renderer require WebGL2, as required by current Three.js. AR reports an explicit error if WebGL2 is unavailable; the panel uses Three.js's renderer initialization error. The inspected XR application can still use a WebGL1 canvas: it is uploaded as an AR screen texture. Node.js 22+ remains the build requirement. Reproduce dependencies with `npm ci`, then build before loading the unpacked extension.

Modern TransformControls is a controller, separate from its scene helper. Both realms add `getHelper()` to the scene and toggle that helper's visibility. Replacing panel devices detaches/disposes controls and removes their helpers/listeners. The controller hierarchy is cloned once with independent materials, without recursively cloning descendants twice. Quick pointer-based gizmo drags are excluded from the compatibility mouse-click mode switch. OrbitControls retains ground-plane panning. MyControls declares its modern EventDispatcher event map. Geometry constructors use BoxGeometry, PlaneGeometry, and SphereGeometry. Tablet raycasts explicitly avoid recursing into an already-listed screen; room/model raycasts still recurse into loaded hierarchies.

The AR screen keeps a stable application-texture uniform, including before shader compilation and across session restarts. It uses current `map_pars_fragment`/`map_fragment` chunks and `vMapUv`. The room render target stores linear light; the application CanvasTexture is tagged sRGB, decoded by WebGL2 on sampling, and mixed with the room using straight alpha in linear light. The material's output chunk encodes to sRGB once. CanvasTexture's vertical flip preserves the application's orientation. Replaced canvas textures are disposed, and session exit restores the transparent dummy texture. The removed `mapTexelToLinear` function is no longer referenced.

Current color management is retained. Directional light intensities are multiplied by pi to compensate for the removal of legacy lighting. Shading and material colors can still differ from r111 because of physically correct lighting and sRGB output. The packaged hall, headset, and controller assets are unchanged. Embedded GLB images now use the modern image-bitmap loader: pages restricting image/network CSP must allow local blob images and connections (`img-src 'self' blob: data:` and `connect-src 'self' blob:` in the regression fixture). Script CSP remains `script-src 'self'`, with no inline/eval permission.

Manifest-declared synchronous MAIN-world injection, the isolated privileged bridge, the stateless service-worker router, and Firefox's separate MV3 event-page manifest retain their existing contracts. Only renderer consumers and the build's local module resolution/notice packaging change. See the [official migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) for upstream API changes.

## Reproduction and validation

Executed on macOS arm64 with Node.js **24.12.0**, npm **11.6.2**, and current Playwright desktop **Chrome for Testing 156.0.8078.4** (Chromium build 1248). This is Playwright's desktop Chromium distribution, not a claim of stable-channel Chrome testing. The browser was installed with `npx playwright install chromium`; the test used a fresh temporary profile, software WebGL, and no physical XR hardware.

```sh
npm ci
npm run typecheck
npm run build
npm run build:firefox
npx playwright install chromium
npm run test:browser
npm audit --json
npm ls three
```

- `npm ci`: passed, reproduced the lockfile (61 packages installed, zero vulnerabilities).
- `npm run typecheck`: passed, including source, declarations, tooling, and tests.
- `npm run build`: passed; generated panel and polyfill bundles contain r186. The existing upstream XRSession/XRFrame circular dependency warning remains.
- `npm run build:firefox`: passed; includes local bundles, assets, and the Three.js license. Firefox runtime/DevTools testing is optional and was not performed for this migration.
- `npm run test:browser`: passed. The real DevTools panel loads the headset OBJ and controller GLB, restores device/stereo settings after reload, bridges poses/reset, and drags the real headset/controller transform handles using pointer input. It checks that a quick drag does not enable another model's control and that OrbitControls rotates the camera. All six VR select/squeeze event types occur, and panel exit ends the session.
- The same browser run checks worker shutdown/recovery in both directions, synchronous first-script WebXR under restrictive script CSP, MAIN-world API isolation, same/cross-origin frames, frame removal, tab isolation, malformed pose rejection, and restored startup after reload.
- AR loads `hall_empty.glb`, renders the textured room/tablet/gizmos, reports two persistent and two transient intersections, handles touch/select press/release and camera movement, cancels hit sources, and exits/restarts AR. Uncaught page/frame errors, panel runtime/WebGL errors, and page console errors are absent.
- AR pixel assertions check two asymmetric opaque patches (top `[64,128,191]`, bottom `[191,64,32]`), a transparent patch preserving room `[221,214,208]`, and half-alpha blue blended with room `[141,128,120]` to `[108,141,169]`, with a tolerance of four levels per channel. Both pixel reads report WebGL `NO_ERROR`. These checks detect incorrect canvas attachment, shader compilation, orientation, sRGB conversion, and alpha compositing.
- `npm audit --json`: zero vulnerabilities across production and development dependencies. The retained legacy Three.js advisory is no longer reported; there are no remaining unrelated advisories in this audit. `npm ls three` reports only `three@0.186.1`.

The browser harness uses Three.js's observation hook in test targets to capture the actual scene/camera. The panel bundle is paused through CDP before execution to install the hook in its extension iframe; no production test global or duplicate Three.js import is needed. Gizmo coordinates use current helper sizing, active pointer capture, and iframe bounds. The fixture draws color patches at the emulator-selected framebuffer resolution, and permits local blob image fetches used by the updated loader. Earlier development failures in these harness assumptions were corrected before the passing run.

Browser-rendered screenshots were inspected for loaded geometry, transformed models, visible gizmos, textured room surfaces, and upright/composited tablet output. Saved evidence: [panel](validation/issue-7/panel.png), [AR room](validation/issue-7/ar.png), [AR texture patches](validation/issue-7/ar-texture.png). Rerunning the test writes fresh copies to ignored `test-results/`. The panel test moves its camera farther out and reduces helper size to keep both drag targets visible in a narrow docked DevTools panel.

External WebXR samples, Firefox runtime, physical hardware, and before/after screenshot matching were not tested. Full WebXR specification conformance and WebGL1-only machines are outside this validation. No post-merge verification is required. This checkpoint does not push, open a PR, comment, or merge; downstream PR authoring should target `dev` and use the repository template with these results and limitations.
