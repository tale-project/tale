import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { PageLayout } from '@tale/ui/page-layout';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  KnowledgeNavigation,
  KnowledgePanel,
  useKnowledgePageTitle,
} from '@/app/features/knowledge/components/knowledge-navigation';
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
  const { t: tAccess } = useT('accessDenied');
  const pageTitle = useKnowledgePageTitle(organizationId);
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

  // The same frame as Home and Settings: Knowledge's panel runs the full
  // height beside the page, and the page header names the open page. A phone
  // has no panel; it keeps the pages as a tab strip under the header.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row">
      <KnowledgePanel organizationId={organizationId} />
      <PageLayout
        className="min-w-0 flex-1"
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} showBorder>
              <AdaptiveHeaderTitle>{pageTitle}</AdaptiveHeaderTitle>
            </AdaptiveHeaderRoot>
            <div className="md:hidden">
              <KnowledgeNavigation organizationId={organizationId} />
            </div>
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
    </div>
  );
}
