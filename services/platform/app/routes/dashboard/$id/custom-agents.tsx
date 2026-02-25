import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/custom-agents')({
  head: () => ({
    meta: seo('customAgents'),
  }),
  component: CustomAgentsLayout,
});

function CustomAgentsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');

  const ability = useAbility();

  const isDetailPage = useMatch({
    from: '/dashboard/$id/custom-agents/$agentId',
    shouldThrow: false,
  });

  if (ability.cannot('write', 'customAgents')) {
    return <AccessDenied message={tAccessDenied('customAgents')} />;
  }

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isDetailPage ? (
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('customAgents.title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        ) : undefined
      }
    >
      <Outlet />
    </PageLayout>
  );
}
