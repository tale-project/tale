'use client';

import { useQuery } from 'convex/react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

interface ThreadBranch {
  branchThreadId: string;
  parentThreadId: string;
  forkAfterMessageId: string;
  forkOrder: number;
  branchIndex: number;
  createdAt: number;
}

interface BranchContextValue {
  rootThreadId: string | undefined;
  activeBranchThreadId: string | undefined;
  branches: ThreadBranch[];
  branchSelections: Record<string, string>;
  switchBranch: (forkOrder: string, branchThreadId: string | null) => void;
  selectNewBranch: (forkOrder: string, branchThreadId: string) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranchContext must be used within BranchProvider');
  }
  return context;
}

interface BranchProviderProps {
  threadId: string | undefined;
  children: ReactNode;
}

/**
 * Resolves the active branch thread ID by walking the branch chain
 * from the root thread through the user's branch selections.
 */
function resolveActiveBranch(
  rootThreadId: string | undefined,
  branches: ThreadBranch[],
  selections: Record<string, string>,
): string | undefined {
  if (!rootThreadId) return undefined;

  let currentThreadId = rootThreadId;

  let changed = true;
  while (changed) {
    changed = false;
    for (const branch of branches) {
      const key = String(branch.forkOrder);
      if (
        branch.parentThreadId === currentThreadId &&
        selections[key] === branch.branchThreadId
      ) {
        currentThreadId = branch.branchThreadId;
        changed = true;
        break;
      }
    }
  }

  return currentThreadId;
}

export function BranchProvider({ threadId, children }: BranchProviderProps) {
  const [branchSelections, setBranchSelections] = useState<
    Record<string, string>
  >({});
  const initializedRef = useRef(false);

  // Load persisted branch selections from DB
  const persistedSelections = useQuery(
    api.threads.queries.getThreadBranchSelections,
    threadId ? { threadId } : 'skip',
  );

  // Initialize from persisted data once on load
  useEffect(() => {
    if (persistedSelections && !initializedRef.current) {
      try {
        const parsed: unknown = JSON.parse(persistedSelections);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const selections: Record<string, string> = {};
          const entries = Object.entries(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated as object above
            parsed as Record<string, unknown>,
          );
          for (const [key, val] of entries) {
            if (typeof val === 'string') selections[key] = val;
          }
          setBranchSelections(selections);
        }
      } catch {
        // ignore invalid JSON
      }
      initializedRef.current = true;
    }
  }, [persistedSelections]);

  // Reset when thread changes
  useEffect(() => {
    initializedRef.current = false;
    setBranchSelections({});
  }, [threadId]);

  // Persist branch selections to DB
  const { mutate: updateBranchSelections } = useConvexMutation(
    api.threads.mutations.updateBranchSelections,
  );
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSelections = useCallback(
    (selections: Record<string, string>) => {
      if (!threadId) return;
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = setTimeout(() => {
        updateBranchSelections({
          threadId,
          branchSelections: JSON.stringify(selections),
        });
      }, 300);
    },
    [threadId, updateBranchSelections],
  );

  const rawBranches =
    useQuery(
      api.threads.queries.getThreadBranches,
      threadId ? { rootThreadId: threadId } : 'skip',
    ) ?? [];

  const branchesKey = JSON.stringify(rawBranches);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const branches = useMemo(() => rawBranches, [branchesKey]);

  const activeBranchThreadId = useMemo(
    () => resolveActiveBranch(threadId, branches, branchSelections),
    [threadId, branches, branchSelections],
  );

  const switchBranch = useCallback(
    (forkOrder: string, branchThreadId: string | null) => {
      setBranchSelections((prev) => {
        let next: Record<string, string>;
        if (branchThreadId === null) {
          const { [forkOrder]: _, ...rest } = prev;
          next = rest;
        } else {
          next = { ...prev, [forkOrder]: branchThreadId };
        }
        persistSelections(next);
        return next;
      });
    },
    [persistSelections],
  );

  const selectNewBranch = useCallback(
    (forkOrder: string, branchThreadId: string) => {
      setBranchSelections((prev) => {
        const next = { ...prev, [forkOrder]: branchThreadId };
        persistSelections(next);
        return next;
      });
    },
    [persistSelections],
  );

  const value = useMemo(
    () => ({
      rootThreadId: threadId,
      activeBranchThreadId,
      branches,
      branchSelections,
      switchBranch,
      selectNewBranch,
    }),
    [
      threadId,
      activeBranchThreadId,
      branches,
      branchSelections,
      switchBranch,
      selectNewBranch,
    ],
  );

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}
