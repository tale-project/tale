'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';

/**
 * Coordinates single-active-player behaviour across every assistant bubble
 * in the chat. When a new player calls `claim(stopper)`, the previously-
 * active player's stopper is invoked so audio doesn't overlap. Replaces a
 * module-level `let activeStopper` that previously leaked across thread
 * navigations, React Strict-Mode double-mounts, and HMR reloads.
 *
 * Usage: wrap the chat view (e.g. `<VoiceOutputProvider>` around
 * `<ChatMessages>`) and consume via `useVoiceOutputCoordinator()` inside
 * the player hook.
 */

type Stopper = () => void;

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
  return (
    <VoiceOutputContext.Provider value={value}>
      {children}
    </VoiceOutputContext.Provider>
  );
}

export function useVoiceOutputCoordinator(): VoiceOutputCoordinator {
  return useContext(VoiceOutputContext);
}
