'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';

import { useBranchContext } from '../context/branch-context';

interface BranchNavigatorProps {
  /** The message order of the edited user message at this fork point. */
  forkOrder: number;
}

/**
 * Renders a `< 2 / 3 >` branch navigator at a fork point in the message list.
 *
 * Finds all branches at this forkOrder regardless of which thread is currently active.
 * The "original" parent counts as option 0, each branch is 1+.
 */
export function BranchNavigator({ forkOrder }: BranchNavigatorProps) {
  const ctx = useBranchContext();

  const forkOrderKey = String(forkOrder);

  // Find all branches at this fork point. Look for branches whose forkOrder matches,
  // regardless of parentThreadId — this ensures the navigator works on both
  // the original thread and any branch thread.
  const siblings = useMemo(
    () =>
      ctx.branches
        .filter((b) => b.forkOrder === forkOrder)
        .sort((a, b) => a.branchIndex - b.branchIndex),
    [ctx.branches, forkOrder],
  );

  // Total options: original parent (0) + branches
  const totalCount = siblings.length + 1;

  // Determine current index based on which thread is active.
  // If we're viewing one of the branch threads, find its index.
  // Otherwise we're on the original (index 0).
  const currentIndex = useMemo(() => {
    const activeId = ctx.activeBranchThreadId;
    if (!activeId) return 0;
    const idx = siblings.findIndex((b) => b.branchThreadId === activeId);
    return idx >= 0 ? idx + 1 : 0;
  }, [ctx.activeBranchThreadId, siblings]);

  const handlePrev = useCallback(() => {
    if (currentIndex <= 0) return;
    const newIndex = currentIndex - 1;
    if (newIndex === 0) {
      // Go back to the original parent thread
      ctx.switchBranch(forkOrderKey, null);
    } else {
      const branch = siblings[newIndex - 1];
      if (branch) {
        ctx.switchBranch(forkOrderKey, branch.branchThreadId);
      }
    }
  }, [currentIndex, siblings, forkOrderKey, ctx]);

  const handleNext = useCallback(() => {
    if (currentIndex >= totalCount - 1) return;
    const branch = siblings[currentIndex];
    if (branch) {
      ctx.switchBranch(forkOrderKey, branch.branchThreadId);
    }
  }, [currentIndex, totalCount, siblings, forkOrderKey, ctx]);

  if (totalCount <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-0.5 py-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={handlePrev}
        disabled={currentIndex <= 0}
        aria-label="Previous branch"
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="text-muted-foreground min-w-[3ch] text-center text-xs tabular-nums">
        {currentIndex + 1} / {totalCount}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={handleNext}
        disabled={currentIndex >= totalCount - 1}
        aria-label="Next branch"
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
