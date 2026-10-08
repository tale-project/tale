import { CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * How serious a reported problem is. An `error` stops the thing it belongs
 * to (a save, a run); a `warning` is worth a look but blocks nothing; `info`
 * is a note.
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * One glyph per severity, so a severity reads by shape as well as colour
 * (WCAG 1.4.1): a crossed circle, a warning triangle, an info circle.
 */
export const ISSUE_SEVERITY_ICON: Readonly<Record<IssueSeverity, LucideIcon>> =
  {
    error: CircleX,
    warning: TriangleAlert,
    info: Info,
  };

/**
 * The glyph's colour per severity. Only the ICON is amber for a warning —
 * amber text fails AA on a light surface, so warning text stays
 * `text-foreground`. The amber pair is the one `Alert`'s warning variant
 * paints its icon with.
 */
export const ISSUE_SEVERITY_ICON_CLASS: Readonly<
  Record<IssueSeverity, string>
> = {
  error: 'text-destructive',
  warning: 'text-amber-600 dark:text-amber-500',
  info: 'text-muted-foreground',
};

export interface IssueSeverityIconProps {
  severity: IssueSeverity;
  /** Size and placement, e.g. `size-4 mt-0.5`. Defaults to `size-4`. */
  className?: string;
  /**
   * Names the glyph for assistive technology. Without it the glyph is
   * decoration (`aria-hidden`) and the surrounding text must say the
   * severity — the lists in this family add a visually hidden "Error:".
   */
  label?: string;
}

/** The severity glyph in its colour. */
export function IssueSeverityIcon({
  severity,
  className,
  label,
}: IssueSeverityIconProps) {
  const Icon = ISSUE_SEVERITY_ICON[severity];
  const classes = cn(
    'size-4 shrink-0',
    ISSUE_SEVERITY_ICON_CLASS[severity],
    className,
  );
  if (label === undefined || label === '') {
    return <Icon aria-hidden="true" className={classes} />;
  }
  return <Icon role="img" aria-label={label} className={classes} />;
}
