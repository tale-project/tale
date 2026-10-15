import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { useFormatDate } from '@tale/ui/use-format-date';
import {
  CheckCircle2,
  Hourglass,
  TimerReset,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import type { AccountState } from '@/app/lib/api';
import { hasRolledOver, resetsSoon } from '@/app/lib/usage-windows';
import { useMinute } from '@/app/lib/use-minute';
import { useT } from '@/lib/i18n/client';

/**
 * A glyph per state, not only a tint.
 *
 * Colour alone carries no meaning for a reader who cannot see it (WCAG 1.4.1),
 * and below `md` this cell has no room for its label — so the shape is what
 * says which of the four states a row is in, at every width.
 */
const STATE_MARK = {
  available: { icon: CheckCircle2, tone: 'text-success' },
  // A spent quota is the pool working as designed, not a fault: it comes back
  // on its own. So it is the one state that is neither a tick nor an alarm —
  // an hourglass, in the neutral tone, until the hour it is about to end.
  limited: { icon: Hourglass, tone: 'text-muted-foreground' },
  // An expired credential is a chore, not a fault: someone re-authenticates
  // it and the pool is whole again. A failed call is the alarming one.
  expired: { icon: TriangleAlert, tone: 'text-warning' },
  error: { icon: XCircle, tone: 'text-destructive' },
} as const satisfies Record<
  AccountState,
  { icon: unknown; tone: `text-${string}` }
>;

/**
 * An account's state: the glyph always, the words from `md` up — and, for an
 * account whose quota is spent, the line that matters most about it: when it
 * comes back.
 *
 * That line is the account's own return, the latest rollover among its spent
 * windows. A session that resets in five minutes beside a spent week is not
 * "back in five minutes", and reading the per-window clocks to work out which
 * one counts is exactly the sum this cell does for the reader. Inside the
 * hour the hourglass turns into a timer in the success tint: the account is
 * about to take work again.
 *
 * The label is never removed, only hidden — `sr-only md:not-sr-only` is the
 * same collapse `Button` and `Switch` use — so a screen reader announces the
 * state in full at every width, and the tooltip is a pointer affordance on
 * top rather than the only way to the words. That is also why the trigger
 * takes no `tabIndex`: a span is not a control, and putting one in the tab
 * order would buy a keyboard user nothing the accessible name does not
 * already give them.
 */
export function StatusCell({
  state,
  limitedUntil,
}: {
  state: AccountState;
  limitedUntil: string | null;
}) {
  const { t } = useT('status');
  const { t: tUsage } = useT('usage');
  const { formatDate, formatRelative } = useFormatDate();
  // One reading of "now" that also moves, so a panel left open counts down.
  const now = useMinute();

  const soon = state === 'limited' && resetsSoon(limitedUntil, now);
  const mark = STATE_MARK[state];
  const Icon = soon ? TimerReset : mark.icon;
  const tone = soon ? 'text-success' : mark.tone;
  const label = t(state);

  let caption: string | null = null;
  let exact: string | null = null;
  if (state === 'limited') {
    if (limitedUntil === null) {
      caption = tUsage('resetUnknown');
    } else if (hasRolledOver(limitedUntil, now)) {
      caption = tUsage('resetsNow');
    } else {
      caption = tUsage('resets', { when: formatRelative(limitedUntil) });
      exact = tUsage('resets', { when: formatDate(limitedUntil, 'long') });
    }
  }

  return (
    <Tooltip content={[label, exact ?? caption].filter(Boolean).join(' · ')}>
      <span className="text-foreground flex min-w-0 items-start gap-2 text-sm">
        {/* The tint rides the glyph, never the words. A status colour is a
            3:1 graphic under WCAG 1.4.11, which these tones clear; as 14px
            body text they do not reach the 4.5:1 that 1.4.3 asks for
            (`text-destructive` measures 3.66:1 on the row surface). The
            nudge centres the 16px glyph on the first 20px line. */}
        <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone)} />
        <span className="flex min-w-0 flex-col">
          {/* Wraps rather than truncates: the longest labels ("Letzter Aufruf
              fehlgeschlagen", "Réautorisation nécessaire") take a second
              line, which every row has room for, instead of losing their
              end. */}
          <span className="sr-only md:not-sr-only md:line-clamp-2">
            {label}
          </span>
          {caption ? (
            <Text
              as="span"
              className="sr-only md:not-sr-only md:line-clamp-2"
              variant="caption"
            >
              {caption}
            </Text>
          ) : null}
        </span>
      </span>
    </Tooltip>
  );
}
