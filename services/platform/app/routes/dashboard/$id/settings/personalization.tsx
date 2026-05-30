import { createFileRoute } from '@tanstack/react-router';

import { PersonalizationSettings } from '@/app/features/settings/personalization/components/personalization-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/personalization')(
  {
    head: () => ({
      meta: seo('personalization'),
    }),
    // Warm the two bounded reads that decide which sections render, so warm
    // navigations skip the skeleton and the gated sections don't pop in.
    // Best-effort — the component's own loading still renders correctly.
    loader: ({ context, params }) => {
      void ensureConvexQuery(
        context,
        api.user_preferences.queries.getMyPreferences,
        { organizationId: params.id },
      ).catch(console.warn);
      void ensureConvexQuery(
        context,
        api.personalization.queries.getOrgDefault,
        { organizationId: params.id },
      ).catch(console.warn);
    },
    component: PersonalizationPage,
  },
);

function PersonalizationPage() {
  return <PersonalizationSettings />;
}
