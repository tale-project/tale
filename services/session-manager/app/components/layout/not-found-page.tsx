import { LinkButton } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { PageLayout } from '@tale/ui/page-layout';
import { SearchX } from 'lucide-react';

import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { documentTitle } from '@/app/lib/page-head';
import { useT } from '@/lib/i18n/client';

/**
 * What an address that no route knows shows: that the page is not there, and
 * the way back to the first section. It is the router's `defaultNotFoundComponent`
 * and sits in the frame of the app, so the rail stays to leave by. Like the
 * platform's own 404 (`not-found-state.tsx`, `dashboard-not-found.tsx`) it is
 * one empty state whose title is the page's `h1`, with no header of its own
 * above it that would say the same thing a second time.
 */
export function NotFoundPage() {
  const { t } = useT('navigation');
  // The router titles the tab from the deepest route that matched, and an
  // address nobody knows has still matched the sections on its way
  // (`/settings/typo` matched `/settings`), so it would be titled "Settings".
  useDocumentTitle(documentTitle(t('notFound.title')));
  return (
    <PageLayout>
      <EmptyState
        icon={SearchX}
        headingLevel={1}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <LinkButton href="/sessions" variant="secondary">
            {t('notFound.back')}
          </LinkButton>
        }
      />
    </PageLayout>
  );
}
