import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
} from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { folderLabel } from '@/app/features/agents/utils/folder-label';
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
  const { t: tAccessDenied } = useT('accessDenied');
  // Bound to the agentCatalog namespace: `folderLabel` localizes each path
  // segment to its folder display name (#2348), never the raw slug.
  const { t: tCatalog } = useT('agentCatalog');

  const navigate = useNavigate();
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // The agent detail page owns its own header; the layout shows no tabs there.
  const isDetailPage = useMatch({
    from: '/dashboard/$id/agents/$agentId',
    shouldThrow: false,
  });

  // The list (now the agents index — agents are installed via automations or
  // the create/upload menu, so there's no sibling Catalog tab anymore) shows a
  // file-system breadcrumb of clickable folder path segments.
  const listMatch = useMatch({
    from: '/dashboard/$id/agents/',
    shouldThrow: false,
  });
  const currentFolder = listMatch?.search?.folder ?? '';
  const segments = currentFolder ? currentFolder.split('/') : [];

  const goToFolder = (folder: string) =>
    void navigate({
      to: '/dashboard/$id/agents',
      params: { id: organizationId },
      search: folder ? { folder } : {},
    });

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
              {segments.length > 0 ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => goToFolder('')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('agents.title')}
                  </button>
                  {segments.map((segment, i) => {
                    const path = segments.slice(0, i + 1).join('/');
                    const isLast = i === segments.length - 1;
                    return (
                      <span key={path} className="flex items-center gap-1">
                        <span className="text-muted-foreground shrink-0">
                          /
                        </span>
                        {isLast ? (
                          <span>{folderLabel(tCatalog, segment)}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => goToFolder(path)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {folderLabel(tCatalog, segment)}
                          </button>
                        )}
                      </span>
                    );
                  })}
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
