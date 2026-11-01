import { createFileRoute } from '@tanstack/react-router';

import { EnterpriseSsoSettings } from '@/app/features/settings/enterprise-sso/components/enterprise-sso-settings';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { cachedAbility } from '@/app/lib/loader-preload';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/enterprise-sso')({
  head: () => ({ meta: seo('enterpriseSso') }),
  loader: ({ context, params }) => {
    // Only owners and admins may read the settings; anyone else only gets
    // the denial.
    const ability = cachedAbility(context, params.id);
    if (ability !== null && ability.cannot('read', 'orgSettings')) return;
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
