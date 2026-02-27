import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { KnowledgeNavigation } from '@/app/features/knowledge/components/knowledge-navigation';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/_knowledge')({
  head: () => ({
    meta: seo('knowledge'),
  }),
  component: KnowledgeLayout,
});

function KnowledgeLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('knowledge');
  const { t: tAccess } = useT('accessDenied');

  const ability = useAbility();

  if (ability.cannot('write', 'knowledgeWrite')) {
    return <AccessDenied message={tAccess('knowledge')} />;
  }

  return (
    <PageLayout
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <KnowledgeNavigation organizationId={organizationId} />
        </>
      }
      organizationId={organizationId}
    >
      <ContentArea className="min-h-0 flex-1 py-4">
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
