import { createFileRoute } from '@tanstack/react-router';

import { ProxiesPage } from '@/app/features/proxies/components/proxies-page';
import {
  PROXIES_FIRST_WINDOW,
  proxyListQuery,
} from '@/app/features/proxies/hooks/use-proxy-list';
import { validateProxiesSearch } from '@/app/features/proxies/lib/search';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/proxies')({
  // What is typed in the search box: `?q=198.51`.
  validateSearch: validateProxiesSearch,
  // The first rows are asked for with the page, under the key its table reads,
  // so they are often there by its first frame. The page does not wait for
  // them: a list is masked by its table while it loads, never held back by the
  // route, as on the platform. Whether the pool has any proxy at all is in
  // the counts, which the root route waits for.
  loader: ({ context }) => {
    void context.queryClient
      .ensureQueryData(proxyListQuery(PROXIES_FIRST_WINDOW))
      .catch((error: unknown) => {
        console.warn('Failed to load the proxies', error);
      });
  },
  head: () => pageHead(i18n.t('navigation:sections.proxies')),
  component: ProxiesPage,
});
