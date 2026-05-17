'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { createPlaybackElement } from '../utils/prime-audio';

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
  /** Clear every entry; used on per-thread reset. */
  resetAll(): void;
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
    resetAll() {
      if (map.size === 0) return;
      map.clear();
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

/** Same pattern for the announcer's "active player state" channel.
 * The error code is carried alongside the state so the
 * `<VoiceOutputAnnouncer>` can speak a specific reason (e.g. "Voice
 * provider not configured", "Voice budget reached") on transitions
 * into `'error'` instead of the generic "Voice output failed".
 * Without the per-error reason, SR-on-touch users had no way to learn
 * what failed because the indicator's per-code tooltip is hover-only.
 */
export interface AnnouncerSnapshot {
  state: VoiceAnnouncerState;
  errorCode?: string;
}

interface AnnouncerStateStore {
  set(snapshot: AnnouncerSnapshot): void;
  /** Reset to idle; used on per-thread reset. */
  resetAll(): void;
  read(): AnnouncerSnapshot;
  subscribe(listener: () => void): () => void;
}

function createAnnouncerStateStore(): AnnouncerStateStore {
  const IDLE: AnnouncerSnapshot = { state: 'idle' };
  let current: AnnouncerSnapshot = IDLE;
  const listeners = new Set<() => void>();
  return {
    set(snapshot) {
      if (
        current.state === snapshot.state &&
        current.errorCode === snapshot.errorCode
      ) {
        return;
      }
      current = snapshot;
      for (const l of listeners) l();
    },
    resetAll() {
      if (current.state === 'idle' && current.errorCode === undefined) return;
      current = IDLE;
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

/** Singleton "what is currently playing" channel.
 *
 * Tracks the active `(messageId, chunkIndex)` for the chat view so
 * non-player consumers (e.g. the message-content paragraph-spotlight
 * renderer) can read it without re-instantiating
 * `useVoiceOutputPlayer`. Singleton (not a Map) because the
 * coordinator already enforces single-active-player invariant — only
 * one message is playing at a time. `chunkIndex` is `null` between
 * chunks but `messageId` stays set while the player is still active
 * on that message (e.g. waiting for the next chunk to be ready).
 */
export interface ActivePlaybackSnapshot {
  messageId: string;
  chunkIndex: number | null;
}

interface ActivePlaybackStore {
  set(snapshot: ActivePlaybackSnapshot | null): void;
  /** Reset to null; used on per-thread reset. */
  resetAll(): void;
  read(): ActivePlaybackSnapshot | null;
  subscribe(listener: () => void): () => void;
}

function createActivePlaybackStore(): ActivePlaybackStore {
  let current: ActivePlaybackSnapshot | null = null;
  const listeners = new Set<() => void>();
  return {
    set(snapshot) {
      if (current === null && snapshot === null) {
        return;
      }
      if (
        current !== null &&
        snapshot !== null &&
        current.messageId === snapshot.messageId &&
        current.chunkIndex === snapshot.chunkIndex
      ) {
        return;
      }
      current = snapshot;
      for (const l of listeners) l();
    },
    resetAll() {
      if (current === null) return;
      current = null;
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
  activePlayback: ActivePlaybackStore;
}

const noopStores: VoiceOutputStores = {
  preReservationErrors: {
    set: () => {},
    clear: () => {},
    resetAll: () => {},
    read: () => undefined,
    subscribe: () => () => {},
  },
  announcerState: {
    set: () => {},
    resetAll: () => {},
    read: () => ({ state: 'idle' as const }),
    subscribe: () => () => {},
  },
  activePlayback: {
    set: () => {},
    resetAll: () => {},
    read: () => null,
    subscribe: () => () => {},
  },
};

const VoiceOutputStoresContext = createContext(noopStores);

/**
 * Per-provider playback `<audio>` element. Round-5 finding #23 closed
 * the arena-split-view bug where a module-level singleton element was
 * shared across two `<VoiceOutputProvider>` instances and they
 * stomped each other's `src` mid-playback. Each provider now owns its
 * own element via `useMemo`, with the player and toggle consuming via
 * `useVoiceAudioElement()`.
 */
const VoiceAudioElementContext = createContext<HTMLAudioElement | null>(null);

/**
 * Provider scoping voice-output single-player coordination to its subtree.
 * One per chat view; multiple chat views (split panes, modals) each get
 * their own coordinator so they don't preempt each other. Also owns a
 * private `<audio>` element so split views can't stomp each other's
 * `src`.
 *
 * `threadId` is optional but recommended: when present, per-thread stores
 * (preReservationErrors, activePlayback, announcerState) are reset on
 * thread switch so a stale pre-reservation error or "playing" snapshot
 * from thread A doesn't leak into thread B. Coordinator state stays
 * singleton (it's by-element, not by-thread). Round-1 / round-2 HIGH #6.
 */
export function VoiceOutputProvider({
  children,
  threadId,
}: {
  children: ReactNode;
  threadId?: string;
}) {
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
      // element.
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
      activePlayback: createActivePlaybackStore(),
    }),
    [],
  );
  // Per-provider audio element. `null` on SSR / non-browser; the
  // player falls back to a fresh `new Audio()` in that branch so unit
  // tests in jsdom-less environments don't crash.
  const audioElement = useMemo<HTMLAudioElement | null>(
    () => createPlaybackElement(),
    [],
  );
  // Reset per-thread stores when the threadId changes so a pre-reservation
  // error from thread A doesn't surface against thread B's first message,
  // and a stale activePlayback snapshot doesn't survive the thread swap.
  // Skipped on initial mount (the stores are freshly constructed).
  const lastThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (lastThreadIdRef.current === threadId) return;
    lastThreadIdRef.current = threadId;
    stores.preReservationErrors.resetAll();
    stores.activePlayback.resetAll();
    stores.announcerState.resetAll();
  }, [threadId, stores]);
  return (
    <VoiceOutputContext.Provider value={value}>
      <VoiceOutputStoresContext.Provider value={stores}>
        <VoiceAudioElementContext.Provider value={audioElement}>
          {children}
        </VoiceAudioElementContext.Provider>
      </VoiceOutputStoresContext.Provider>
    </VoiceOutputContext.Provider>
  );
}

/**
 * Returns the provider-scoped playback element, or `null` outside a
 * provider (SSR, settings page that primes the AudioContext only).
 * Callers must tolerate `null`: the player falls back to `new Audio()`,
 * and the toggle/prime call passes `null` straight to `primeAudio` so
 * only the AudioContext gets banked.
 */
export function useVoiceAudioElement(): HTMLAudioElement | null {
  return useContext(VoiceAudioElementContext);
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
 * Writer for the announcer state channel. Player calls
 * `set({ state, errorCode })` on every transition; the chat-level
 * `<VoiceOutputAnnouncer>` reads via `useVoiceAnnouncerState()` and
 * renders one polite-live region.
 */
export function useVoiceAnnouncerWriter(): (
  snapshot: AnnouncerSnapshot,
) => void {
  const stores = useContext(VoiceOutputStoresContext);
  return useCallback(
    (snapshot: AnnouncerSnapshot) => stores.announcerState.set(snapshot),
    [stores],
  );
}

const IDLE_SNAPSHOT: AnnouncerSnapshot = { state: 'idle' };

export function useVoiceAnnouncerState(): AnnouncerSnapshot {
  const stores = useContext(VoiceOutputStoresContext);
  return useSyncExternalStore(
    (listener) => stores.announcerState.subscribe(listener),
    () => stores.announcerState.read(),
    () => IDLE_SNAPSHOT,
  );
}

/**
 * Writer for the active-playback channel. Player publishes
 * `{messageId, chunkIndex}` when it starts a chunk and `null` when it
 * stops. Single-active-player invariant (enforced by the coordinator)
 * means writers never race for the same slot.
 */
export function useActivePlaybackWriter(): (
  snapshot: ActivePlaybackSnapshot | null,
) => void {
  const stores = useContext(VoiceOutputStoresContext);
  return useCallback(
    (snapshot: ActivePlaybackSnapshot | null) =>
      stores.activePlayback.set(snapshot),
    [stores],
  );
}

/**
 * Reader: subscribe to the active-playback channel and return the
 * snapshot iff its `messageId` matches the caller's. Non-active
 * consumers (every other assistant bubble in the chat) get `null`
 * and so never re-render on chunk advances elsewhere.
 *
 * `useSyncExternalStore` is required (not plain `useState`) because
 * the store is a mutable singleton that any player can write to;
 * React 18 concurrent rendering would otherwise tear under writes
 * mid-render.
 */
export function useActivePlaybackForMessage(
  messageId: string | undefined,
): ActivePlaybackSnapshot | null {
  const stores = useContext(VoiceOutputStoresContext);
  const snapshot = useSyncExternalStore(
    (listener) => stores.activePlayback.subscribe(listener),
    () => stores.activePlayback.read(),
    () => null,
  );
  if (!messageId || !snapshot) return null;
  return snapshot.messageId === messageId ? snapshot : null;
}
