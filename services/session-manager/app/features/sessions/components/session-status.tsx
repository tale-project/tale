import { cn } from '@tale/ui/cn';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { statusTone, type ShownStatus, type StatusTone } from '../lib/status';

const VARIANTS = {
  idle: 'neutral',
  accent: 'info',
  ok: 'success',
  warn: 'warning',
  danger: 'error',
} as const satisfies Record<StatusTone, string>;

/** The words of a state ("Running", "Assigning proxy…") in the person's language. */
export function useStatusLabel(): (status: ShownStatus) => string {
  const { t } = useT('sessions');
  return useMemo(() => {
    const labels: Record<ShownStatus, string> = {
      stopped: t('status.stopped'),
      assigning: t('status.assigning'),
      starting: t('status.starting'),
      running: t('status.running'),
      stopping: t('status.stopping'),
      error: t('status.error'),
    };
    return (status) => labels[status];
  }, [t]);
}

interface SessionStatusProps {
  status: ShownStatus;
  /** Only the colour, with no words of its own: the neighbour says the state (a row does). */
  dotOnly?: boolean;
  className?: string;
}

/**
 * A session's state as a coloured dot and, unless `dotOnly`, its words. The
 * dot is decorative and the colour never stands alone: the state is always in
 * words, beside the dot, or, where the dot is all there is, in what names it.
 */
export function SessionStatus({
  status,
  dotOnly = false,
  className,
}: SessionStatusProps) {
  const label = useStatusLabel()(status);
  const busy = status === 'assigning' || status === 'starting';
  return (
    <StatusIndicator
      variant={VARIANTS[statusTone(status)]}
      pulse={busy || status === 'stopping'}
      // The warning colour is for fills: as words it is 2.08:1 on the light
      // page. The dot keeps it; the words of a state that is stopping take the
      // text colour (`cn` lets it replace the variant's `text-warning`).
      className={cn(
        statusTone(status) === 'warn' && 'text-foreground',
        className,
      )}
    >
      {dotOnly ? null : label}
    </StatusIndicator>
  );
}
