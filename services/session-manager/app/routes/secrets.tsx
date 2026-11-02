import { createFileRoute } from '@tanstack/react-router';

import { SecretsPage } from '@/app/features/secrets/components/secrets-page';
import { validateSecretsSearch } from '@/app/features/secrets/lib/filters';
import { pageHead } from '@/app/lib/page-head';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/secrets')({
  // The filters of the list: `?type=note&scope=12`.
  validateSearch: validateSecretsSearch,
  head: () => pageHead(i18n.t('navigation:sections.secrets')),
  component: SecretsPage,
});
