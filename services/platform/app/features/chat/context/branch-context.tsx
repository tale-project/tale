'use client';

import { useQuery } from 'convex/react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

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
  /** The original thread ID from the URL. */
  rootThreadId: string | undefined;
  /** The thread ID to actually load data from (may differ from rootThreadId on a branch). */
  activeBranchThreadId: string | undefined;
  /** All branches for this root thread. */
  branches: ThreadBranch[];
  /**
   * Current branch selections: forkOrder (as string) → chosen branchThreadId.
   * forkOrder is the message order of the edited user message — it's stable across
   * cloned threads (unlike message IDs which change on clone).
   */
  branchSelections: Record<string, string>;
  /** Switch to a different branch at a fork point. Pass null to go back to the parent. */
  switchBranch: (forkOrder: string, branchThreadId: string | null) => void;
  /** Select a newly created branch (called after editAndBranch succeeds). */
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
 *
 * Selections are keyed by forkOrder (the message order of the edited user message).
 */
function resolveActiveBranch(
  rootThreadId: string | undefined,
  branches: ThreadBranch[],
  selections: Record<string, string>,
): string | undefined {
  if (!rootThreadId) return undefined;

  let currentThreadId = rootThreadId;

  // Walk through selections: at each fork point, follow the selected branch
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

  const rawBranches =
    useQuery(
      api.threads.queries.getThreadBranches,
      threadId ? { rootThreadId: threadId } : 'skip',
    ) ?? [];

  // Stabilize branch array reference — useQuery returns new arrays each render.
  // Compare by serialized content so downstream useMemo/useCallback deps don't thrash.
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
        if (branchThreadId === null) {
          const { [forkOrder]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [forkOrder]: branchThreadId };
      });
    },
    [],
  );

  const selectNewBranch = useCallback(
    (forkOrder: string, branchThreadId: string) => {
      setBranchSelections((prev) => ({
        ...prev,
        [forkOrder]: branchThreadId,
      }));
    },
    [],
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
