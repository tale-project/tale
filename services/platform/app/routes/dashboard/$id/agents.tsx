import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
} from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents')({
  head: () => ({
    meta: seo('agents'),
  }),
  component: AgentsLayout,
});

function AgentsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tOrganigram } = useT('organigram');
  const { t: tWorkforce } = useT('workforce');
  const { t: tAccessDenied } = useT('accessDenied');
  const navigate = useNavigate();

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const isDetailPage = useMatch({
    from: '/dashboard/$id/agents/$agentId',
    shouldThrow: false,
  });

  // Organigram and Metrics are sibling pages opened from the list's own
  // buttons — same breadcrumb-in-header navigation as the automations
  // Metrics page: "Agents › Organigram" with the parent clickable.
  const isOrganigram = useMatch({
    from: '/dashboard/$id/agents/organigram',
    shouldThrow: false,
  });
  const isMetrics = useMatch({
    from: '/dashboard/$id/agents/metrics',
    shouldThrow: false,
  });
  const breadcrumbLeaf = isOrganigram
    ? tOrganigram('title')
    : isMetrics
      ? tWorkforce('title')
      : null;

  // Access is only knowable once the ability has loaded. Until then render the
  // SAME PageLayout chrome (the header doesn't depend on the ability) so it
  // never pops in — only the Outlet is held back. The detail route owns its own
  // header, so this layout shows none on the detail page in either state.
  if (!abilityLoading && ability.cannot('write', 'agents')) {
    return <AccessDenied message={tAccessDenied('agents')} />;
  }

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isDetailPage ? (
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>
              {breadcrumbLeaf ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: '/dashboard/$id/agents',
                        params: { id: organizationId },
                      })
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('agents.title')}
                  </button>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  <span>{breadcrumbLeaf}</span>
                </span>
              ) : (
                t('agents.title')
              )}
            </AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        ) : undefined
      }
    >
      {!abilityLoading && <Outlet />}
    </PageLayout>
  );
}
