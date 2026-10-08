import { CircleX, TriangleAlert } from 'lucide-react';

import { cn } from '../../lib/cn';
import {
  formatIssueCounts,
  type IssueCounts,
  type IssueTranslate,
} from '../feedback/issue-summary';

export interface FlowNodeIssueMarkerProps {
  errors: number;
  warnings: number;
  className?: string;
}

const CHIP =
  'animate-in fade-in inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-xs font-medium tabular-nums duration-[var(--duration-short)] motion-reduce:animate-none';

/**
 * The problem counts on a flow node's face: a red chip for errors, an amber
 * one for warnings, nothing when the node has neither.
 *
 * Decoration only (`aria-hidden`), and never a control: it sits inside the
 * node's own button, so the node says the same in words — append
 * {@link flowNodeIssueText} to the node's accessible name. A chip fades in
 * when it appears; reduced motion shows it at once.
 */
export function FlowNodeIssueMarker({
  errors,
  warnings,
  className,
}: FlowNodeIssueMarkerProps) {
  if (errors <= 0 && warnings <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="flow-node-issue-marker"
      className={cn('inline-flex items-center gap-1', className)}
    >
      {errors > 0 && (
        <span
          data-severity="error"
          className={cn(CHIP, 'bg-destructive/10 text-destructive')}
        >
          <CircleX className="size-3 shrink-0" />
          {errors}
        </span>
      )}
      {warnings > 0 && (
        <span
          data-severity="warning"
          className={cn(
            CHIP,
            'bg-amber-500/15 text-amber-800 dark:text-amber-300',
          )}
        >
          <TriangleAlert className="size-3 shrink-0" />
          {warnings}
        </span>
      )}
    </span>
  );
}

/**
 * What a node's marker says, for its accessible name: "(2 errors and
 * 1 warning)", or an empty string when the node has no problems.
 */
export function flowNodeIssueText(
  tIssues: IssueTranslate,
  counts: IssueCounts,
): string {
  if (counts.errors <= 0 && counts.warnings <= 0) return '';
  return tIssues('nodeSummary', {
    ns: 'issues',
    summary: formatIssueCounts(tIssues, counts),
  });
}

/**
 * The node frame's colour for its worst problem: the error red, the warning
 * amber, or nothing. Applied instantly — colour is never animated. Keep the
 * selection ring distinct from it (`ring-ring`), so a selected node with a
 * problem shows both.
 */
export function flowNodeIssueFrameClass(counts: IssueCounts): string {
  if (counts.errors > 0) return 'border-destructive';
  if (counts.warnings > 0) return 'border-amber-600 dark:border-amber-500';
  return '';
}
