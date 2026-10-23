// HTML b342939 event-handler activation/processing, scoped to XR IDL attributes.
// A listener keeps its registration position while its callback value changes.
export type EventHandler = ((event: Event) => unknown) | object | null;
type Handler = {value: EventHandler; listener: EventListener};
const handlers = new WeakMap<object, Map<string, Handler>>();
const add = EventTarget.prototype.addEventListener;
const remove = EventTarget.prototype.removeEventListener;
const preventDefault = Event.prototype.preventDefault;

export function installEventHandlers(prototype: object, names: readonly string[], brand: (value: object) => boolean) {
  for (const name of names) Object.defineProperty(prototype, `on${name}`, {
    enumerable: true, configurable: true,
    get(this: object) {
      if (!brand(this)) throw new TypeError('Invalid XR event-handler receiver.');
      return handlers.get(this)?.get(name)?.value ?? null;
    },
    set(this: EventTarget, value: unknown) {
      if (!brand(this)) throw new TypeError('Invalid XR event-handler receiver.');
      // LegacyTreatNonObjectAsNull applies to primitives, not handleEvent objects.
      const converted = Object(value) === value ? value as EventHandler : null;
      let map = handlers.get(this);
      const existing = map?.get(name);
      if (converted === null) {
        if (existing) { remove.call(this, name, existing.listener); map!.delete(name); }
      } else if (existing) existing.value = converted;
      else {
        if (!map) handlers.set(this, map = new Map());
        const handler: Handler = {value: converted, listener: event => {
          const callback = handler.value;
          // Let native dispatch report exceptions and continue other listeners.
          if (typeof callback === 'function' && Reflect.apply(callback, this, [event]) === false) preventDefault.call(event);
        }};
        map.set(name, handler);
        add.call(this, name, handler.listener);
      }
    },
  });
}
