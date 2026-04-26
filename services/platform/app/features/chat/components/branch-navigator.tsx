'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { useBranchContext } from '../context/branch-context';

interface BranchNavigatorProps {
  /** The message order of the edited user message at this fork point. */
  forkOrder: number;
}

/**
 * Renders a `< 2 / 3 >` branch navigator at a fork point.
 *
 * Determines the correct parent thread for this fork point:
 * - If the active thread IS a branch at this forkOrder → parent is that branch's parent
 * - Otherwise → parent is the active thread itself (it has child branches here)
 *
 * The "original" parent counts as option 0, each branch is 1+.
 */
export function BranchNavigator({ forkOrder }: BranchNavigatorProps) {
  const { t } = useT('chat');
  const ctx = useBranchContext();
  const forkOrderKey = String(forkOrder);

  // Determine the parent thread for this fork point.
  // If we're viewing a branch that was forked at this order, use ITS parent.
  // Otherwise, the current thread is the parent.
  const forkParentThreadId = useMemo(() => {
    const currentAsBranch = ctx.branches.find(
      (b) =>
        b.branchThreadId === ctx.activeBranchThreadId &&
        b.forkOrder === forkOrder,
    );
    return currentAsBranch
      ? currentAsBranch.parentThreadId
      : ctx.activeBranchThreadId;
  }, [ctx.branches, ctx.activeBranchThreadId, forkOrder]);

  // Find sibling branches at this fork point (same parent + same forkOrder)
  const siblings = useMemo(
    () =>
      ctx.branches
        .filter(
          (b) =>
            b.parentThreadId === forkParentThreadId &&
            b.forkOrder === forkOrder,
        )
        .sort((a, b) => a.branchIndex - b.branchIndex),
    [ctx.branches, forkParentThreadId, forkOrder],
  );

  const totalCount = siblings.length + 1;

  // Current index: 0 = parent (original), 1+ = branch
  const currentIndex = useMemo(() => {
    if (
      !ctx.activeBranchThreadId ||
      ctx.activeBranchThreadId === forkParentThreadId
    ) {
      return 0;
    }
    const idx = siblings.findIndex(
      (b) => b.branchThreadId === ctx.activeBranchThreadId,
    );
    return idx >= 0 ? idx + 1 : 0;
  }, [ctx.activeBranchThreadId, forkParentThreadId, siblings]);

  const handlePrev = useCallback(() => {
    if (currentIndex <= 0) return;
    const newIndex = currentIndex - 1;
    if (newIndex === 0) {
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
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={handlePrev}
        disabled={currentIndex <= 0}
        aria-label={t('branchNavigator.previous')}
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
        aria-label={t('branchNavigator.next')}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
