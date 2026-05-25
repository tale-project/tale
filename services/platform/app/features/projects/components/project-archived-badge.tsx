'use client';

import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Compact inline badge shown next to a project's name when it is archived.
 * Used by the project overview header.
 */
export function ProjectArchivedBadge() {
  const { t } = useT('projects');
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
      <Archive className="size-3" aria-hidden="true" />
      {t('archived.badge')}
    </span>
  );
}
