import { convexQuery } from '@convex-dev/react-query';
import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useMemo } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@/app/components/ui/editor';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export const Route = createFileRoute('/dashboard/$id/projects/$projectId')({
  loader: ({ context, params }) => {
    // Warm the gating project query so the detail header/content paint without
    // a skeleton — also runs on the projects list's row-hover preload.
    void context.queryClient.prefetchQuery(
      convexQuery(api.projects.queries.getProject, {
        projectId: asProjectId(params.projectId),
      }),
    );
  },
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { id: organizationId, projectId } = Route.useParams();
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { t: tTasks } = useT('tasks');
  const { t: tSecrets } = useT('projectSecrets');
  const { t: tDiscussions } = useT('discussions');

  const { project, isLoading } = useProject(asProjectId(projectId));

  // Memoize the tabs array — `TabNavigation` feeds it through a chain of
  // memos that bottom out at a `ResizeObserver` effect; a fresh array every
  // render kicks that effect (and the observer it owns) every render.
  const tabs = useMemo<TabNavigationItem[]>(
    () => [
      {
        label: t('navigation.overview'),
        href: `/dashboard/${organizationId}/projects/${projectId}`,
        matchMode: 'exact',
      },
      {
        label: t('navigation.threads'),
        href: `/dashboard/${organizationId}/projects/${projectId}/threads`,
        matchMode: 'exact',
      },
      {
        label: tDiscussions('title'),
        href: `/dashboard/${organizationId}/projects/${projectId}/discussions`,
        matchMode: 'exact',
      },
      {
        label: tTasks('title'),
        href: `/dashboard/${organizationId}/projects/${projectId}/tasks`,
        matchMode: 'exact',
        // The per-view pages (/tasks/board, /tasks/list — prefix-matched via
        // the bare /tasks entry) and the project metrics page are sub-views
        // of Tasks, so keep the tab highlighted there.
        additionalActivePaths: [
          `/dashboard/${organizationId}/projects/${projectId}/tasks`,
          `/dashboard/${organizationId}/projects/${projectId}/metrics`,
        ],
      },
      {
        label: t('navigation.instructions'),
        href: `/dashboard/${organizationId}/projects/${projectId}/instructions`,
        matchMode: 'exact',
      },
      {
        label: t('navigation.files'),
        href: `/dashboard/${organizationId}/projects/${projectId}/files`,
        matchMode: 'exact',
      },
      {
        label: t('navigation.agents'),
        href: `/dashboard/${organizationId}/projects/${projectId}/agents`,
        matchMode: 'exact',
      },
      {
        label: tSecrets('title'),
        href: `/dashboard/${organizationId}/projects/${projectId}/secrets`,
        matchMode: 'exact',
      },
      // U8: Settings tab merged into Overview. Identity edit + Sharing live
      // in the Overview header now; Archive/Delete are in the 3-dot row menu
      // on the projects list page.
    ],
    [t, tTasks, tSecrets, tDiscussions, organizationId, projectId],
  );

  if (!isLoading && !project) {
    return (
      <PageLayout>
        <ContentArea variant="narrow" className="py-6">
          <Text variant="muted">{t('errors.PROJECT_NOT_FOUND')}</Text>
        </ContentArea>
      </PageLayout>
    );
  }

  return (
    <ActiveEditorProvider>
      <PageLayout
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <Heading level={1} size="base" truncate>
                <Link
                  to="/dashboard/$id/projects"
                  params={{ id: organizationId }}
                  className={cn(
                    'hidden md:inline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    'text-muted-foreground cursor-pointer',
                  )}
                >
                  {t('title')}&nbsp;&nbsp;
                </Link>
                <span className="text-foreground inline-flex items-center gap-2">
                  <span className="hidden md:inline">/&nbsp;</span>
                  <Skeletonize loading={isLoading} label={t('title')}>
                    {project ? (
                      project.name
                    ) : (
                      <SkeletonBox>
                        <span className="inline-block h-4 w-32 align-middle" />
                      </SkeletonBox>
                    )}
                  </Skeletonize>
                </span>
              </Heading>
            </AdaptiveHeaderRoot>
            <TabNavigation
              items={tabs}
              standalone={false}
              ariaLabel={tCommon('aria.projectsNavigation')}
            >
              <ProjectEditorActionsSlot />
            </TabNavigation>
          </>
        }
      >
        {/* Fill the layout's content height so full-height tabs (the
            Discussions thread view's sticky-bottom composer, like the main
            chat) anchor correctly instead of collapsing to content height.
            Auto-height tabs (ContentArea-based) are unaffected — they size to
            content and top-align as before. */}
        <Skeletonize
          loading={isLoading}
          label={t('title')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Outlet />
        </Skeletonize>
      </PageLayout>
    </ActiveEditorProvider>
  );
}

/**
 * Reads the active child controller (Overview identity-edit form,
 * Instructions textarea) and renders the unified Save/Discard cluster in the
 * tab strip. Tabs without forms (Files, Threads, Agents) clear the active
 * editor and the cluster doesn't render.
 */
function ProjectEditorActionsSlot() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="project" />;
}
