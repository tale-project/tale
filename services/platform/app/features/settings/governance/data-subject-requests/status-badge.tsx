'use client';

import {
  AlertCircle,
  Check,
  Clock,
  Loader2,
  Lock,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { ErasureStatus } from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
};

const STATUS_ICON: Record<ErasureStatus, LucideIcon> = {
  pending: Clock,
  running: Loader2,
  done: Check,
  partial: AlertCircle,
  failed: X,
  blocked: Lock,
};

interface StatusBadgeProps {
  status: ErasureStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useT('governance');
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSNAME[status],
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
      {t(`dataSubjectRequests.status.${status}`)}
    </span>
  );
}
