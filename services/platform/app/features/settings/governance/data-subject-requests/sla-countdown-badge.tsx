'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  type LucideIcon,
} from 'lucide-react';

import type { ErasureStatus } from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const DAY_MS = 86_400_000;
const URGENT_MS = 7 * DAY_MS;

const TERMINAL_STATUSES: ReadonlySet<ErasureStatus> = new Set<ErasureStatus>([
  'done',
  'failed',
]);

interface SlaCountdownBadgeProps {
  /** Original Art 12(3) deadline. Required. */
  slaDeadlineAt: number;
  /** When set, takes precedence — extension was granted via Art 12(3). */
  extensionDeadlineAt?: number;
  status: ErasureStatus;
  /** Override `Date.now()`. Component-test seam, not a runtime feature. */
  now?: number;
  className?: string;
}

/**
 * Returns one of four buckets so callers can paint the badge themselves.
 * Color thresholds match the spec:
 *   - green  : > 7d remaining
 *   - yellow : ≤ 7d remaining
 *   - red    : overdue
 *   - grey   : terminal status (done / failed) — countdown is moot
 */
export type SlaTone = 'green' | 'yellow' | 'red' | 'grey';

export function deriveSlaTone(args: {
  slaDeadlineAt: number;
  extensionDeadlineAt?: number;
  status: ErasureStatus;
  now: number;
}): { tone: SlaTone; effectiveDeadline: number; remainingMs: number } {
  const effectiveDeadline = args.extensionDeadlineAt ?? args.slaDeadlineAt;
  const remainingMs = effectiveDeadline - args.now;
  if (TERMINAL_STATUSES.has(args.status)) {
    return { tone: 'grey', effectiveDeadline, remainingMs };
  }
  if (remainingMs < 0) {
    return { tone: 'red', effectiveDeadline, remainingMs };
  }
  if (remainingMs <= URGENT_MS) {
    return { tone: 'yellow', effectiveDeadline, remainingMs };
  }
  return { tone: 'green', effectiveDeadline, remainingMs };
}

// H10-2: opacity bumped from /15 to /20 so the chip boundary clears
// WCAG 1.4.11 non-text contrast at 3:1 against the surface. Each tone
// also pairs with an icon (see TONE_ICON below) so colour is not the
// sole signal.
const TONE_CLASSNAME: Record<SlaTone, string> = {
  green: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  yellow: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  red: 'bg-red-500/20 text-red-700 dark:text-red-300',
  grey: 'bg-muted text-muted-foreground',
};

const TONE_ICON: Record<SlaTone, LucideIcon> = {
  green: Clock,
  yellow: Clock,
  red: AlertTriangle,
  grey: CheckCircle2,
};

export function SlaCountdownBadge({
  slaDeadlineAt,
  extensionDeadlineAt,
  status,
  now,
  className,
}: SlaCountdownBadgeProps) {
  const { t } = useT('governance');
  const { tone, remainingMs } = deriveSlaTone({
    slaDeadlineAt,
    extensionDeadlineAt,
    status,
    now: now ?? Date.now(),
  });

  let label: string;
  if (tone === 'grey') {
    label = t('dataSubjectRequests.slaBadge.terminal');
  } else if (tone === 'red') {
    const overdueDays = Math.max(1, Math.ceil(-remainingMs / DAY_MS));
    label = t('dataSubjectRequests.slaBadge.overdue', { days: overdueDays });
  } else {
    const daysLeft = Math.max(0, Math.floor(remainingMs / DAY_MS));
    label =
      daysLeft === 1
        ? t('dataSubjectRequests.slaBadge.daysLeftOne')
        : t('dataSubjectRequests.slaBadge.daysLeft', { days: daysLeft });
  }

  const Icon = TONE_ICON[tone];
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        TONE_CLASSNAME[tone],
        className,
      )}
      data-tone={tone}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
