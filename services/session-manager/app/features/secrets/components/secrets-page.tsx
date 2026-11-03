import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { queryChange, viewChange } from '@/app/lib/query-param';
import { useT } from '@/lib/i18n/client';

import {
  filtersFromSearch,
  queryFromSearch,
  searchFromFilters,
  type SecretsFilters,
} from '../lib/filters';
import { SecretsTable } from './secrets-table';

const route = getRouteApi('/secrets');

/**
 * The Secrets section: the logins, cards, personal details and notes a person
 * types into pages again and again, as a collection screen. The table scrolls
 * its rows; the page does not.
 *
 * The view is in the address (`/secrets?type=note&scope=12&q=shop`: the
 * filters and the search), so a reload, a link and the way back from a session
 * keep it. A change replaces the address instead of adding to it: the filters
 * are a way of looking at the page, and the back button leaves it.
 */
export function SecretsPage() {
  const { t } = useT('navigation');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { type, scope } = search;
  const filters = useMemo(
    () => filtersFromSearch({ type, scope }),
    [type, scope],
  );
  const changeFilters = useCallback(
    (next: SecretsFilters) => {
      void navigate(viewChange(searchFromFilters(next)));
    },
    [navigate],
  );
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
          <AdaptiveHeaderTitle>{t('sections.secrets')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ContentArea variant="list">
        <SecretsTable
          filters={filters}
          onFiltersChange={changeFilters}
          query={queryFromSearch(search)}
          onQueryChange={changeQuery}
        />
      </ContentArea>
    </PageLayout>
  );
}
