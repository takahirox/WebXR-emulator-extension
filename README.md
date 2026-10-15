# WebXR emulator extension

WebXR emulator extension is a browser extension which helps your WebXR content creation. It enables you to responsively run [WebXR](https://www.w3.org/TR/webxr/) applications on your **desktop** browser without the need of any XR devices. 

[Blog post](https://blog.mozvr.com/webxr-emulator-extension/) / [YouTube](https://www.youtube.com/watch?v=Twnzp-LEMkU) / [Slides (in Japanese)](https://docs.google.com/presentation/d/1J-QDpm27eGzHi0vsPEqZSd5aun-GSWUm-FQC19qjSRA/edit#slide=id.g4775d037d5_0_0)

![Screenshot](./screenshots/screenshot.gif)

## Features

- [WebXR API polyfill](https://github.com/immersive-web/webxr-polyfill)
- Multiple XR devices emulation
- Both VR and AR support
- Graphical device emulator control with [Three.js](https://threejs.org/)
- Cross browsers support with [WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
<!-- - [Virtual controller (WIP)](./screenshots/virtual-controller.gif) -->

## Status

- Based on [WebXR device API draft issued on 10 October 2019](https://www.w3.org/TR/webxr/)
- No device specific emulation yet
- Supports only trigger and squeeze buttons, not other buttons

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

You can switch emulated device. The difference between devices is just degrees of freedom and the number of controllers for now.

| Device | Description |
| ---- | ---- |
| None | No device |
| Google Cardboard | 3dof headset and no controller |
| HTC Vive | 6dof headset and two 6dof controllers |
| Oculus Go | 3dof headset and 3dof controller |
| Oculus Quest | 6dof headset and two 6dof controllers |
| Samsung Gear VR | 3dof headset and 3dof controller |

### Stereo Effect

You can enable/disable Stereo Effect which renders two views.

## AR mode

WebXR emulator extension also supports AR. You can test WebXR AR application on an emulated device in a virtual room, on your desktop browser.

![Screenshot AR](./screenshots/screenshot_ar.gif)

### How to use

1. [Download and manually install the newest extension from dev branch](#how-to-install-the-newest-version)

2. Select "Samsung Galaxy S8+ (AR)" device from the device list on the top of WebXR devtool panel

3. Go to WebXR application page, for example [Three.js WebXR AR examples](https://threejs.org/examples/?q=webxr#webxr_ar_paint)

4. You will notice that the application detects that you have a XR device (emulated) and it will let you enter the immersive (AR) mode

5. AR application starts on the emulated device in a virtual room

### How to control

You can control the camera (view) and tablet in the application window.

| user action | camera/tablet control |
|----|----|
| Left mouse button drag | Camera rotation |
| Right mouse button drag | Camera pan |
| Middle mouse button drag or wheel | Move camera forward/backward |
| Mouse click on the tablet | Change the tablet gizmo mode |
| Gizmo on the tablet | Tablet rotation/translation |
| Right mouse button click on the tablet screen | touch input |

### How to control in the devtool panel

You can still control the camera and tablet in the devtool panel similar to VR.

| Devtool panel | AR virtual room |
|----|----|
| Camera | View |
| Right controller | Finger (not shown in the application window) |
| Left controller | Tablet |

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

`npm run typecheck` checks every maintained source, build script, and test with strict TypeScript settings. The unmodified third-party JavaScript in `src/app/three/` and generated output are not TypeScript sources. Three.js r111 remains the polyfill dependency; the panel's existing vendored Three.js/controls/loaders remain unchanged. Narrow dependency declarations and lifecycle assumptions are documented in [TypeScript development notes](docs/typescript-migration.md).

Chrome uses a service worker and two manifest-declared `document_start` content scripts: the polyfill runs in the page's MAIN world and configuration/extension messaging runs in the isolated world. HTTP, HTTPS, and permitted file pages and their matching frames receive WebXR before their first page script. Broad site access is needed for this synchronous startup; injection after a toolbar click would be too late. No remote code, inline script insertion, or unsafe evaluation is used. Configuration is still applied asynchronously from extension storage. See [MV3 architecture and security decisions](docs/manifest-v3.md).

### Browser regression checks

`npm run test:browser` loads the actual unpacked extension in a fresh, temporary desktop Chromium profile, opens its real DevTools panel, and checks configuration persistence, synchronous injection under a restrictive script CSP, service-worker shutdown/recovery, matching same-origin and cross-origin frames, tab isolation, VR pose messages and select/squeeze, AR room rendering, persistent/transient hit testing, and mouse input. It serves a local TypeScript regression sample and deletes the profile afterward; no personal browser profile is used.

Install the current Playwright desktop Chromium with `npx playwright install chromium`, then run `npm run test:browser`. To test a specific current stable build, set `WEBXR_CHROMIUM_EXECUTABLE` to a desktop Chromium / Chrome for Testing executable (not its headless shell). The MV3 acceptance run used stable **Chrome for Testing 155.0.8059.79**. No MV2 compatibility flags are used. Branded Chrome/Edge no longer accept the automation sideloading flags; use Chrome for Testing or Playwright Chromium for automation and Load unpacked in Chrome's UI for manual installation.

```sh
$ npm run build
$ npx playwright install chromium
$ npm run test:browser
# Optional stable browser override:
$ WEBXR_CHROMIUM_EXECUTABLE=/absolute/path/to/Chrome-for-Testing npm run test:browser
```

The check requires a desktop display and WebGL (software rendering is enabled for this test profile). It writes local screenshots to ignored `test-results/`. See [recorded MV3 validation](docs/manifest-v3.md#validation) for steps, results, and limitations.

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
