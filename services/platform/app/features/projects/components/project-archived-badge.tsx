'use client';

import { Badge } from '@tale/ui/badge';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Inline badge when a project is archived — the project page's breadcrumb
 * leaf, so a retired project says so on every one of its tabs rather than
 * only in the Projects list.
 */
export function ProjectArchivedBadge({ className }: { className?: string }) {
  const { t } = useT('projects');
  return (
    <Badge variant="yellow" icon={Archive} className={className}>
      {t('archived.badge')}
    </Badge>
  );
}
