// Observation of the application's own pinned module instances. Source bytes,
// calls, return values and exceptions remain unchanged.
import {Node} from '/samples/js/render/core/node.js';
import {Scene} from '/samples/js/render/scenes/scene.js';
const draw = Scene.prototype.drawXRFrame;
Scene.prototype.drawXRFrame = function (...args) {
  const result = Reflect.apply(draw, this, args);
  window.hitProbe.sampleScene = this;
  return result;
};
const clone = Node.prototype.clone;
Node.prototype.clone = function (...args) {
  const result = Reflect.apply(clone, this, args);
  if (this.children.some(c => c._url?.includes('sunflower'))) window.hitProbe.flowers.push(result);
  return result;
};
window.hitSampleObserverReady = true;
