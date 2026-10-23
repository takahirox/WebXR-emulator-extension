## Summary

XRInputSource metadata previously read mutable adapter fields, `profiles` returned a new mutable array on every read, and retained Gamepads could reconnect to later sessions. Snapshot readonly metadata and one frozen ordered profiles array per source; expose boolean `skipRendering: false`. Recreate sources for handedness, target-ray mode, profile contents/order/length or Gamepad-presence changes, delivering old/new identities in one change event after updating the live collection.

## Outcome

Each active Quest source owns one SameObject Gamepad with live sampled state, empty ID, index -1, xr-standard mapping, placeholder slots and existing digital touched/pressed/value behavior. Removal/replacement/end permanently disconnects it and retains its final sampled axes/buttons/timestamp. Later input, reconnection, restart and profile switching cannot change it. Preserve touch add/start/select/end/remove order and one identity per gesture; retired target-ray/grip/joint spaces yield null within the same session. Foreign spaces and inactive frames still reject.

Recreated hands resolve their controller slot from adapter identity, so disconnecting an earlier controller and then replacing the surviving hand source preserves its wrist/grip pose. Quest VR/MR regressions cover this sequence and retirement of the previous hand joints.

No feature descriptor or hand negotiation change. Ordered Quest/hand/touchscreen profiles and supported-device nullability are preserved. Additional tracked-sources support, virtual haptics and deferred modules remain follow-ups; this does not complete the broader compatibility goal or administratively closed Issue #11.

Correction provenance retained from the Issue: an earlier assessment assumed shared adapter Gamepads proved universally distinct cross-session allocation was mandatory. The [Gamepads WD, 7 July 2025](https://www.w3.org/TR/webxr-gamepads-module-1/#xrinputsource) guarantees SameObject within a source and specifies connection/frame updates, without explicitly mandating distinct allocation for every session. Per-source wrappers and permanent final-sample retention are our implementation policy for coherent source lifetimes. The published alias identifies that publication; the dated URL was unavailable.

Two related implementation assumptions were also corrected: the old getter treated every non-screen source as having a grip and every controller Gamepad as using xr-standard. The [Device CRD, 9 June 2026](https://www.w3.org/TR/2026/CRD-webxr-20260609/#xrinputsource-interface) requires null grips for nontrackable gaze as well as screen sources. The [Gamepads mapping rules](https://www.w3.org/TR/webxr-gamepads-module-1/#xr-standard-gamepad-mapping) also require tracked-pointer and a non-null grip for xr-standard; other modes can use empty mapping. Metadata replacement now follows those rules, preserving tracked-pointer Quest mapping/nullability and screen Android nullability. Gaze is a controlled metadata fixture, not a new selectable device. This does not weaken the Issue's acceptance or require an Issue requirement change. No GitHub edits/comments were made by this implementation node.

## Validation

`npm run build`, `npm run test:browser` and `git diff --check` passed on macOS arm64 with Chromium **156.0.8078.4**. Focused lifecycle checks executed **168** assertions in Quest VR, **168** in Quest MR and **43** in Android AR (including empty inline frames), plus the held-Gamepad panel profile-switch probe. Two initial harness errors were corrected. The hand-slot regression failed on the earlier bundle and passed after the fix; the full browser suite, build and whitespace checks passed again for that revision.

See the [committed execution record](webxr-input-lifecycle-validation-2026-10-24.json) for actual command results, browser/version, assertion counts, exact focused coverage, resolved harness failures and skips. The capability inventory documents the lifecycle policy and pinned WPT adaptations.

`tests/input-lifecycle.ts` extends the existing unpacked-extension browser runner across Quest VR, Quest MR, Android AR and empty inline input. Controlled metadata getters and adapter activation/state updates replace native fake-device setters, without adding a production testing API. Android uses real simulated-screen mouse handlers; the panel actually switches a held Quest MR Gamepad to Android and retains it across later phone sessions/gestures. Assertions are adapted from pinned WPT input identity/profiles/recreation/removal/Gamepad disconnection cases; this is **not verbatim WPT execution** or full WebXR conformance.

Firefox runtime, physical hardware and optional Three.js controller/model connection/removal consumption were not exercised. Existing Three.js rendering checks remain part of the browser suite. No independent evaluator execution is claimed.

## Related Issues

Closes #27.

## Required post-merge verification

None.
