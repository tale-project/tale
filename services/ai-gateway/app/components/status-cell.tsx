import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react';

import type { AccountStatus } from '@/app/lib/api';
import { useT } from '@/lib/i18n/client';

/**
 * A glyph per status, not only a tint.
 *
 * Colour alone carries no meaning for a reader who cannot see it (WCAG 1.4.1),
 * and below `md` this cell has no room for its label — so the shape is what
 * says which of the three states a row is in, at every width.
 */
const STATUS_MARK = {
  active: { icon: CheckCircle2, tone: 'text-success' },
  // An expired credential is a chore, not a fault: someone re-authenticates
  // it and the pool is whole again. A failed call is the alarming one.
  expired: { icon: TriangleAlert, tone: 'text-warning' },
  error: { icon: XCircle, tone: 'text-destructive' },
} as const satisfies Record<
  AccountStatus,
  { icon: unknown; tone: `text-${string}` }
>;

/**
 * An account's state: the glyph always, the words from `md` up.
 *
 * The label is never removed, only hidden — `sr-only md:not-sr-only` is the
 * same collapse `Button` and `Switch` use — so a screen reader announces the
 * state in full at every width, and the tooltip is a pointer affordance on
 * top rather than the only way to the words. That is also why the trigger
 * takes no `tabIndex`: a span is not a control, and putting one in the tab
 * order would buy a keyboard user nothing the accessible name does not
 * already give them.
 */
export function StatusCell({ status }: { status: AccountStatus }) {
  const { t } = useT('status');
  const { icon: Icon, tone } = STATUS_MARK[status];
  const label = t(status);

  return (
    <Tooltip content={label}>
      <span className="text-foreground flex min-w-0 items-center gap-2 text-sm">
        {/* The tint rides the glyph, never the words. A status colour is a
            3:1 graphic under WCAG 1.4.11, which these tones clear; as 14px
            body text they do not reach the 4.5:1 that 1.4.3 asks for
            (`text-destructive` measures 3.66:1 on the row surface). */}
        <Icon aria-hidden className={cn('size-4 shrink-0', tone)} />
        {/* Wraps rather than truncates: the longest labels ("Letzter Aufruf
            fehlgeschlagen", "Réautorisation nécessaire") take a second line,
            which every row has room for, instead of losing their end. */}
        <span className="sr-only md:not-sr-only md:line-clamp-2">{label}</span>
      </span>
    </Tooltip>
  );
}
