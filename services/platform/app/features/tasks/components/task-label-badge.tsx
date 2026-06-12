import { cn } from '@/lib/utils/cn';

import { LABEL_DOT_CLASS, labelColor } from '../lib/labels';

/**
 * One task label as an outline chip with its colour dot (see `lib/labels`).
 * Labels are stored lowercase; `capitalize` presents them as "Bug" / "Feature"
 * without touching the stored value.
 */
export function TaskLabelBadge({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  /** Optional trailing slot (e.g. the editor's remove button). */
  children?: React.ReactNode;
}) {
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
          LABEL_DOT_CLASS[labelColor(label)],
        )}
        aria-hidden="true"
      />
      <span className="truncate capitalize">{label}</span>
      {children}
    </span>
  );
}
