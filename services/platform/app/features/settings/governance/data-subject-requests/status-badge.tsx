'use client';

import {
  AlertCircle,
  Ban,
  Check,
  Clock,
  Loader2,
  Lock,
  UserCheck,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { ErasureStatus } from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const HOUR_MS = 60 * 60 * 1000;

// H10-1/2: distinct hue per state (`pending` and `running` previously
// shared identical blue) plus a leading icon so colour is not the sole
// signal (WCAG 1.4.1 Use of Color). Background opacity bumped from /15
// to /20 so the chip boundary clears WCAG 1.4.11 non-text contrast at
// 3:1 against the surface.
const STATUS_CLASSNAME: Record<ErasureStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  running: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  done: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  partial: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  failed: 'bg-red-500/20 text-red-700 dark:text-red-300',
  blocked: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  cancelled: 'bg-muted/60 text-muted-foreground',
};

const STATUS_ICON: Record<ErasureStatus, LucideIcon> = {
  pending: Clock,
  running: Loader2,
  done: Check,
  partial: AlertCircle,
  failed: X,
  blocked: Lock,
  cancelled: Ban,
};

interface StatusBadgeProps {
  status: ErasureStatus;
  /**
   * Cooling-off deadline (ms epoch). When set and in the future, the
   * badge renders "Pending · Nh until execution" with a Clock icon to
   * make clear that nothing is being deleted yet — only after this
   * timestamp does the processor pick up the row and flip to `running`.
   * Pass `request.effectiveAt` from the row.
   */
  effectiveAt?: number;
  /**
   * Set when the row's `dsar_governance.requireDualApproval` is on and
   * a second admin has not yet approved. Renders "Awaiting approval"
   * with a UserCheck icon.
   */
  awaitingApproval?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  effectiveAt,
  awaitingApproval,
  className,
}: StatusBadgeProps) {
  const { t } = useT('governance');
  // Pending sub-state: cooling-off, awaiting-approval, or "about to run".
  // `running` is reserved strictly for "processor is actively executing".
  let icon: LucideIcon = STATUS_ICON[status];
  let label: string = t(`dataSubjectRequests.status.${status}`);
  const tone = STATUS_CLASSNAME[status];
  if (status === 'pending') {
    if (awaitingApproval) {
      icon = UserCheck;
      label = t('dataSubjectRequests.status.pendingAwaitingApproval');
    } else if (effectiveAt !== undefined && effectiveAt > Date.now()) {
      const hoursLeft = Math.max(
        1,
        Math.ceil((effectiveAt - Date.now()) / HOUR_MS),
      );
      icon = Clock;
      label = t('dataSubjectRequests.status.pendingCoolingOff', {
        hours: hoursLeft,
      });
    }
  }
  const Icon = icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <Icon
        className={cn(
          'size-3 shrink-0',
          // Spinner only on `running`. `motion-reduce` respects user
          // preference per AGENTS.md accessibility guidance.
          status === 'running' && 'animate-spin motion-reduce:animate-none',
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
