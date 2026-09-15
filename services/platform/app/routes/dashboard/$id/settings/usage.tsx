import { createFileRoute } from '@tanstack/react-router';

import { UsageSettings } from '@/app/features/settings/usage/components/usage-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/usage')({
  head: () => ({
    meta: seo('usage'),
  }),
  // Warm both reads so a warm navigation paints the meters, not the masks.
  loader: ({ context, params }) => {
    void ensureConvexQuery(context, 'governance/queries:getMyBudgetUsage', {
      organizationId: params.id,
    }).catch(console.warn);
    void ensureConvexQuery(context, 'documents/queries:getUploadUsage', {
      organizationId: params.id,
    }).catch(console.warn);
  },
  component: UsagePage,
});

function UsagePage() {
  const { id } = Route.useParams();
  return <UsageSettings organizationId={id} />;
}
