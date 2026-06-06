'use client';

import { useMatch } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useSetThreadCanvasState } from '@/app/features/chat/hooks/mutations';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

interface WorkspaceState {
  isOpen: boolean;
  /** Path inside the active thread, or null = use the first listed file. */
  activeFilePath: string | null;
}

interface WorkspaceContextType extends WorkspaceState {
  openWorkspace: (path?: string) => void;
  closeWorkspace: () => void;
  resetWorkspace: () => void;
  setActiveFilePath: (path: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function useWorkspaceOptional() {
  return useContext(WorkspaceContext);
}

const INITIAL_STATE: WorkspaceState = {
  isOpen: false,
  activeFilePath: null,
};

interface WorkspaceProviderProps {
  children: ReactNode;
}

/**
 * Persists canvas (workspace) pane state PER CHAT via Convex so it follows
 * the user across devices and tabs.
 *
 * Storage:
 *   - With `threadId`: source of truth is `getThreadMeta.canvasState`,
 *     written via `setThreadCanvasState` with an optimistic patch so
 *     toggles feel instant. The same `getThreadMeta` query is already
 *     consumed by `ChatInterface` + `useMessageProcessing`, so reading
 *     it here adds no new WS subscription.
 *   - Without `threadId` (brand-new chat, before the first message
 *     creates the thread): kept in component-local React state,
 *     defaulting to closed. This is *not* carried into Convex when the
 *     thread materializes — opening the canvas pre-thread is rare and
 *     the mirror+handoff seam wasn't worth the complexity. Users opening
 *     the canvas after sending the first message hit the Convex path
 *     from then on.
 *
 * `INITIAL_STATE` (closed, no active file path) is also returned while the
 * `getThreadMeta` query is loading on a cold cache, so the canvas never
 * flashes open then closed when navigating back to a thread it was open
 * on. The live subscription replaces it the moment the first result lands.
 */
export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { data: threadMeta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId ? { threadId } : 'skip',
  );

  const [localState, setLocalState] = useState(INITIAL_STATE);
  const { mutate: setCanvasState } = useSetThreadCanvasState();

  // Reset the transient new-chat state on every thread switch so navigating
  // away from a closed canvas and back to another new-chat surface doesn't
  // inherit the previous tab's open/file state.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setLocalState(INITIAL_STATE);
      prevThreadIdRef.current = threadId;
    }
  }, [threadId]);

  // Memoize so `value` (below) doesn't re-create every render — a fresh object
  // literal here would defeat the `useMemo` that depends on it.
  const state = useMemo<WorkspaceState>(
    () =>
      threadId
        ? threadMeta?.canvasState
          ? {
              isOpen: threadMeta.canvasState.isOpen,
              activeFilePath: threadMeta.canvasState.activeFilePath,
            }
          : INITIAL_STATE
        : localState,
    [threadId, threadMeta?.canvasState, localState],
  );

  const openWorkspace = useCallback(
    (path?: string) => {
      if (threadId) {
        setCanvasState({
          threadId,
          canvasOpen: true,
          // Only pass the path through when the caller supplied one; omitting
          // it tells the server-side mutation to leave the existing value
          // alone (so `openWorkspace()` with no arg preserves the active
          // file across an open→close→open cycle).
          ...(path !== undefined ? { canvasActiveFilePath: path } : {}),
        });
      } else {
        setLocalState((prev) => ({
          isOpen: true,
          activeFilePath: path ?? prev.activeFilePath,
        }));
      }
    },
    [threadId, setCanvasState],
  );

  const closeWorkspace = useCallback(() => {
    if (threadId) {
      setCanvasState({ threadId, canvasOpen: false });
    } else {
      setLocalState((prev) => ({ ...prev, isOpen: false }));
    }
  }, [threadId, setCanvasState]);

  const resetWorkspace = useCallback(() => {
    if (threadId) {
      // Reset = close pane AND clear the active-file override so a future
      // open falls back to the first listed file.
      setCanvasState({
        threadId,
        canvasOpen: false,
        canvasActiveFilePath: null,
      });
    } else {
      setLocalState(INITIAL_STATE);
    }
  }, [threadId, setCanvasState]);

  const setActiveFilePath = useCallback(
    (path: string | null) => {
      if (threadId) {
        setCanvasState({ threadId, canvasActiveFilePath: path });
      } else {
        setLocalState((prev) => ({ ...prev, activeFilePath: path }));
      }
    },
    [threadId, setCanvasState],
  );

  const value = useMemo(
    () => ({
      ...state,
      openWorkspace,
      closeWorkspace,
      resetWorkspace,
      setActiveFilePath,
    }),
    [state, openWorkspace, closeWorkspace, resetWorkspace, setActiveFilePath],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
