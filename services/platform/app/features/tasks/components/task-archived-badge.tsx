'use client';

import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/** Inline badge when a task is archived — shown in the task detail header. */
export function TaskArchivedBadge() {
  const { t } = useT('tasks');
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
      <Archive className="size-3" aria-hidden="true" />
      {t('archived.badge')}
    </span>
  );
}
