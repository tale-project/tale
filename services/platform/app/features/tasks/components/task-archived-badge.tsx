'use client';

import { Badge } from '@tale/ui/badge';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Inline badge when a task is archived — the task detail header, and the
 * board card and list row, where `opacity-70` alone carried the meaning and
 * colour is not an accessible sole cue (WCAG 2.1 AA 1.4.1).
 */
export function TaskArchivedBadge({ className }: { className?: string }) {
  const { t } = useT('tasks');
  return (
    <Badge variant="yellow" icon={Archive} className={className}>
      {t('archived.badge')}
    </Badge>
  );
}
