import { createFileRoute } from '@tanstack/react-router';

import { SecretsPage } from '@/app/features/secrets/components/secrets-page';
import { secretsQuery } from '@/app/features/secrets/hooks/use-secrets';
import { validateSecretsSearch } from '@/app/features/secrets/lib/filters';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/secrets')({
  // The filters of the list: `?type=note&scope=12`.
  validateSearch: validateSecretsSearch,
  // The list is asked for with the page, under the key its table reads, and
  // not waited for: see `routes/proxies.tsx`.
  loader: ({ context }) => {
    void context.queryClient
      .ensureQueryData(secretsQuery())
      .catch((error: unknown) => {
        console.warn('Failed to load the secrets', error);
      });
  },
  head: () => pageHead(i18n.t('navigation:sections.secrets')),
  component: SecretsPage,
});
