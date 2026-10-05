'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ContentArea } from '@tale/ui/content-area';

import { useT } from '@/lib/i18n/client';

import type { ProjectRead } from '../hooks/queries';

/**
 * A project read that failed: said as such, with **Try again**, inside the
 * project's own page — never passed off as a project that is gone, and
 * never a blank tab (#3885). The project shell shows it in place of
 * whichever tab is open; the Overview shows it too when it renders on its
 * own.
 */
export function ProjectReadError({
  read,
  onFocusLost,
}: {
  read: ProjectRead;
  /** Where focus goes when a retry that worked takes the alert away. */
  onFocusLost?: () => void;
}) {
  const { t } = useT('projects');
  return (
    <ContentArea variant="narrow" className="py-6">
      <CatalogLoadError
        message={t('loadFailed')}
        // Each failure is announced again; Try again keeps its node.
        failureKey={read.failureCount}
        isRetrying={read.retrying}
        onRetry={read.retry}
        onFocusLost={onFocusLost}
      />
    </ContentArea>
  );
}
