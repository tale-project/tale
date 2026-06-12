'use client';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useProject } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { cn } from '@/lib/utils/cn';

import { LABEL_DOT_CLASS, labelColor } from '../lib/labels';

/** The project's label→colour override map (cached `getProject` read). */
export function useTaskLabelColors(projectId: Id<'projects'> | undefined) {
  const { project } = useProject(projectId);
  return project?.taskLabelColors;
}

/**
 * One task label as an outline chip with its colour dot (see `lib/labels`).
 * `projectId` resolves the project's colour overrides; without it the chip
 * falls back to the predefined/hashed colour. Labels are stored lowercase;
 * `capitalize` presents them as "Bug" / "Feature" without touching the value.
 */
export function TaskLabelBadge({
  label,
  projectId,
  className,
  children,
}: {
  label: string;
  projectId?: Id<'projects'>;
  className?: string;
  /** Optional trailing slot (e.g. the editor's remove button). */
  children?: React.ReactNode;
}) {
  const colors = useTaskLabelColors(projectId);
  return (
    <span
      className={cn(
        'border-border bg-background text-foreground inline-flex items-center gap-1.5 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          LABEL_DOT_CLASS[labelColor(label, colors)],
        )}
        aria-hidden="true"
      />
      <span className="truncate capitalize">{label}</span>
      {children}
    </span>
  );
}

/**
 * "+N" chip for labels that don't fit on a card/row; the tooltip names the
 * hidden ones.
 */
export function TaskLabelOverflow({
  labels,
  className,
}: {
  labels: string[];
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <Tooltip content={<span className="capitalize">{labels.join(', ')}</span>}>
      <span
        className={cn(
          'border-border bg-background text-foreground inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-medium',
          className,
        )}
      >
        +{labels.length}
      </span>
    </Tooltip>
  );
}
