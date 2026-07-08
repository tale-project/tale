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
import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@/app/components/layout/header-breadcrumbs';
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
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tCommon } = useT('common');

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
          <AdaptiveHeaderRoot showBorder standalone={false}>
            {segments.length > 0 ? (
              /* Folder path segments render RAW (verbatim slugs) — table
                 folder navigation shows paths as-is, exactly as the
                 documents table does. */
              <HeaderBreadcrumbs
                ariaLabel={tCommon('aria.breadcrumb')}
                crumbs={[
                  {
                    key: 'agents',
                    content: (
                      <button
                        type="button"
                        onClick={() => goToFolder('')}
                        className={HEADER_CRUMB_LINK_CLASS}
                      >
                        {t('agents.title')}
                      </button>
                    ),
                  },
                  ...segments.slice(0, -1).map((segment, i) => {
                    const path = segments.slice(0, i + 1).join('/');
                    return {
                      key: `folder:${path}`,
                      content: (
                        <button
                          type="button"
                          onClick={() => goToFolder(path)}
                          className={HEADER_CRUMB_LINK_CLASS}
                        >
                          {segment}
                        </button>
                      ),
                    };
                  }),
                ]}
                leaf={segments.at(-1)}
              />
            ) : (
              <AdaptiveHeaderTitle>{t('agents.title')}</AdaptiveHeaderTitle>
            )}
          </AdaptiveHeaderRoot>
        ) : undefined
      }
    >
      {!abilityLoading && <Outlet />}
    </PageLayout>
  );
}
