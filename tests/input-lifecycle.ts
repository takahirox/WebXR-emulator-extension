import type {Page} from 'playwright';
import type {SessionMode} from '../src/types/contracts';
import type * as Runtime from '../src/polyfill/api/runtime';
import type * as Layers from '../src/polyfill/api/layers';
import type {XRGamepad} from '../src/polyfill/device-adapter';

type TestWindow = typeof Runtime & typeof Layers & {navigator: {xr: Runtime.XRSystem}};

/** Hold real controller objects over the runner's next panel-driven profile switch. */
export async function startProfileSwitchProbe(page: Page) {
  return page.evaluateHandle(async () => {
    const w = window as unknown as TestWindow;
    const session = await w.navigator.xr.requestSession('immersive-ar');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!)});
    const source = await new Promise<Runtime.XRInputSource>(resolve => session.requestAnimationFrame(() => resolve(session.inputSources[0])));
    session._device._updateInputButtonPressed(true, 0, 0);
    await new Promise<void>(resolve => session.requestAnimationFrame(() => resolve()));
    const gamepad = source.gamepad!, profiles = source.profiles;
    const saved = {session, canvas, source, gamepad, profiles,
      final: null as null | {axes: readonly number[]; buttons: readonly GamepadButton[]; timestamp: number}};
    // The panel message may arrive several frames after this probe returns.
    // Capture the retirement sample at end, not an earlier live frame.
    session.addEventListener('end', () => { saved.final = {axes: gamepad.axes, buttons: gamepad.buttons, timestamp: gamepad.timestamp}; });
    return saved;
  });
}

export async function checkProfileSwitchProbe(probe: Awaited<ReturnType<typeof startProfileSwitchProbe>>) {
  await probe.evaluate(saved => {
    if (!saved.final || !saved.session.ended || saved.gamepad.connected || saved.source.gamepad !== saved.gamepad || saved.source.profiles !== saved.profiles ||
      saved.gamepad.axes !== saved.final.axes || saved.gamepad.buttons !== saved.final.buttons || saved.gamepad.timestamp !== saved.final.timestamp || !saved.gamepad.buttons[0].pressed)
      throw new Error('Panel profile switch must permanently retire the held Gamepad and preserve metadata/sample');
    saved.canvas.remove();
  });
}

/** Adapted WPT identity/recreation/disconnection assertions; see the capability inventory. */
export async function runInputLifecycle(page: Page, mode: SessionMode, handheld: boolean) {
  return page.evaluate(async ({mode, handheld}) => {
    const w = window as unknown as TestWindow;
    const passed: string[] = [];
    function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed.push(label); }
    function invalidState(action: () => unknown, label: string) {
      let error: unknown; try { action(); } catch (caught) { error = caught; }
      check(error instanceof DOMException && error.name === 'InvalidStateError', label);
    }
    function metadata(source: Runtime.XRInputSource, profiles: string[], label: string) {
      const saved = {handedness: source.handedness, targetRayMode: source.targetRayMode, profiles: source.profiles,
        gamepad: source.gamepad, hand: source.hand, targetRaySpace: source.targetRaySpace, gripSpace: source.gripSpace, skipRendering: source.skipRendering};
      check(Object.isFrozen(source.profiles) && source.profiles === source.profiles && source.profiles.join(',') === profiles.join(','), `${label}: stable frozen ordered profiles`);
      check(!Reflect.set(source.profiles, '0', 'changed') && !Reflect.deleteProperty(source.profiles, '0') && !Reflect.defineProperty(source.profiles, 'length', {value: 0}), `${label}: profiles reject mutation`);
      for (const [key, value] of Object.entries(saved)) check(!Reflect.set(source, key, null) && source[key as keyof typeof saved] === value, `${label}: readonly ${key}`);
      check(typeof source.skipRendering === 'boolean' && !source.skipRendering, `${label}: virtual input skipRendering is false`);
      return saved;
    }
    function snapshot(gamepad: XRGamepad) { return {axes: gamepad.axes, buttons: gamepad.buttons, timestamp: gamepad.timestamp, json: JSON.stringify([gamepad.axes, gamepad.buttons, gamepad.timestamp])}; }
    const retired: {gamepad: XRGamepad; state: ReturnType<typeof snapshot>}[] = [];
    function remember(gamepad: XRGamepad) { retired.push({gamepad, state: snapshot(gamepad)}); }
    function retained(label: string) {
      for (const {gamepad, state} of retired) check(!gamepad.connected && gamepad.axes === state.axes && gamepad.buttons === state.buttons && gamepad.timestamp === state.timestamp && JSON.stringify([gamepad.axes, gamepad.buttons, gamepad.timestamp]) === state.json, `${label}: retired Gamepad retains final sample`);
    }
    async function setup(sessionMode: SessionMode, hands = false) {
      const session = await w.navigator.xr.requestSession(sessionMode, {requiredFeatures: hands ? ['hand-tracking'] : []});
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const gl = canvas.getContext('webgl', {xrCompatible: true} as WebGLContextAttributes)!;
      session.updateRenderState({baseLayer: new w.XRWebGLLayer(session, gl)});
      const reference = await session.requestReferenceSpace('viewer');
      const next = <T>(read: (frame: Runtime.XRFrame) => T): Promise<T> => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Input lifecycle frame timeout')), 5000);
        session.requestAnimationFrame((_time, frame) => { clearTimeout(timeout); try { resolve(read(frame)); } catch (error) { reject(error); } });
      });
      const close = async () => { if (!session.ended) await session.end(); canvas.remove(); };
      return {session, reference, next, close};
    }
    const inline = await setup('inline');
    try { for (let i = 0; i < 3; i++) await inline.next(() => check(inline.session.inputSources.length === 0, 'inline input remains empty')); }
    finally { await inline.close(); }

    if (!handheld) {
      const test = await setup(mode), {session, reference, next} = test;
      const changes: {added: readonly Runtime.XRInputSource[]; removed: readonly Runtime.XRInputSource[]; current: Runtime.XRInputSource[]; connected: boolean}[] = [];
      session.addEventListener('inputsourceschange', event => {
        const change = event as Runtime.XRInputSourcesChangeEvent;
        changes.push({added: change.added, removed: change.removed, current: [...session.inputSources],
          connected: change.added.every(source => source.gamepad === null || source.gamepad.connected) && change.removed.every(source => source.gamepad === null || !source.gamepad.connected)});
      });
      // Controlled fixture: the real adapter is already reachable internally.
      // Override only its metadata getters, restoring every descriptor afterward.
      const device = session._device, controller = device.gamepadInputSources[0], raw = controller.inputSource;
      const keys = ['handedness', 'targetRayMode', 'profiles', 'gamepad'] as const;
      const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(raw, key)!);
      let hand = raw.handedness, ray = raw.targetRayMode, profiles = [...raw.profiles], pad = raw.gamepad;
      Object.defineProperties(raw, {
        handedness: {configurable: true, get: () => hand}, targetRayMode: {configurable: true, get: () => ray},
        profiles: {configurable: true, get: () => profiles}, gamepad: {configurable: true, get: () => pad},
      });
      try {
        let source = await next(() => session.inputSources[0]);
        const saved = metadata(source, profiles, 'Quest controller');
        const gamepad = source.gamepad!;
        check(gamepad.id === '' && gamepad.index === -1 && gamepad.mapping === 'xr-standard' && gamepad.connected && gamepad.vibrationActuator === null && gamepad.hapticActuators.length === 0, 'Quest Gamepad identity, mapping and absent haptics');
        for (let frame = 0; frame < 3; frame++) await next(() => check(session.inputSources[0] === source && source.profiles === saved.profiles && source.targetRaySpace === saved.targetRaySpace && source.gripSpace === saved.gripSpace && source.gamepad === gamepad, 'multiple frames preserve SameObject attributes'));
        device._updateInputButtonPressed(true, 0, 0); device._updateInputAxes(0, 0.25, -0.5);
        await next(() => {
          check(session.inputSources[0] === source && changes.length === 1, 'buttons and axes preserve input identity without change events');
          check(gamepad.axes.join(',') === '0,0,0.25,-0.5' && gamepad.buttons[0].pressed && gamepad.buttons[0].touched && gamepad.buttons[0].value === 1 && !gamepad.buttons[2].pressed && !gamepad.buttons[2].touched && gamepad.buttons[2].value === 0, 'live digital buttons and placeholder slots');
          check(Object.isFrozen(gamepad.axes) && Object.isFrozen(gamepad.buttons) && !Reflect.set(gamepad.axes, '2', 1) && !Reflect.set(gamepad.buttons[0], 'pressed', false), 'sampled axes and buttons reject mutation');
        });
        const transitions: [string, () => void][] = [
          ['handedness', () => { hand = 'left'; }], ['target ray mode', () => { ray = 'gaze'; }],
          ['profile contents', () => { profiles[1] = 'fixture-fallback'; }], ['profile order', () => { profiles.reverse(); }],
          ['profile length', () => { profiles.pop(); }], ['Gamepad removal', () => { pad = null; }],
          ['Gamepad return', () => { pad = descriptors[3].get!.call(raw); }],
        ];
        for (const [label, change] of transitions) {
          const old = source, oldMetadata = {hand: old.handedness, ray: old.targetRayMode, profiles: old.profiles, profileValues: old.profiles.join(','), gamepad: old.gamepad};
          if (old.gamepad) remember(old.gamepad);
          const count = changes.length;
          change();
          check(old.handedness === oldMetadata.hand && old.targetRayMode === oldMetadata.ray && old.profiles === oldMetadata.profiles && old.gamepad === oldMetadata.gamepad, `${label}: metadata is a snapshot before next frame`);
          await next(frame => {
            source = session.inputSources[0]; const event = changes[count];
            check(changes.length === count + 1 && event.added.length === 1 && event.removed.length === 1 && event.added[0] === source && event.removed[0] === old && event.current.includes(source) && !event.current.includes(old) && event.connected, `${label}: one replacement event after live collection and connection update`);
            check(source !== old && source.handedness === hand && source.targetRayMode === ray && source.profiles.join(',') === profiles.join(',') && Boolean(source.gamepad) === Boolean(pad), `${label}: replacement metadata`);
            check(old.handedness === oldMetadata.hand && old.targetRayMode === oldMetadata.ray && old.profiles === oldMetadata.profiles && old.profiles.join(',') === oldMetadata.profileValues && old.gamepad === oldMetadata.gamepad, `${label}: retired metadata remains unchanged`);
            check(frame.getPose(old.targetRaySpace, reference) === null && (!old.gripSpace || frame.getPose(old.gripSpace, reference) === null), `${label}: retired spaces return null`);
            check(source.gripSpace === null || source.targetRayMode === 'tracked-pointer', `${label}: nontrackable modes have no grip`);
            check(!source.gamepad || source.gamepad.mapping === (ray === 'tracked-pointer' ? 'xr-standard' : ''), `${label}: xr-standard mapping requires tracked-pointer`);
            retained(label);
          });
          await next(() => check(changes.length === count + 1 && session.inputSources[0] === source, `${label}: stable replacement on next frame`));
        }
        // Replacing a backing profiles array with equal contents preserves identity.
        profiles = [...profiles];
        await next(() => check(session.inputSources[0] === source, 'equal profile contents preserve identity'));
        const disconnected = source; remember(source.gamepad!); controller.active = false;
        await next(frame => {
          const event = changes[changes.length - 1];
          check(event.removed[0] === disconnected && !event.current.includes(disconnected) && session.inputSources.length === 1 && event.connected, 'controller removal updates live collection and disconnects before event');
          check(frame.getPose(disconnected.targetRaySpace, reference) === null, 'disconnected source pose is null'); retained('controller removal');
        });
        controller.active = true;
        await next(() => { source = session.inputSources[0]; check(source !== disconnected && source.gamepad!.connected, 'reconnection exposes a new active source'); retained('reconnection'); });
        remember(source.gamepad!);
        let lastFrame!: Runtime.XRFrame;
        await next(frame => { lastFrame = frame; });
        // Retain the actual final sample from the shutdown frame.
        retired[retired.length - 1].state = snapshot(source.gamepad!);
        await session.end(); retained('shutdown while held');
        check(source.gamepad!.buttons[0].pressed && source.gamepad!.axes[2] === 0.25, 'shutdown retains held buttons and axes');
        invalidState(() => lastFrame.getPose(source.targetRaySpace, reference), 'inactive frame still rejects retired spaces');
        const restarted = await setup(mode);
        try {
          await restarted.next(frame => {
            check(restarted.session.inputSources[0] !== source && restarted.session.inputSources[0].gamepad!.connected && !restarted.session.inputSources[0].gamepad!.buttons[0].pressed, 'restart exposes fresh reset controller state');
            invalidState(() => frame.getPose(source.targetRaySpace, restarted.reference), 'foreign-session retired space throws'); retained('restart');
          });
          device._updateInputButtonPressed(true, 0, 0); device._updateInputAxes(0, -0.75, 0.5);
          await restarted.next(() => retained('later-session input'));
        } finally { await restarted.close(); }
      } finally { keys.forEach((key, index) => Object.defineProperty(raw, key, descriptors[index])); await test.close(); }
      const hands = await setup(mode, true);
      const handDevice = hands.session._device;
      const handPoses = handDevice.gamepads.map(gamepad => [...gamepad.pose.position]);
      const secondHandedness = handDevice.gamepads[1].hand;
      try {
        // Distinct poses expose accidental use of the compacted active-source index.
        handDevice.gamepads.forEach((gamepad, index) => { gamepad.pose.position = [index + 1, index + 1, index + 1]; });
        const source = await hands.next(() => hands.session.inputSources[0]);
        const saved = metadata(source, ['generic-hand-select'], 'deterministic hand');
        check(source.hand?.size === 25 && source.gamepad === null && source.gripSpace !== null, 'hand metadata preserves nullability and joints');
        const joint = source.hand!.get('wrist');
        await hands.next(() => check(source.profiles === saved.profiles && source.hand === saved.hand && source.hand!.get('wrist') === joint, 'hand metadata and spaces remain stable across frames'));
        const surviving = hands.session.inputSources[1];
        const wrist = surviving.hand!.get('wrist');
        const originalWrist = await hands.next(frame => frame.getJointPose(wrist, hands.reference)!.transform.matrix);
        handDevice.gamepadInputSources[0].active = false;
        await hands.next(frame => check(frame.getPose(joint, hands.reference) === null, 'retired hand joint returns null'));
        await hands.next(frame => check(hands.session.inputSources.length === 1 && hands.session.inputSources[0] === surviving &&
          frame.getJointPose(wrist, hands.reference)!.transform.matrix.every((value, index) => Math.abs(value - originalWrist[index]) < 1e-5), 'surviving hand retains controller pose after another disconnects'));
        handDevice.gamepads[1].hand = secondHandedness === 'left' ? 'right' : 'left';
        await hands.next(frame => {
          const replacement = hands.session.inputSources[0];
          check(replacement !== surviving && replacement.handedness !== surviving.handedness, 'surviving hand metadata change replaces its source');
          const replacementWrist = replacement.hand!.get('wrist');
          const wristMatrix = frame.getJointPose(replacementWrist, hands.reference)!.transform.matrix;
          const gripMatrix = frame.getPose(replacement.gripSpace!, hands.reference)!.transform.matrix;
          check(wristMatrix.every((value, index) => Math.abs(value - originalWrist[index]) < 1e-5 && Math.abs(value - gripMatrix[index]) < 1e-5), 'recreated hand wrist stays aligned with its controller grip after another disconnects');
          check(frame.getJointPose(wrist, hands.reference) === null, 'metadata replacement retires the previous hand joints');
        });
      } finally {
        handDevice.gamepads.forEach((gamepad, index) => { gamepad.pose.position = handPoses[index]; });
        handDevice.gamepads[1].hand = secondHandedness;
        await hands.close();
      }
    } else {
      const test = await setup(mode), {session, next, reference} = test;
      const order: string[] = [], events: Runtime.XRInputSource[] = [];
      const actionPoses: boolean[] = [];
      let actionFrame: Runtime.XRFrame;
      session.addEventListener('inputsourceschange', event => {
        const change = event as Runtime.XRInputSourcesChangeEvent;
        order.push(change.added.length ? 'added' : 'removed'); events.push(...change.added, ...change.removed);
      });
      for (const name of ['selectstart', 'select', 'selectend']) session.addEventListener(name, event => {
        const input = event as Runtime.XRInputSourceEvent;
        order.push(name); events.push(input.inputSource); actionFrame = input.frame;
        actionPoses.push(input.frame.getPose(input.inputSource.targetRaySpace, reference) !== null);
      });
      function touch(pressed: boolean) {
        const {renderer, scene, camera} = (window as unknown as import('./browser-types').PanelProbeWindow).panelProbe!;
        let screen: import('three').Mesh | undefined;
        scene.traverse(object => { const mesh = object as import('three').Mesh<import('three').BufferGeometry, import('three').Material>; if (mesh.material?.customProgramCacheKey() === 'ar-screen-composite-v1') screen = mesh; });
        check(screen, 'touch fixture locates real simulated screen');
        const point = camera.position.clone().set(0, 0, 0); screen.localToWorld(point).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        renderer.domElement.dispatchEvent(new MouseEvent(pressed ? 'mousedown' : 'mouseup', {button: 2, clientX: rect.x + (point.x + 1) * rect.width / 2, clientY: rect.y + (1 - point.y) * rect.height / 2}));
      }
      try {
        await next(() => check(session.inputSources.length === 0, 'Android idle input is empty'));
        // Allow the phone scene to finish its desktop projection update.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        let previous: Runtime.XRInputSource | undefined;
        for (let gesture = 0; gesture < 2; gesture++) {
          order.length = 0; events.length = 0; actionPoses.length = 0; touch(true);
          const source = await next(() => session.inputSources[0]);
          const saved = metadata(source, ['generic-touchscreen'], `touch ${gesture}`);
          check(source !== previous && source.handedness === 'none' && source.targetRayMode === 'screen' && source.gamepad === null && source.gripSpace === null && source.hand === null, 'touch identity and nullability');
          await next(frame => {
            check(session.inputSources[0] === source && source.profiles === saved.profiles && source.targetRaySpace === saved.targetRaySpace, 'held touch preserves metadata identity');
            if (previous) check(frame.getPose(previous.targetRaySpace, reference) === null, 'later gesture cannot reactivate a retired touch space');
          });
          touch(false);
          await next(frame => {
            check(order.join(',') === 'added,selectstart,select,selectend,removed' && events.length === 5 && events.every(input => input === source), 'each gesture has ordered events with one identity');
            check(actionPoses.length === 3 && actionPoses.every(Boolean), 'touch action and release events retain valid final poses');
            invalidState(() => actionFrame.getPose(source.targetRaySpace, reference), 'completed touch event frame is inactive');
            check(session.inputSources.length === 0 && frame.getPose(source.targetRaySpace, reference) === null, 'retired same-session touch space returns null');
          });
          previous = source;
        }
      } finally { await test.close(); }
    }
    return {mode, handheld, assertions: passed.length, passed};
  }, {mode, handheld});
}
