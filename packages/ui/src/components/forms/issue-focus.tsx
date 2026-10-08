'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/** Offsets into the text a control shows, start inclusive, end exclusive. */
export type IssueFocusRange = readonly [number, number];

/** Something a reader can be taken to: a control, a heading, a panel. */
export interface IssueFocusTarget {
  /**
   * Moves focus here. `range` is passed only when the request names this
   * target's own anchor exactly — a request for a part of it (a key inside a
   * JSON value) has offsets into that part, not into this control.
   */
  focus(range?: IssueFocusRange): void;
  /** Makes the target visible first: opens the disclosure or tab it sits in. */
  reveal?(): void;
}

export interface IssueFocusTargetOptions {
  /**
   * Opens what hides the target before it takes focus — a collapsed section
   * or an unselected tab. A closed `<details>` around an element target
   * opens without it.
   */
  reveal?: () => void;
}

/** How long a request waits for its target to mount. */
const PENDING_MS = 2000;

interface Registration {
  readonly resolve: () => IssueFocusTarget | null;
  readonly reveal: () => (() => void) | undefined;
}

interface PendingRequest {
  readonly anchor: string;
  readonly range: IssueFocusRange | undefined;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** `anchor` names `request` or a part of it (on `/` boundaries). */
function covers(anchor: string, request: string): boolean {
  return (
    anchor === request ||
    request.startsWith(anchor.endsWith('/') ? anchor : `${anchor}/`)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Opens every closed `<details>` the element sits in, innermost last. */
function openEnclosingDetails(element: HTMLElement): void {
  let details = element.parentElement?.closest('details');
  while (details) {
    if (!details.open) details.open = true;
    details = details.parentElement?.closest('details');
  }
}

/**
 * The default target for an element: open what folds it away, focus it,
 * select the range in a text control, and scroll it into view.
 */
function elementTarget(element: HTMLElement): IssueFocusTarget {
  return {
    focus(range) {
      openEnclosingDetails(element);
      element.focus({ preventScroll: true });
      if (
        range !== undefined &&
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement) &&
        // Inputs without a text selection (number, email) answer null.
        element.selectionStart !== null
      ) {
        const length = element.value.length;
        const start = clamp(range[0], 0, length);
        const end = clamp(range[1], start, length);
        element.setSelectionRange(start, end);
      }
      element.scrollIntoView({ block: 'nearest' });
    },
  };
}

function isFocusTarget(
  value: RefObject<HTMLElement | null> | IssueFocusTarget,
): value is IssueFocusTarget {
  return 'focus' in value && typeof value.focus === 'function';
}

/**
 * The targets of one surface, by anchor, and the request waiting for one.
 * An anchor is a `/`-separated path (a JSON pointer suits); a request goes to
 * the longest registered anchor that names it or a part of it.
 */
class IssueFocusRegistry {
  private readonly targets = new Map<string, Registration[]>();
  private pending: PendingRequest | null = null;

  register(anchor: string, registration: Registration): () => void {
    const list = this.targets.get(anchor) ?? [];
    list.push(registration);
    this.targets.set(anchor, list);
    const waiting = this.pending;
    if (waiting !== null && covers(anchor, waiting.anchor)) {
      // Targets mounting in one commit register one after another; settle
      // once they all have, so the most specific of them wins.
      queueMicrotask(() => {
        if (this.pending !== waiting) return;
        if (this.resolve(waiting.anchor, waiting.range)) this.clearPending();
      });
    }
    return () => {
      const current = this.targets.get(anchor);
      if (current === undefined) return;
      const rest = current.filter((entry) => entry !== registration);
      if (rest.length === 0) this.targets.delete(anchor);
      else this.targets.set(anchor, rest);
    };
  }

  request(anchor: string, range: IssueFocusRange | undefined): void {
    this.clearPending();
    if (this.resolve(anchor, range)) return;
    const timer = setTimeout(() => {
      if (this.pending?.timer === timer) this.pending = null;
    }, PENDING_MS);
    this.pending = { anchor, range, timer };
  }

  /** Drops a waiting request; the targets unregister themselves. */
  dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending !== null) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private resolve(anchor: string, range: IssueFocusRange | undefined): boolean {
    let best: string | null = null;
    for (const registered of this.targets.keys()) {
      if (!covers(registered, anchor)) continue;
      if (best === null || registered.length > best.length) best = registered;
    }
    if (best === null) return false;
    const registration = this.targets.get(best)?.at(-1);
    const target = registration?.resolve() ?? null;
    if (registration === undefined || target === null) return false;
    const exactRange = best === anchor ? range : undefined;
    const reveal = registration.reveal() ?? target.reveal?.bind(target);
    if (reveal === undefined) {
      target.focus(exactRange);
      return true;
    }
    reveal();
    // Let what the reveal opened render before the target takes focus.
    requestAnimationFrame(() => target.focus(exactRange));
    return true;
  }
}

const IssueFocusContext = createContext<IssueFocusRegistry | null>(null);

/**
 * Scopes "go to a problem" to one surface (an editor): the controls inside
 * register as targets by anchor, and anything inside can ask to focus an
 * anchor. Two editors on one page keep two registries.
 */
export function IssueFocusProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new IssueFocusRegistry());
  useEffect(() => () => registry.dispose(), [registry]);
  return (
    <IssueFocusContext.Provider value={registry}>
      {children}
    </IssueFocusContext.Provider>
  );
}

/**
 * Registers `target` as where problems at `anchor` (and its parts, unless
 * something more specific registers) are fixed. Pass the control's ref — its
 * element is focused, the range selected in an `input`/`textarea`, and a
 * closed `<details>` around it opened — or an object with your own `focus`.
 * Register a range-capable target only where the control shows the anchored
 * string verbatim, since the range is offsets into that string. `null`
 * registers nothing. Inert without an {@link IssueFocusProvider}.
 */
export function useIssueFocusTarget(
  anchor: string | null,
  target: RefObject<HTMLElement | null> | IssueFocusTarget,
  options?: IssueFocusTargetOptions,
): void {
  const registry = useContext(IssueFocusContext);
  const latest = useRef({ target, reveal: options?.reveal });
  useLayoutEffect(() => {
    latest.current = { target, reveal: options?.reveal };
  });

  useEffect(() => {
    if (registry === null || anchor === null) return undefined;
    return registry.register(anchor, {
      resolve: () => {
        const current = latest.current.target;
        if (isFocusTarget(current)) return current;
        return current.current === null ? null : elementTarget(current.current);
      },
      reveal: () => latest.current.reveal,
    });
  }, [anchor, registry]);
}

/**
 * Returns `request(anchor, range?)`: focuses the longest registered anchor
 * that names `anchor` or a part of it. When none has registered yet — the
 * panel holding the field is still opening — the request waits up to two
 * seconds for one; a newer request replaces it.
 */
export function useRequestIssueFocus(): (
  anchor: string,
  range?: IssueFocusRange,
) => void {
  const registry = useContext(IssueFocusContext);
  return useCallback(
    (anchor: string, range?: IssueFocusRange) => {
      if (registry === null) {
        console.warn(
          '[issue-focus] a focus request outside an IssueFocusProvider has no targets',
          anchor,
        );
        return;
      }
      registry.request(anchor, range);
    },
    [registry],
  );
}
