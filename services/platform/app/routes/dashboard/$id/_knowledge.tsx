import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { KnowledgeNavigation } from '@/app/features/knowledge/components/knowledge-navigation';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
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
  const { pathname } = useLocation();

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // Access is only knowable once the ability has loaded. Until then render the
  // SAME chrome (header title + knowledge nav, neither of which depends on the
  // ability) so it never pops in — only the content area is held empty. The
  // child tables own their own loading shape once the Outlet mounts.
  if (!abilityLoading && ability.cannot('read', 'knowledgeRead')) {
    return <AccessDenied message={tAccess('knowledge')} />;
  }

  // The section's name over its pages as a tab strip, on every width — the
  // shape of a project's detail. The strip under the title row draws the
  // header's one divider, so the row carries none of its own.
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
      <ContentArea
        key={pathname}
        variant="list"
        className="animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      >
        {!abilityLoading && <Outlet />}
      </ContentArea>
    </PageLayout>
  );
}
