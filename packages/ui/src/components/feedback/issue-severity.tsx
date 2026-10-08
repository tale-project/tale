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
 * `text-foreground`. The glyph alone tells a warning from an error by
 * sight, so it keeps 3:1 (WCAG 1.4.11) on every surface a list row sits
 * on, its hover and current-row fill included: amber-700 holds 4.6:1 even
 * on `bg-muted`, where amber-600 drops to 2.9:1. Dark keeps amber-500
 * (7:1 or more on every dark surface).
 */
export const ISSUE_SEVERITY_ICON_CLASS: Readonly<
  Record<IssueSeverity, string>
> = {
  error: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-500',
  info: 'text-muted-foreground',
};

/**
 * A count chip's fill and text per blocking severity: a tint of the
 * severity's colour under text that keeps AA on it (4.7:1 or more on every
 * surface, light and dark). The chip's glyph takes the text colour.
 */
export const ISSUE_SEVERITY_CHIP_CLASS: Readonly<
  Record<Exclude<IssueSeverity, 'info'>, string>
> = {
  error: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

/**
 * The border colour of a part that holds a problem (a flow node's frame).
 * Both clear 3:1 against the page and a card in either theme. A frame
 * repeats what a chip or a message already says, so it may stay amber-600.
 */
export const ISSUE_SEVERITY_FRAME_CLASS: Readonly<
  Record<Exclude<IssueSeverity, 'info'>, string>
> = {
  error: 'border-destructive',
  warning: 'border-amber-600 dark:border-amber-500',
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
