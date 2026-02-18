import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ApiKeysEmptyState } from '@/app/features/settings/api-keys/components/api-keys-empty-state';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { ApiKeysTableSkeleton } from '@/app/features/settings/api-keys/components/api-keys-table-skeleton';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
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

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const { data: apiKeys, isLoading } = useApiKeys(organizationId);

  if (isMemberLoading || isLoading) {
    return <ApiKeysTableSkeleton organizationId={organizationId} />;
  }

  if (!memberContext) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  const userRole = memberContext.role.toLowerCase();
  const hasAccess = userRole === 'admin' || userRole === 'developer';

  if (!hasAccess) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  if (!isLoading && (!apiKeys || apiKeys.length === 0)) {
    return <ApiKeysEmptyState organizationId={organizationId} />;
  }

  return <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />;
}
