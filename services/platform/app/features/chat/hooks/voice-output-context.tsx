'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

/**
 * Coordinates single-active-player behaviour across every assistant bubble
 * in the chat. When a new player calls `claim(stopper)`, the previously-
 * active player's stopper is invoked so audio doesn't overlap. Replaces a
 * module-level `let activeStopper` that previously leaked across thread
 * navigations, React Strict-Mode double-mounts, and HMR reloads.
 *
 * Also owns two cross-bubble side channels:
 *
 *  - **Pre-reservation error sink** — `reserveChunk` failures
 *    (BUDGET_EXCEEDED, MESSAGE_CHAR_LIMIT, RATE_LIMITED, forbidden,
 *    TTS_CHUNK_LIMIT, …) never reach the indicator's chunk-row
 *    `errorCode` path because no row exists when they fire. The chunker
 *    writes here; the player reads here.
 *
 *  - **Announcer state** — the player publishes its current playback
 *    state so a single chat-level `<VoiceOutputAnnouncer>` can render
 *    one polite-live region for screen readers. Nesting a live region
 *    inside the indicator caused over-announcement against the parent
 *    chat log; this hoists it.
 *
 * Usage: wrap the chat view (e.g. `<VoiceOutputProvider>` around
 * `<ChatMessages>`) and consume via `useVoiceOutputCoordinator()` inside
 * the player hook.
 */

type Stopper = () => void;

export type VoiceAnnouncerState =
  | 'idle'
  | 'playing'
  | 'blocked'
  | 'error'
  | 'stopped';

interface VoiceOutputCoordinator {
  /** Make `stopper` the active player; preempts the previous active.
   * Returns a Promise that resolves after the outgoing stopper has run
   * AND one microtask has elapsed — the microtask gap lets the outgoing
   * player's `pause()`/`load()` settle the prior `play()` Promise on the
   * shared singleton `<audio>` element before the incoming player swaps
   * `src` and calls `play()` again. Without this, WebKit can conflate
   * the pause+src-swap+play into one task and reject the *new* play()
   * with AbortError, leaving the indicator in `'playing'` but silent. */
  claim(stopper: Stopper): Promise<void>;
  /** Detach `stopper` only if it is currently active. */
  release(stopper: Stopper): void;
}

const noopCoordinator: VoiceOutputCoordinator = {
  claim: () => Promise.resolve(),
  release: () => {},
};

const VoiceOutputContext = createContext(noopCoordinator);

/**
 * External-store handle for the pre-reservation error sink. Each entry is
 * keyed by `messageId`. Writers (chunker) set / clear; readers (player,
 * indicator) subscribe to changes. `useSyncExternalStore` gives us
 * tearing-free reads under React 18 concurrent rendering without paying
 * the re-render-every-message cost of putting the map into context.
 */
interface PreReservationErrorStore {
  set(messageId: string, code: string): void;
  clear(messageId: string): void;
  read(messageId: string): string | undefined;
  subscribe(listener: () => void): () => void;
}

function createPreReservationErrorStore(): PreReservationErrorStore {
  const map = new Map<string, string>();
  const listeners = new Set<() => void>();
  function notify() {
    for (const l of listeners) l();
  }
  return {
    set(messageId, code) {
      if (map.get(messageId) === code) return;
      map.set(messageId, code);
      notify();
    },
    clear(messageId) {
      if (!map.has(messageId)) return;
      map.delete(messageId);
      notify();
    },
    read(messageId) {
      return map.get(messageId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Same pattern for the announcer's "active player state" channel. */
interface AnnouncerStateStore {
  set(state: VoiceAnnouncerState): void;
  read(): VoiceAnnouncerState;
  subscribe(listener: () => void): () => void;
}

function createAnnouncerStateStore(): AnnouncerStateStore {
  let current: VoiceAnnouncerState = 'idle';
  const listeners = new Set<() => void>();
  return {
    set(state) {
      if (current === state) return;
      current = state;
      for (const l of listeners) l();
    },
    read() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface VoiceOutputStores {
  preReservationErrors: PreReservationErrorStore;
  announcerState: AnnouncerStateStore;
}

const noopStores: VoiceOutputStores = {
  preReservationErrors: {
    set: () => {},
    clear: () => {},
    read: () => undefined,
    subscribe: () => () => {},
  },
  announcerState: {
    set: () => {},
    read: () => 'idle',
    subscribe: () => () => {},
  },
};

const VoiceOutputStoresContext = createContext(noopStores);

/**
 * Provider scoping voice-output single-player coordination to its subtree.
 * One per chat view; multiple chat views (split panes, modals) each get
 * their own coordinator so they don't preempt each other.
 */
export function VoiceOutputProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<Stopper | null>(null);
  const claim = useCallback(async (stopper: Stopper) => {
    if (activeRef.current && activeRef.current !== stopper) {
      try {
        activeRef.current();
      } catch (err) {
        console.warn('[voice-output] previous stopper threw', err);
      }
      // Yield one microtask so the outgoing player's media-element
      // teardown settles before the new player touches the shared
      // singleton element.
      await Promise.resolve();
    }
    activeRef.current = stopper;
  }, []);
  const release = useCallback((stopper: Stopper) => {
    if (activeRef.current === stopper) {
      activeRef.current = null;
    }
  }, []);
  const value = useMemo<VoiceOutputCoordinator>(
    () => ({ claim, release }),
    [claim, release],
  );
  // Stores are constructed once per provider mount and live alongside
  // the coordinator. They survive every consumer re-render — only the
  // `useSyncExternalStore` subscribers re-render when an entry changes.
  const stores = useMemo<VoiceOutputStores>(
    () => ({
      preReservationErrors: createPreReservationErrorStore(),
      announcerState: createAnnouncerStateStore(),
    }),
    [],
  );
  return (
    <VoiceOutputContext.Provider value={value}>
      <VoiceOutputStoresContext.Provider value={stores}>
        {children}
      </VoiceOutputStoresContext.Provider>
    </VoiceOutputContext.Provider>
  );
}

export function useVoiceOutputCoordinator(): VoiceOutputCoordinator {
  return useContext(VoiceOutputContext);
}

/**
 * Writer-side handle for the pre-reservation error sink. Chunker calls
 * `set(messageId, code)` when `reserveChunk` raises, `clear(messageId)`
 * on message change so a fresh attempt isn't poisoned by a stale code.
 */
export function useVoicePreReservationErrorSink(): {
  set(messageId: string, code: string): void;
  clear(messageId: string): void;
} {
  const stores = useContext(VoiceOutputStoresContext);
  // Arrow-wrap the store methods so the lint rule's unbound-method
  // check passes — the closure-based store implementation doesn't use
  // `this`, but TypeScript can't statically prove that.
  return useMemo(
    () => ({
      set: (messageId: string, code: string) =>
        stores.preReservationErrors.set(messageId, code),
      clear: (messageId: string) =>
        stores.preReservationErrors.clear(messageId),
    }),
    [stores],
  );
}

/**
 * Reader-side hook: subscribe to the pre-reservation error for a given
 * `messageId`. The player merges this into its `errorCode` projection so
 * indicator UX is identical to chunk-row failures.
 */
export function useVoicePreReservationError(
  messageId: string | undefined,
): string | undefined {
  const stores = useContext(VoiceOutputStoresContext);
  return useSyncExternalStore(
    (listener) => stores.preReservationErrors.subscribe(listener),
    () => (messageId ? stores.preReservationErrors.read(messageId) : undefined),
    () => undefined,
  );
}

/**
 * Writer for the announcer state channel. Player calls `set(state)` on
 * every transition; the chat-level `<VoiceOutputAnnouncer>` reads via
 * `useVoiceAnnouncerState()` and renders one polite-live region.
 */
export function useVoiceAnnouncerWriter(): (
  state: VoiceAnnouncerState,
) => void {
  const stores = useContext(VoiceOutputStoresContext);
  return useCallback(
    (state: VoiceAnnouncerState) => stores.announcerState.set(state),
    [stores],
  );
}

export function useVoiceAnnouncerState(): VoiceAnnouncerState {
  const stores = useContext(VoiceOutputStoresContext);
  return useSyncExternalStore(
    (listener) => stores.announcerState.subscribe(listener),
    () => stores.announcerState.read(),
    () => 'idle',
  );
}
