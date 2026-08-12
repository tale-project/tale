'use client';

import { Badge } from '@tale/ui/badge';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Compact inline badge shown next to a project's name when it is archived.
 * Used by the project overview header.
 */
export function ProjectArchivedBadge() {
  const { t } = useT('projects');
  return (
    <Badge variant="yellow" icon={Archive}>
      {t('archived.badge')}
    </Badge>
  );
}
