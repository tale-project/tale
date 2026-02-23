import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api-keys')({
  head: () => ({
    meta: seo('apiKeys'),
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getCurrentMemberContext, {
        organizationId: params.id,
      }),
    );
  },
  component: ApiKeysSettingsPage,
});

function ApiKeysSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const { isLoading: isMemberLoading } = useCurrentMemberContext(
    organizationId,
    isAuthLoading || !isAuthenticated,
  );
  const { data: apiKeys } = useApiKeys(organizationId);

  if (
    !isAuthLoading &&
    !isMemberLoading &&
    ability.cannot('read', 'developerSettings')
  ) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  return <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />;
}
