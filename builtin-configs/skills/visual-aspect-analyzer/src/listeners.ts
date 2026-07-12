// Phase A of auto-detection: the "event boundary" registry.
//
// Bundled into the instrument IIFE and installed at the very top of it (in
// `instrument-global.ts`), BEFORE the page's own scripts run — the driver injects
// the bundle via `addInitScript`, which executes first. It faithfully wraps
// `EventTarget.prototype.add/removeEventListener` so that every target a page
// wires up with a high-signal interaction listener (click / pointer / key /
// input / submit / change) is recorded. A node with such a listener is almost
// always a component a developer built, so the scored selector (`select.ts`)
// reads this as one of its strongest signals.

/** Listener types that mark a developer-recognized interactive boundary. */
export const BOUNDARY_EVENTS: readonly string[] = [
  'click',
  'pointerdown',
  'pointerup',
  'keydown',
  'input',
  'submit',
  'change',
];

export type ListenerRegistry = {
  /** The boundary-event types currently registered on a target. */
  typesFor: (target: EventTarget) => ReadonlySet<string>;
  /** Whether the target carries at least one boundary listener. */
  has: (target: EventTarget) => boolean;
  /**
   * Whether a boundary listener has been registered since the last call (resets
   * the flag). The instrument polls this to re-run its scored selection when a
   * page binds an interaction handler AFTER settle (lazy hydration), which is
   * otherwise never re-scored and silently dropped from the audit.
   */
  drainPending: () => boolean;
};

/** The minimal prototype surface the registry patches. */
type ListenablePrototype = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
>;

const EMPTY: ReadonlySet<string> = new Set();

/** A registry that records nothing — the fallback where `EventTarget` is absent. */
export function nullListenerRegistry(): ListenerRegistry {
  return { typesFor: () => EMPTY, has: () => false, drainPending: () => false };
}

/**
 * Patch `add`/`removeEventListener` on `proto`, recording boundary-type
 * registrations into a `WeakMap` keyed by target. Returns the registry plus an
 * `uninstall` that restores the originals (used by tests). The wrappers are
 * faithful — they preserve `this`, every argument, and the return value — and
 * never throw: a bookkeeping failure is logged and the original call still runs.
 */
export function installListenerRegistry(proto: ListenablePrototype): {
  registry: ListenerRegistry;
  uninstall: () => void;
} {
  const map = new WeakMap<EventTarget, Set<string>>();
  // Set whenever a boundary listener is registered; drained by the instrument to
  // trigger a re-score for handlers bound after the settle-time selection.
  let pending = false;
  const origAdd = proto.addEventListener;
  const origRemove = proto.removeEventListener;

  // Rest-typed off the originals so the wrappers stay faithful to whatever exact
  // signature the host's EventTarget declares (it varies between lib/bun types).
  proto.addEventListener = function (
    this: EventTarget,
    ...args: Parameters<ListenablePrototype['addEventListener']>
  ): void {
    const type = args[0];
    try {
      if (BOUNDARY_EVENTS.includes(type)) {
        let set = map.get(this);
        if (!set) {
          set = new Set();
          map.set(this, set);
        }
        if (!set.has(type)) {
          set.add(type);
          pending = true; // a (possibly new) interaction boundary appeared
        }
      }
    } catch (err) {
      console.warn('[va] listener-registry add bookkeeping failed', err);
    }
    return origAdd.call(this, ...args);
  };

  proto.removeEventListener = function (
    this: EventTarget,
    ...args: Parameters<ListenablePrototype['removeEventListener']>
  ): void {
    try {
      // A type may have several listeners; clearing it once is acceptable noise
      // for a heuristic, and never throwing matters more than exactness.
      map.get(this)?.delete(args[0]);
    } catch (err) {
      console.warn('[va] listener-registry remove bookkeeping failed', err);
    }
    return origRemove.call(this, ...args);
  };

  const registry: ListenerRegistry = {
    typesFor: (target) => map.get(target) ?? EMPTY,
    has: (target) => (map.get(target)?.size ?? 0) > 0,
    drainPending: () => {
      const had = pending;
      pending = false;
      return had;
    },
  };
  const uninstall = (): void => {
    proto.addEventListener = origAdd;
    proto.removeEventListener = origRemove;
  };
  return { registry, uninstall };
}
