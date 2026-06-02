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
  organizationId: string;
  children: ReactNode;
}

/** Sentinel value indicating the user explicitly selected the original (parent) thread. */
const ORIGINAL_SELECTION = '__original__';

/**
 * Resolves the active branch thread ID by walking the branch chain
 * from the root thread through the user's branch selections.
 *
 * When no selection exists for a fork point, defaults to the latest branch
 * (highest branchIndex) so the user sees the most recent edit.
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

    // Find branches forking from the current thread
    const children = branches.filter(
      (b) => b.parentThreadId === currentThreadId,
    );
    if (children.length === 0) break;

    // Group by forkOrder and pick the earliest fork point
    const forkOrders = [...new Set(children.map((b) => b.forkOrder))].sort(
      (a, b) => a - b,
    );

    for (const forkOrder of forkOrders) {
      const key = String(forkOrder);
      const siblingsAtFork = children.filter((b) => b.forkOrder === forkOrder);

      // Explicit selection: original or a specific branch
      if (key in selections) {
        if (selections[key] === ORIGINAL_SELECTION) {
          // User explicitly chose the original — stay on parent, stop walking
          break;
        }
        const selected = siblingsAtFork.find(
          (b) => b.branchThreadId === selections[key],
        );
        if (selected) {
          currentThreadId = selected.branchThreadId;
          changed = true;
          break;
        }
      }

      // No selection: default to the latest branch (highest branchIndex)
      const latest = siblingsAtFork.reduce((a, b) =>
        b.branchIndex > a.branchIndex ? b : a,
      );
      currentThreadId = latest.branchThreadId;
      changed = true;
      break;
    }
  }

  return currentThreadId;
}

export function BranchProvider({
  threadId,
  organizationId,
  children,
}: BranchProviderProps) {
  // User branch selections made this session (keyed by forkOrder), overlaid on
  // top of the server-persisted selections below. Kept separate so the persisted
  // value is parsed lazily in a useMemo rather than copied into state via an
  // effect: the old seed-in-effect caused a SECOND render per thread switch
  // (reset → {}, then persisted-arrives → parsed), and since `dataThreadId` is
  // derived from `activeBranchThreadId`, every chat subscription churned twice.
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>(
    {},
  );

  // Load persisted branch selections from DB
  const persistedSelections = useQuery(
    api.threads.queries.getThreadBranchSelections,
    threadId ? { threadId, organizationId } : 'skip',
  );

  // Parse persisted selections WITHOUT seeding state (no extra render when the
  // query resolves). Invalid JSON falls back to empty, same as before.
  const persistedParsed = useMemo<Record<string, string>>(() => {
    if (!persistedSelections) return {};
    try {
      const parsed: unknown = JSON.parse(persistedSelections);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const selections: Record<string, string> = {};
        for (const [key, val] of Object.entries(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated as object above
          parsed as Record<string, unknown>,
        )) {
          if (typeof val === 'string') selections[key] = val;
        }
        return selections;
      }
    } catch (err) {
      console.warn(
        '[branch-context] ignoring invalid persisted branch selections JSON',
        err,
      );
    }
    return {};
  }, [persistedSelections]);

  // Effective selections: server-persisted defaults overlaid with this
  // session's explicit switches.
  const branchSelections = useMemo(
    () => ({ ...persistedParsed, ...localOverrides }),
    [persistedParsed, localOverrides],
  );

  // Reset this session's overrides when the thread changes.
  useEffect(() => {
    setLocalOverrides({});
  }, [threadId]);

  // Keep the latest persisted selections in a ref so the persist callbacks read
  // the freshest server data without capturing it in their closure — closes a
  // narrow stale window if getThreadBranchSelections updates between a
  // callback's creation and its setLocalOverrides updater running, and keeps
  // switchBranch/selectNewBranch referentially stable.
  const persistedParsedRef = useRef(persistedParsed);
  useEffect(() => {
    persistedParsedRef.current = persistedParsed;
  }, [persistedParsed]);

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
      threadId ? { rootThreadId: threadId, organizationId } : 'skip',
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
      setLocalOverrides((prev) => {
        const next = {
          ...prev,
          [forkOrder]: branchThreadId ?? ORIGINAL_SELECTION,
        };
        // Persist the full merged set (persisted defaults + all session
        // overrides) so a reload restores every selection, not just this one.
        persistSelections({ ...persistedParsedRef.current, ...next });
        return next;
      });
    },
    [persistSelections],
  );

  const selectNewBranch = useCallback(
    (forkOrder: string, branchThreadId: string) => {
      setLocalOverrides((prev) => {
        const next = { ...prev, [forkOrder]: branchThreadId };
        persistSelections({ ...persistedParsedRef.current, ...next });
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
