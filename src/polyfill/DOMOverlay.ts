import {Matrix4, Vector3} from 'three';
import type ARScene from './ARScene';

/** Live single-view presentation. No DOM copies, HTML serialization or capture permissions. */
export default class DOMOverlay {
  static available() {
    return typeof HTMLElement.prototype.showPopover === 'function';
  }
  static accepts(root: Element | undefined): root is HTMLElement {
    return root?.namespaceURI === 'http://www.w3.org/1999/xhtml' && root.ownerDocument === document && root.isConnected &&
      root.getRootNode() === document && document.body?.contains(root) && !document.querySelector(':modal') && !root.matches('canvas, video, audio, img, input, select, textarea') && root !== document.documentElement && !root.closest('[inert]') && !root.matches('iframe, frame, object, embed, :modal') && !root.hasAttribute('popover') &&
      typeof (root as HTMLElement).showPopover === 'function';
  }

  private readonly style: string | null;
  private readonly parent: Node | null;
  private readonly events = new AbortController();
  private readonly observer: MutationObserver;
  private disposed = false;
  private toggleTimer = 0;
  private visible = false;
  private readonly display: string;
  private flat: boolean;
  private dpr = window.devicePixelRatio;
  private matrix = new Matrix4();
  private readonly corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  constructor(readonly root: HTMLElement, private scene: ARScene, private width: number, private height: number,
    private invalidate: () => void, flat = false) {
    this.style = root.getAttribute('style'); this.parent = root.parentNode;
    // Fixed descendants and body-wide layouts use the readable desktop fallback.
    this.flat = flat || root === document.body || Array.from(root.querySelectorAll('*')).some(node => getComputedStyle(node).position === 'fixed');
    // Top-layer placement preserves ancestry, selector inheritance and root identity,
    // while escaping ancestor clipping/transform/stacking contexts.
    const computed = getComputedStyle(root);
    const originalColor = computed.color;
    const originalBackground = computed.background;
    this.display = ['none', 'contents'].includes(computed.display) ? 'block' : computed.display;
    root.setAttribute('popover', 'manual');
    const styles: Record<string, string> = {
      display: this.display, visibility: 'visible', 'content-visibility': 'visible', opacity: '1', position: 'fixed', inset: 'auto', left: '0', top: '0', margin: '0', padding: '0', border: '0',
      'box-sizing': 'border-box', 'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
      color: originalColor, width: `${width}px`, height: `${height}px`, background: originalBackground, contain: 'paint',
      'transform-origin': '0 0', 'pointer-events': 'auto', overflow: 'auto', isolation: 'isolate',
      transition: 'none', animation: 'none', 'offset-path': 'none', translate: 'none', rotate: 'none', scale: 'none',
    };
    for (const [property, value] of Object.entries(styles)) root.style.setProperty(property, value, 'important');
    this.observer = new MutationObserver(() => {
      if (!this.valid()) this.invalidate();
    });
    try {
      const focused = document.activeElement;
      root.showPopover();
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus({preventScroll: true});
      if (!this.valid() || !root.matches(':popover-open')) throw new DOMException('The overlay root could not enter the top layer.', 'NotSupportedError');
      this.observer.observe(document, {subtree: true, childList: true});
      // Keep wheel default actions native, including perspective hit testing.
      root.addEventListener('wheel', () => {}, {passive: false, signal: this.events.signal});
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
  private visibility = () => { this.update(); };
  update() {
    if (this.disposed) return;
    if (!this.valid()) { this.invalidate(); return; }
    if (this.flat) {
      this.root.style.setProperty('width', `${Math.max(1, Math.min(560, innerWidth - 48))}px`, 'important');
      this.root.style.setProperty('height', `${Math.max(1, innerHeight - 48)}px`, 'important');
      this.root.style.setProperty('transform', 'translate(24px, 24px)', 'important');
      this.root.style.setProperty('display', document.hidden ? 'none' : this.display, 'important');
      return;
    }
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
    // visibility:hidden can be overridden by descendants. display:none removes
    // the whole subtree from painting and native hit testing, including children
    // with visibility:visible, while retaining the popover and original styles.
    this.root.style.setProperty('display', this.visible ? this.display : 'none', 'important');
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; window.clearTimeout(this.toggleTimer); this.events.abort(); this.observer.disconnect();
    if (this.root.matches(':popover-open')) this.root.hidePopover();
    this.root.removeAttribute('popover');
    // Flush pending CSSOM serialization before restoring an absent attribute.
    this.root.style.cssText = '';
    void this.root.getAttribute('style');
    if (this.style === null) this.root.removeAttribute('style'); else this.root.setAttribute('style', this.style);
  }
}
