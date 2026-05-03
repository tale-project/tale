import { createFileRoute } from '@tanstack/react-router';

import { PersonalizationSettings } from '@/app/features/settings/personalization/components/personalization-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/personalization')(
  {
    head: () => ({
      meta: seo('personalization'),
    }),
    component: PersonalizationPage,
  },
);

function PersonalizationPage() {
  return <PersonalizationSettings />;
}
