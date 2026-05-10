'use client';

import type { ErasureStatus } from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const STATUS_CLASSNAME: Record<ErasureStatus, string> = {
  pending: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  partial: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  blocked: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
};

interface StatusBadgeProps {
  status: ErasureStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useT('governance');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSNAME[status],
        className,
      )}
    >
      {t(`dataSubjectRequests.status.${status}`)}
    </span>
  );
}
