# Simulated Gamepad haptics (Issue #63)

Both Quest 3 tracked controllers in immersive VR and MR have a stable, source-owned `gamepad.vibrationActuator`. `effects` is one frozen `['dual-rumble']` array. `playEffect(type, parameters)` and `reset()` return Promises with `complete`/`preempted` results. This structural virtual Gamepad actuator does not replace the browser's native Gamepad interfaces or expose devices through `navigator.getGamepads()`. Android screen inputs have `gamepad === null`; inline sessions have no controllers. Hand-tracking sources do not expose Gamepads. No new XR feature descriptor is added. `hapticActuators` stays empty; the legacy Boolean `pulse()` contract is not offered.

The contract follows the [Gamepad Working Draft, 10 July 2025, §§8–11](https://www.w3.org/TR/2025/WD-gamepad-20250710/#gamepadhapticactuator-interface) and [WebXR Gamepads Module, 7 July 2025](https://www.w3.org/TR/webxr-gamepads-module-1/). This is simulated output; it makes no force, motor-frequency or hardware timing guarantee.

## Parameters and results

Binding conversion rejects bad receivers (including proxies and prototype copies) before touching arguments. The required type uses WebIDL enum string conversion: unknown values, missing arguments and Symbols reject with `TypeError`. The optional dictionary accepts undefined/null and reads inherited members once in lexicographic order: duration, leftTrigger, rightTrigger, startDelay, strongMagnitude, weakMagnitude. Defaults are zero. Milliseconds use WebIDL `unsigned long long` conversion: truncate toward zero and wrap modulo 2^64; NaN/infinities become zero; BigInt and Symbol reject. Magnitudes use finite double conversion (numeric strings/null/Booleans convert); values outside [0,1] reject `TypeError`. Trigger magnitudes are converted but ignored for dual-rumble. A valid trigger-rumble request rejects `NotSupportedError`; it is never advertised or treated as successful output.

Invalid arguments leave an existing effect alone. After conversion and magnitude validation, hidden/inactive documents and retired/ended sources reject `InvalidStateError`. A valid supported request preempts the previous request on that actuator. Following the Gamepad algorithm's order, a valid unsupported trigger-rumble request also preempts the old effect before rejecting. A different controller is unaffected. Borrowed methods accept genuine related-realm actuators; no public registration handle can brand a forged object. Promises and errors use the binding's realm; actuator objects and effects arrays use their owning document's Object/Array ancestry.

The emulator caps delay to 5,000 ms and duration to the remaining part of that five-second budget. An effect starts after the converted/capped delay, emits its independent strong/weak values and completes after its capped duration. Zero duration completes in a timer task, including after a nonzero delay. Browser scheduling can run tasks late. `reset()` stops pending/playing output, resolves the old effect as `preempted`, and resolves its own Promise as `complete`, even when idle. Normally completion and preemption settle in tasks. Document teardown settles outstanding/queued results immediately before timers disappear; Promise reactions still run as microtasks.

Source removal/replacement, session end, profile or Quest-mode switch, pagehide and extension loss retire/cancel output. Visibility becoming hidden preempts existing effects and rejects new play/reset calls; returning to visible permits fresh effects on still-active sources. A retired actuator never revives or targets a later source/session. Source Gamepad identity, frozen samples, mapping and permanent disconnection are preserved.

## Panel feedback and bridge

The actual WebXR panel displays a separate readout under Left controller and Right controller. Amber indicates a delayed effect; blue glow indicates playing. Each shows strong/weak magnitudes, capped duration, delay where applicable and originating frame. Finish/reset/retirement clears its entry. Multiple frames can be displayed independently; old-source idle messages cannot clear a new source's effect. Navigation/settings changes clear feedback, and a bounded expiry (delay + duration + 250 ms) clears entries when a disappearing frame cannot deliver its idle notification. Reopening the panel does not replay historical requests; call the actuator again to inspect output.

`device-haptics` is a typed, allowlisted, data-only MAIN → isolated content → background → panel diagnostic. Content copies only the controller name, positive safe-integer session/source IDs, known state and finite bounded values. Delay + duration cannot exceed 5,000 ms. The background derives tab/frame routing from the browser sender, replacing page-supplied routing. Panels filter their inspected tab and key entries by frame/session/source. Page code can forge visual diagnostics in its own inspected tab, as it can other emulator inputs; these messages grant no privileged action, URL access or cross-tab routing. The panel retains at most 32 active entries with bounded expiry timers. No permission, service, remote code or browser flag is added.

## Reproduce

Build and load the extension using the README instructions. Open the actual WebXR DevTools panel, choose Quest VR, start an immersive-vr application, then run the README snippet using its active session. Observe the left readout during playback and its return to idle. Repeat for right and Quest MR/immersive-ar. Set startDelay to 1,000, replace a playing request, reset, end/restart the session, change mode/profile and hide the document. Retained old actuators reject after retirement. Trigger/select, squeeze and controller transforms remain available beside the indicators.

```sh
npm ci
npm run typecheck
npm run build
npm run build:firefox
npm run test:haptics
npm run test:haptics:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver npm run test:haptics:firefox
npm run test:visibility:chromium
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver npm run test:visibility:firefox
npm run test:extension-lifetime
npm run test:browser
WEBXR_FIREFOX_EXECUTABLE=/absolute/path/to/Firefox.app/Contents/MacOS/firefox \
WEBXR_GECKODRIVER=/absolute/path/to/geckodriver npm run test:firefox
npm run test:samples
```

Use a current desktop Playwright Chromium, or the README's `WEBXR_CHROMIUM_EXECUTABLE` override. Firefox uses the established packaged-extension harness and its pinned official browser/driver. Run browser suites sequentially so competing windows do not change document visibility. Focused contract reports are `test-results/haptics-contract-{chromium,firefox}.json`; they include actual panel text/computed-style observations. Panel screenshots are `test-results/haptics-{chromium,firefox}-*.png`; Firefox captures the real remote panel with `WindowGlobalParent.drawSnapshot` through the privileged test harness (a software snapshot, not a GPU-compositor readback). The deterministic clock tests replay cancelled callbacks and verify scheduled start/end, duration bounds and bridge rejection without wall-clock sleeps. Browser cases use genuine injection, WebGL, RAF and timers; controlled backend activation/metadata/session-visibility changes are limited to the fixture. The separate visibility suites switch native tabs, verify active/delayed preemption and hidden-operation errors, and restore visibility without overriding document properties. The unload suites exercise actual extension removal/reload. Feedback is queued outside state mutation to prevent diagnostic-listener reentry from stranding requests; retirement publishes its final idle notification synchronously before a discarded document can lose queued work.

Execution results, screenshots and remaining coverage are recorded in the [Issue #63 validation evidence](validation/issue-63/validation.json). These are bounded desktop emulator checks, not full WPT conformance or physical hardware certification. Required post-merge verification: none.

## Recorded validation

The [execution record](validation/issue-63/validation.json) reports passing builds, three deterministic clock/bridge tests, and **249 focused haptic assertions per browser** on Chromium 156.0.8078.4 and official Firefox 157.0. Both Quest modes, Android screen input and both profiles' inline sessions are covered. The actual panel shows independent magnitudes and delayed/playing/idle states; [Chromium VR left](validation/issue-63/haptics-chromium-immersive-vr-left-playing.png) and [Firefox MR left](validation/issue-63/haptics-firefox-immersive-ar-left-playing.png) are retained examples. The record links the other controller/mode captures and panel observations, including simultaneous parent/child output and cleanup that preserves the parent.

The complete Chromium and Firefox suites, native visibility suites, extension lifetime checks, 11 Samples selections, Chromium selection/dragging applications and both browsers' 7,320-assertion hand/provenance suites passed. Existing full-smoke failures exposed by the private runtime factory were corrected: source/frame public ancestry now belongs to the owning document, and smoke fixtures use the current private-runtime design. The deferred fixture holds genuine configuration in a fresh injected page; it does not restore public backend access or remove its resource/conversion assertions. Signed zero direction components are compared numerically. Initial failed attempts and their corrections are disclosed in the record; none are counted as passing runs. Broader WPT, other browser versions and physical hardware remain untested.
