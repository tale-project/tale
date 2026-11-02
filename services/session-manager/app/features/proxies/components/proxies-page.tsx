import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback } from 'react';

import { queryChange } from '@/app/lib/query-param';
import { useT } from '@/lib/i18n/client';

import { ProxiesTable } from './proxies-table';

const route = getRouteApi('/proxies');

/**
 * The Proxies section: the pool of proxies. A collection screen, as the
 * platform's lists are: the header holds the title, and the table's toolbar the
 * search and the ways to check and to add. `ContentArea variant="list"` bounds
 * the body, so the table scrolls its own rows and the toolbar and footer keep
 * their place. What is typed in the search box is in the address
 * (`/proxies?q=198.51`), so a reload, a link and the way back from a session
 * keep the view; a change replaces the address instead of adding to it, and the
 * back button leaves.
 */
export function ProxiesPage() {
  const { t } = useT('proxies');
  const { q } = route.useSearch();
  const navigate = route.useNavigate();
  const changeQuery = useCallback(
    (next: string) => {
      void navigate(queryChange(next));
    },
    [navigate],
  );
  return (
    <PageLayout
      header={
        <AdaptiveHeaderRoot showBorder standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ContentArea variant="list">
        <ProxiesTable query={q ?? ''} onQueryChange={changeQuery} />
      </ContentArea>
    </PageLayout>
  );
}
