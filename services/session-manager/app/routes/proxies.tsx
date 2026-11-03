import { createFileRoute } from '@tanstack/react-router';

import { ProxiesPage } from '@/app/features/proxies/components/proxies-page';
import { validateProxiesSearch } from '@/app/features/proxies/lib/search';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/proxies')({
  // What is typed in the search box: `?q=198.51`.
  validateSearch: validateProxiesSearch,
  head: () => pageHead(i18n.t('navigation:sections.proxies')),
  component: ProxiesPage,
});
