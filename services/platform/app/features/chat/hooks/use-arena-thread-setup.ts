import { useEffect, useRef } from 'react';

import { useArenaModeOptional } from '../components/arena/arena-mode-context';
import { useCreateArenaThreadB } from './mutations';

interface UseArenaThreadSetupParams {
  organizationId: string;
  threadId: string | undefined;
}

/**
 * Arena-mode thread-pair lifecycle, extracted from ChatInterface.
 *
 * Owns the three effects that (1) reset the per-thread setup guard when arena
 * mode turns off, (2) eagerly set Thread A and create a fresh Thread B when
 * arena mode is enabled on an existing thread, and (3) exit arena mode when
 * navigating from a thread back to new chat. Self-contained: reads the arena
 * context internally. ChatInterface still reads `useArenaModeOptional()`
 * separately for rendering/send — reading the context twice is cheap.
 */
export function useArenaThreadSetup({
  organizationId,
  threadId,
}: UseArenaThreadSetupParams): void {
  const arenaContext = useArenaModeOptional();
  const isArenaMode = arenaContext?.isArenaMode ?? false;

  // Idempotent: ensure Thread B exists for the current thread.
  // If an arena pair already exists, returns the existing Thread B ID.
  // If not, creates Thread B and copies message history from Thread A.
  const { mutateAsync: createArenaThreadB } = useCreateArenaThreadB();
  const creatingThreadBRef = useRef(false);
  const arenaSetupThreadRef = useRef<string | null>(null);

  // Reset setup ref when arena mode is turned off, so re-enabling triggers setup again
  useEffect(() => {
    if (!isArenaMode) {
      arenaSetupThreadRef.current = null;
    }
  }, [isArenaMode]);

  // When arena mode is enabled on an existing thread, eagerly set Thread A
  // and create a fresh Thread B with the current message history snapshot.
  useEffect(() => {
    if (!arenaContext || !isArenaMode || !threadId) return;
    // Already set up for this thread
    if (arenaSetupThreadRef.current === threadId) return;
    arenaSetupThreadRef.current = threadId;

    arenaContext.setArenaThreadIdA(threadId);

    // Skip if Thread B was already created (e.g. by use-send-message's
    // new-chat arena path which creates both threads during send).
    if (arenaContext.arenaThreadIdB) {
      return;
    }

    // Create fresh Thread B (always new — history may have changed since last arena session)
    if (!creatingThreadBRef.current) {
      creatingThreadBRef.current = true;
      void createArenaThreadB({ threadIdA: threadId, organizationId })
        .then((threadIdB) => {
          arenaContext.setArenaThreadIdB(threadIdB);
        })
        .catch((error) => {
          console.error('Failed to create arena thread B:', error);
          // The setup guard was claimed optimistically (line above) before
          // creation; clear it on failure so a later effect run can retry
          // rather than being permanently short-circuited.
          if (arenaSetupThreadRef.current === threadId) {
            arenaSetupThreadRef.current = null;
          }
        })
        .finally(() => {
          creatingThreadBRef.current = false;
        });
    }
  }, [arenaContext, isArenaMode, threadId, createArenaThreadB, organizationId]);

  // Reset arena mode when navigating FROM a thread back to new chat.
  // Track whether we previously had a threadId to avoid disabling
  // arena mode when the user enables it on the new chat page.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    const hadThread = prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;
    if (hadThread && !threadId && arenaContext?.isArenaMode) {
      arenaContext.exitArenaMode();
    }
  }, [threadId, arenaContext]);
}
