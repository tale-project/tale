import { createFileRoute, Outlet } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { StickyHeader } from '@/app/components/layout/sticky-header';
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
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <KnowledgeNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="p-4">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </div>
  );
}
