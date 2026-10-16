import {Matrix4, Raycaster, Vector2, Vector3} from 'three';
import type ARScene from './ARScene';

/** Live single-view presentation. No DOM copies, HTML serialization or capture permissions. */
export default class DOMOverlay {
  static available() {
    return typeof HTMLElement.prototype.showPopover === 'function' && 'onbeforexrselect' in HTMLElement.prototype;
  }
  static accepts(root: Element | undefined): root is HTMLElement {
    return root?.namespaceURI === 'http://www.w3.org/1999/xhtml' && root.ownerDocument === document && root.isConnected &&
      root !== document.documentElement && !root.matches('iframe, frame, object, embed, :modal') && !root.hasAttribute('popover') &&
      typeof (root as HTMLElement).showPopover === 'function';
  }

  private readonly style: string | null;
  private readonly parent: Node | null;
  private readonly events = new AbortController();
  private readonly observer: MutationObserver;
  private readonly ray = new Raycaster();
  private readonly frames = new Map<HTMLElement, string | null>();
  private readonly queued: ({x: number; y: number; start: boolean} | null)[] = [];
  private currentTouch: {x: number; y: number} | null = null;
  private pointer: number | null = null;
  private disposed = false;
  private toggleTimer = 0;
  private visible = false;
  private dpr = window.devicePixelRatio;
  private matrix = new Matrix4();
  private readonly corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  constructor(readonly root: HTMLElement, private scene: ARScene, private width: number, private height: number,
    private invalidate: () => void) {
    this.style = root.getAttribute('style'); this.parent = root.parentNode;
    // Top-layer placement preserves ancestry, selector inheritance and root identity,
    // while escaping ancestor clipping/transform/stacking contexts.
    const originalColor = getComputedStyle(root).color;
    root.setAttribute('popover', 'manual');
    const styles: Record<string, string> = {
      position: 'fixed', inset: 'auto', left: '0', top: '0', margin: '0', padding: '0', border: '0',
      'box-sizing': 'border-box', 'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
      color: originalColor, width: `${width}px`, height: `${height}px`, background: 'transparent', contain: 'paint',
      'transform-origin': '0 0', 'pointer-events': 'auto', overflow: 'auto', isolation: 'isolate',
      transition: 'none', animation: 'none', 'offset-path': 'none', translate: 'none', rotate: 'none', scale: 'none',
    };
    for (const [property, value] of Object.entries(styles)) root.style.setProperty(property, value, 'important');
    this.observer = new MutationObserver(records => {
      if (records.every(record => record.type === 'attributes' && record.target === root)) return;
      if (!this.valid()) this.invalidate(); else this.blockFrames();
    });
    try {
      root.showPopover();
      if (!this.valid() || !root.matches(':popover-open')) throw new DOMException('The overlay root could not enter the top layer.', 'NotSupportedError');
      this.blockFrames();
      this.observer.observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['style']});
      const options = {capture: true, signal: this.events.signal};
      root.addEventListener('pointerdown', this.down, options);
      // Route wheel hit testing through the main thread for the perspective DOM
      // plane. Chromium's compositor can otherwise use stale scroll geometry
      // after a display/DPR change. Keep native scrolling/default actions intact.
      root.addEventListener('wheel', () => {}, {passive: false, signal: this.events.signal});
      window.addEventListener('pointermove', this.move, options);
      window.addEventListener('pointerup', this.up, options);
      window.addEventListener('pointercancel', this.up, options);
      window.addEventListener('blur', this.cancel, {signal: this.events.signal});
      window.addEventListener('pagehide', this.invalidate, {signal: this.events.signal});
      document.addEventListener('visibilitychange', this.visibility, {signal: this.events.signal});
      root.addEventListener('beforetoggle', this.toggle, {signal: this.events.signal});
      this.update();
    } catch (error) { this.dispose(); throw error; }
  }

  private valid() {
    return this.root.isConnected && this.root.ownerDocument === document && this.root.parentNode === this.parent;
  }
  private toggle = (event: Event) => {
    // Finish the browser's top-layer transition before removing popover state.
    // Synchronous teardown in beforetoggle makes the caller's hidePopover throw.
    if ((event as ToggleEvent).newState === 'closed') this.toggleTimer = window.setTimeout(() => { if (!this.disposed) this.invalidate(); }, 0);
  };
  private visibility = () => { if (document.hidden) this.cancel(); this.update(); };
  private cancel = () => { if (this.pointer !== null) { this.pointer = null; this.queued.push(null); } };
  private blocked(x: number, y: number) {
    // Restrict every embedded browsing context, including same-origin/sandboxed
    // frames. No origin inspection can race with navigation, and no input is
    // forwarded into another document. Bounding boxes deliberately over-block.
    for (const frame of this.frames.keys()) {
      const r = frame.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }
  private blockFrames() {
    const visit = (tree: Element | ShadowRoot) => {
      for (const node of tree.querySelectorAll('*')) {
        if (node.namespaceURI === 'http://www.w3.org/1999/xhtml' && node.matches('iframe, frame, object, embed')) {
          const frame = node as HTMLElement;
          if (!this.frames.has(frame)) this.frames.set(frame, frame.getAttribute('style'));
          if (frame.style.getPropertyValue('pointer-events') !== 'none' || frame.style.getPropertyPriority('pointer-events') !== 'important') frame.style.setProperty('pointer-events', 'none', 'important');
        }
        if (node.shadowRoot) {
          this.observer.observe(node.shadowRoot, {subtree: true, childList: true, attributes: true, attributeFilter: ['style']});
          visit(node.shadowRoot);
        }
      }
    };
    visit(this.root);
    if (this.root.shadowRoot) visit(this.root.shadowRoot);
  }

  private down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || this.pointer !== null || !this.visible) return;
    if (this.blocked(event.clientX, event.clientY)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    this.pointer = event.pointerId;
    this.queued.push({x: event.clientX, y: event.clientY, start: true});
  };
  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    // Never generate XR-derived events in an embedded document. Crossing out of
    // the displayed root ends this touch; native DOM dragging remains native.
    if (!this.targetAt(event.clientX, event.clientY)) { this.cancel(); return; }
    const point = {x: event.clientX, y: event.clientY, start: false};
    const last = this.queued[this.queued.length - 1];
    if (last && !last.start) this.queued[this.queued.length - 1] = point;
    else this.queued.push(point);
  };
  private up = (event: PointerEvent) => { if (event.pointerId === this.pointer) this.cancel(); };

  /** Called before each device frame; preserve down/up even for sub-frame clicks. */
  advanceTouch() {
    if (this.queued.length) {
      this.currentTouch = this.queued.shift() ?? null;
      if (!this.currentTouch) { this.scene.onRelease?.(); return; }
    }
    if (!this.currentTouch) return;
    const {x, y} = this.currentTouch;
    // Recompute a held touch against the moving phone, even when the mouse is still.
    const world = this.targetAt(x, y) ? this.screenPoint(x, y) : null;
    if (world) this.scene.onTouch?.(world.toArray());
    else { this.currentTouch = null; this.cancel(); this.scene.onRelease?.(); }
  }
  private screenPoint(x: number, y: number) {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), this.scene.camera);
    return this.ray.intersectObject(this.scene.screen, false)[0]?.point;
  }
  targetAt(x: number, y: number): Element | null {
    if (!this.visible || this.blocked(x, y)) return null;
    let target = document.elementFromPoint(x, y);
    if (!target || !(target === this.root || this.root.contains(target))) return null;
    // Browser hit testing, including open shadow trees; no bounding-box hit guess.
    while (target.shadowRoot) {
      const inner: Element | null = target.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === target) break;
      target = inner;
    }
    if (target.matches('iframe, frame, object, embed')) return null;
    return target;
  }
  touchCoordinates(position: ArrayLike<number>) {
    const screen = this.scene.screen;
    const point = screen.worldToLocal(new Vector3().fromArray(position));
    screen.geometry.computeBoundingBox(); const box = screen.geometry.boundingBox!;
    return [2 * (point.x - box.min.x) / (box.max.x - box.min.x) - 1,
      2 * (point.y - box.min.y) / (box.max.y - box.min.y) - 1];
  }
  /** Project a real phone-touch position into the same displayed DOM hit targets. */
  targetForTouch(position: ArrayLike<number>) {
    const p = new Vector3().fromArray(position).project(this.scene.camera);
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    return this.targetAt(rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2);
  }
  update() {
    if (this.disposed) return;
    if (!this.valid()) { this.invalidate(); return; }
    if (this.dpr !== window.devicePixelRatio) {
      const scale = this.dpr / window.devicePixelRatio; this.dpr = window.devicePixelRatio;
      this.width *= scale; this.height *= scale;
      this.root.style.setProperty('width', `${this.width}px`, 'important');
      this.root.style.setProperty('height', `${this.height}px`, 'important');
    }
    const {screen, camera, renderer} = this.scene;
    screen.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
    screen.geometry.computeBoundingBox();
    const box = screen.geometry.boundingBox!;
    const rect = renderer.domElement.getBoundingClientRect();
    const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y;
    const local = new Matrix4().set(sx / this.width, 0, 0, box.min.x, 0, -sy / this.height, 0, box.max.y, 0, 0, 1, 0, 0, 0, 0, 1);
    const viewport = new Matrix4().set(rect.width / 2, 0, 0, rect.left + rect.width / 2, 0, -rect.height / 2, 0, rect.top + rect.height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
    this.matrix.copy(viewport).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(screen.matrixWorld).multiply(local);
    const transform = `matrix3d(${this.matrix.elements.join(',')})`;
    if (this.root.style.getPropertyValue('transform') !== transform) this.root.style.setProperty('transform', transform, 'important');
    // Hide back-facing and near-plane-crossing phone screens. Otherwise CSS can
    // mirror or hit-test a plane which Three.js correctly culled behind the user.
    const cameraLocal = screen.worldToLocal(camera.getWorldPosition(new Vector3()));
    const coordinates = [[box.min.x, box.max.y], [box.max.x, box.max.y], [box.max.x, box.min.y], [box.min.x, box.min.y]];
    this.visible = !document.hidden && cameraLocal.z > 0 && coordinates.every(([x, y], i) => {
      this.corners[i].set(x, y, 0).applyMatrix4(screen.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      return this.corners[i].z < -camera.near;
    });
    const visibility = this.visible ? 'visible' : 'hidden';
    if (this.root.style.getPropertyValue('visibility') !== visibility) this.root.style.setProperty('visibility', visibility, 'important');
    // Clip both rendering and native hit targets to the physical canvas viewport.
    // The root's own paint containment clips descendants to the phone screen.
    if (!this.visible) this.cancel();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; window.clearTimeout(this.toggleTimer); this.events.abort(); this.observer.disconnect();
    this.queued.length = 0; this.currentTouch = null; this.scene.onRelease?.();
    if (this.root.matches(':popover-open')) this.root.hidePopover();
    this.root.removeAttribute('popover');
    if (this.style === null) this.root.removeAttribute('style'); else this.root.setAttribute('style', this.style);
    for (const [frame, style] of this.frames) {
      if (style === null) frame.removeAttribute('style'); else frame.setAttribute('style', style);
    }
    this.frames.clear();
  }
}
