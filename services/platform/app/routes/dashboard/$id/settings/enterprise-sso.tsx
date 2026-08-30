import { createFileRoute } from '@tanstack/react-router';

import { EnterpriseSsoSettings } from '@/app/features/settings/enterprise-sso/components/enterprise-sso-settings';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/enterprise-sso')({
  head: () => ({ meta: seo('enterpriseSso') }),
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      'enterprise_sso/config/queries:get',
      {
        organizationId: params.id,
      },
    );
  },
  component: EnterpriseSsoPage,
});

function EnterpriseSsoPage() {
  const { id: organizationId } = Route.useParams();
  return <EnterpriseSsoSettings organizationId={organizationId} />;
}
