# WebXR emulator extension

WebXR emulator extension is a browser extension which helps your WebXR content creation. It enables you to responsively run [WebXR](https://www.w3.org/TR/webxr/) applications on your **desktop** browser without the need of any XR devices. 

[Blog post](https://blog.mozvr.com/webxr-emulator-extension/) / [YouTube](https://www.youtube.com/watch?v=Twnzp-LEMkU) / [Slides (in Japanese)](https://docs.google.com/presentation/d/1J-QDpm27eGzHi0vsPEqZSd5aun-GSWUm-FQC19qjSRA/edit#slide=id.g4775d037d5_0_0)

![Screenshot](./screenshots/screenshot.gif)

## Features

- Maintained TypeScript WebXR emulation with [versioned API inventory and conformance tests](docs/webxr-conformance.md)
- Two development profiles: Meta Quest 3 and Generic Android Phone (ARCore)
- Both VR and AR support
- Graphical device emulator control with [Three.js](https://threejs.org/)
- Cross browsers support with [WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
<!-- - [Virtual controller (WIP)](./screenshots/virtual-controller.gif) -->

## Status

- Standards work targets the [9 June 2026 WebXR Device API draft](https://www.w3.org/TR/2026/CRD-webxr-20260609/) and pinned module drafts. See the [capability matrix, test evidence and remaining scope](docs/webxr-conformance.md); full standards conformance is not claimed.
- Quest VR/MR and Android AR simulate a virtual environment. No camera, physical tracking, or environmental sensor access is provided.
- The panel controls controller trigger/squeeze and pose; requesting hand tracking produces reproducible joint skeletons controlled by those same inputs.

## Browsers

The development build uses Manifest V3 on current desktop Chrome/Chromium (minimum Chrome 111 for manifest-declared MAIN-world scripts). Firefox 128 or newer uses a separate MV3 package with an event page; see the installation instructions below and [compatibility/validation notes](docs/manifest-v3.md). Other Chromium browsers are not individually verified. Mobile browsers are outside the supported desktop emulation scope.

## How to use

1. Go to the addon stores to install ([Firefox](https://addons.mozilla.org/firefox/addon/webxr-api-emulator), [Chrome](https://chrome.google.com/webstore/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje))

2. Go to WebXR application page (for example [WebXR examples](#WebXR-examples)). You will notice that the application detects that you have a XR device (emulated) and it will let you enter the immersive (VR、AR) mode.

3. Open "WebXR" tab in the browser developer tool ([Firefox](https://developer.mozilla.org/en-US/docs/Tools), [Chrome](https://developers.google.com/web/tools/chrome-devtools/)) to controll the emulated devices. You can move the headset and controllers, and trigger the controller buttons. You will see their transforms reflected in the WebXR application.

![WebXR tab](./screenshots/tab.png)

## How to control the emulated devices

By clicking a device in the devtool panel, you can select gizmo mode of the device. By dragging a gizmo, you can rotate or translate the device.

## Configuration

You can configure some settings from the top in the WebXR tab.

### Device

The device picker exposes exactly two profiles. **Meta Quest 3** is the default.

| Device | Emulated behavior |
| ---- | ---- |
| Meta Quest 3 | 6DoF headset and two tracked 6DoF controllers with select/squeeze; VR or MR in one profile |
| Generic Android Phone (ARCore) | 6DoF handheld AR camera, virtual phone screen, transient touch input, and virtual-room hit tests |

These profiles represent development targets, not physical-device fidelity or a claim of complete Quest 3/ARCore API support. Quest sessions can request simulated hand tracking. AR/MR sessions can request hit tests, session anchors, CPU depth and virtual lighting; immersive sessions can use WebGL2 projection and quad layers. Feature availability and unsupported combinations are listed in the [versioned inventory](docs/webxr-conformance.md).

### Quest mode

Select **VR** (`immersive-vr`) or **MR (immersive AR)** (`immersive-ar`) in the separate **Quest mode** control, then start that session in the application. Only the selected immersive mode is available to the page. Both modes retain tracked controllers and headset pose controls. MR composites the application over the packaged virtual room with headset views; it does not provide a real camera passthrough feed. Use transparent application pixels to see the room.

Changing the profile or Quest mode ends the current immersive session. Start a new session in the application afterward. The profile, Quest mode, and stereo preference persist across panel/page reloads. Switching to the phone preserves the Quest mode preference for the next switch back. Removed headset profiles (including None) fall back to Quest VR; the old Samsung AR selection migrates to the generic phone. Inline sessions remain available in either profile.

### Stereo Effect

Stereo effect enables two side-by-side headset views in both Quest VR and MR. Disabling it draws one full-width view while retaining the two-eye session structure. The phone uses one monoscopic `none` view regardless of this preference.

## AR mode

WebXR emulator extension also supports AR. You can test WebXR AR application on an emulated device in a virtual room, on your desktop browser.

![Screenshot AR](./screenshots/screenshot_ar.gif)

### How to use

1. [Download and manually install the newest extension from dev branch](#how-to-install-the-newest-version)

2. Select "Generic Android Phone (ARCore)" from the device list on the top of WebXR devtool panel

3. Go to WebXR application page, for example [Three.js WebXR AR examples](https://threejs.org/examples/?q=webxr#webxr_ar_paint)

4. You will notice that the application detects that you have a XR device (emulated) and it will let you enter the immersive (AR) mode

5. AR application starts on the emulated device in a virtual room

### How to control

You can control the observer camera (view) and virtual phone in the application window. The WebXR viewer pose follows the phone, while the observer camera lets you inspect it from outside.

| user action | camera/phone control |
|----|----|
| Left mouse button drag | Camera rotation |
| Right mouse button drag | Camera pan |
| Middle mouse button drag or wheel | Move camera forward/backward |
| Mouse click on the phone | Change the phone gizmo mode |
| Gizmo on the phone | Phone rotation/translation |
| Right mouse button click on the phone screen | touch input |

### How to control in the devtool panel

You can still control the camera and phone in the devtool panel similar to VR.

| Devtool panel | AR virtual room |
|----|----|
| Observer camera | View |
| Touch pointer (virtual) | Finger (not a physical controller) |
| Phone | Phone |

## For development

For contributions and AI-assisted work, follow the [development flow](docs/development-flow.md) and [review and merge guidelines](docs/review-guidelines.md). The default integration branch is `dev`; newly authored collaboration content uses [English](docs/development-flow.md#collaboration-language).

Use the [Issue template](.github/ISSUE_TEMPLATE/issue.md) and [PR template](.github/pull_request_template.md). AI contributors should start with [AGENTS.md](AGENTS.md).

### How to install the newest version

Download this repository and run the build below. In Chrome/Chromium, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository root containing `manifest.json`. Reload any existing WebXR pages, then open DevTools → **WebXR**. The toolbar popup explains where to find the controls. Enable **Allow access to file URLs** in the extension's details if you use local `file:` pages; ordinary browser restrictions on file pages still apply.

For Firefox 128+, run `npm run build:firefox`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `build/firefox/manifest.json`. Grant the extension access to the sites you want to emulate. This package uses the same scripts and assets with a Firefox MV3 event-page manifest. Temporary installations last until Firefox exits; rerun the build and reload the extension and page after changes. Store releases linked above may lag the development build.

### How to build the extension and polyfill

Use Node.js 22 or newer and npm. All maintained source and build tooling is TypeScript. The build emits the `polyfill/webxr-polyfill.js` bundle, its synchronous MAIN-world initializer, and classic browser scripts in `dist/extension/` and `dist/app/`; the manifest and HTML already reference those outputs. Build before loading the repository root as an unpacked extension.

```sh
$ git clone https://github.com/takahirox/WebXR-emulator-extension.git
$ cd WebXR-emulator-extension
$ git checkout dev
$ npm install
$ npm run typecheck
$ npm run build
```

Run `npm run build` after editing TypeScript, then reload the extension and inspected page. Commit the regenerated `dist/` scripts, polyfill bundle, and `package-lock.json` with source changes. `.build/` is temporary compiler output and is removed after a successful build. `npm ci` reproduces the locked dependencies.

`npm run typecheck` checks every maintained source, build script, and test with strict TypeScript settings. Both the DevTools panel and AR scene use **Three.js 0.186.1 (r186)** and its matching npm addons, bundled locally by Rollup. The old `src/app/three/` scripts and `window.THREE` global have been removed. Declarations use `@types/three` 0.186.0. The panel and AR renderer require **WebGL2**; applications emulated by the extension may still use WebGL1. Modern sRGB color management and lighting can change shading from the legacy renderer. See [Three.js migration and validation](docs/threejs-migration.md) for the texture compositing contract and [TypeScript development notes](docs/typescript-migration.md) for other dependency contracts.

Chrome uses a service worker and two manifest-declared `document_start` content scripts: the polyfill runs in the page's MAIN world and configuration/extension messaging runs in the isolated world. HTTP, HTTPS, and permitted file pages and their matching frames receive WebXR before their first page script. Broad site access is needed for this synchronous startup; injection after a toolbar click would be too late. No remote code, inline script insertion, or unsafe evaluation is used. Configuration is still applied asynchronously from extension storage. See [MV3 architecture and security decisions](docs/manifest-v3.md).

### Browser regression checks

`npm run test:browser` loads the actual unpacked extension in a fresh, temporary desktop Chromium profile, opens its real DevTools panel, and checks legacy profile migration, Quest VR/MR selection and persistence, session switching/restart, stereo and monoscopic views, configuration persistence, synchronous injection under a restrictive script CSP, service-worker shutdown/recovery, matching same-origin and cross-origin frames, tab isolation, VR pose messages and select/squeeze, AR room rendering, persistent/transient hit testing, and mouse input. It serves a local TypeScript regression sample and deletes the profile afterward; no personal browser profile is used.

Android AR now has a production `dom-overlay` path for connected HTML roots: the original live root follows the virtual phone screen, accepts native left-click/form/scroll input, and reports `screen`. Quest MR/VR and inline remain unsupported (required rejects, optional omitted, state null). Native `:xr-overlay`, full viewport CSS, SVG roots and arbitrary opaque components remain unsupported; embedded-frame overlay pointer interaction is blocked. Read the [implementation and validation report](docs/dom-overlay-implementation.md) before relying on this restricted subset. **Issue #15 remains open** for Quest stereo/input and the remaining Android/CSS/security acceptance work.

`test:browser` also runs focused API conformance cases for Quest VR, Quest MR, and Android AR, plus test-only DOM Overlay feasibility prototypes with screenshot pixel assertions at DPR 1/2 and resized viewports. `npm run test:wpt` runs five pinned upstream WPT files with the documented emulator harness, and `npm run test:samples` checks published Immersive Web samples, including the Barebones AR DOM Overlay sample and its native exit button. See [standards validation and limitations](docs/webxr-conformance.md) for exact coverage.

Install the current Playwright desktop Chromium with `npx playwright install chromium`, then run `npm run test:browser`. To test a specific current stable build, set `WEBXR_CHROMIUM_EXECUTABLE` to a desktop Chromium / Chrome for Testing executable (not its headless shell). The original MV3 acceptance run used stable **Chrome for Testing 155.0.8059.79**; the two-profile regression passed on Playwright desktop **Chromium 156.0.8078.4**. No MV2 compatibility flags are used. Branded Chrome/Edge no longer accept the automation sideloading flags; use Chrome for Testing or Playwright Chromium for automation and Load unpacked in Chrome's UI for manual installation.

```sh
$ npm run build
$ npx playwright install chromium
$ npm run test:browser
# Optional stable browser override:
$ WEBXR_CHROMIUM_EXECUTABLE=/absolute/path/to/Chrome-for-Testing npm run test:browser
```

The check requires a desktop display and WebGL (software rendering is enabled for this test profile). It writes local screenshots to ignored `test-results/`. See [device-profile implementation and validation](docs/device-profiles.md) for current behavior, results, screenshots, and limitations, and [recorded MV3 validation](docs/manifest-v3.md#validation) for the original migration checks.

## Note

- Even if native WebXR API is available the extension overrides it with WebXR polyfill

## WebXR examples

- [WebXR Samples](https://immersive-web.github.io/webxr-samples/)
- [Three.js WebXR VR examples](https://threejs.org/examples/?q=WebXR#webxr_vr_ballshooter)
- [Babylon.js WebXR examples](https://doc.babylonjs.com/how_to/webxr_demos_and_examples)
- [A-Frame](https://aframe.io/)

## Kudos

Thanks to [WebVR-Extension project](https://github.com/spite/WebVR-Extension), it was a true inspiration for us when building this one.

## License

Mozilla Public License Version 2.0
