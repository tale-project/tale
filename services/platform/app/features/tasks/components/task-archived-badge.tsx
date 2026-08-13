'use client';

import { Badge } from '@tale/ui/badge';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/** Inline badge when a task is archived — shown in the task detail header. */
export function TaskArchivedBadge() {
  const { t } = useT('tasks');
  return (
    <Badge variant="yellow" icon={Archive}>
      {t('archived.badge')}
    </Badge>
  );
}
