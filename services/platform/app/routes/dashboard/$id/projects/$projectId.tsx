import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@/app/components/layout/header-breadcrumbs';
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
import { useAutomations } from '@/app/features/automations/hooks/queries';
import {
  isProjectTasksPath,
  ProjectBreadcrumbSwitcher,
} from '@/app/features/projects/components/project-breadcrumb-switcher';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

// Stable identity: the tabs memo keys on this, and a fresh array every render
// would kick TabNavigation's ResizeObserver effect each time.
const EMPTY_VIEW_TABS: TabNavigationItem[] = [];

export const Route = createFileRoute('/dashboard/$id/projects/$projectId')({
  loader: async ({
    context,
    params,
  }): Promise<{ projectName: string | undefined }> => {
    // Warm the gating project query so the detail header/content paint without
    // a skeleton — also runs on the projects list's row-hover preload, so this
    // resolves from cache (no added latency) on that common path. Awaited
    // (rather than fire-and-forget) so the resolved name reaches `head()`
    // below for the document title (#2647); a failed fetch falls back to the
    // generic `metadata.project` title below — the component's own
    // `useProject` call still surfaces the real not-found/error state.
    const project = await ensureAdaptedQueryData(
      context.queryClient,
      api.projects.queries.getProject,
      {
        projectId: asProjectId(params.projectId),
        organizationId: params.id,
      },
    ).catch((error: unknown) => {
      console.warn('Failed to load project for document title', error);
      return null;
    });
    return { projectName: project?.name };
  },
  head: ({ loaderData }) => ({
    meta: seo('project', loaderData?.projectName),
  }),
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { id: organizationId, projectId } = Route.useParams();
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { t: tTasks } = useT('tasks');
  const { t: tSecrets } = useT('projectSecrets');
  const { t: tAutomations } = useT('automations');
  const location = useLocation();
  const navigate = useNavigate();

  // Project-scoped automation DETAIL routes live under the AUTOMATIONS chrome
  // (`AutomationDetailShell` — "Automations / <name>" breadcrumb + its own
  // tab strip), not inside the project shell — so those child routes render
  // bare, exactly like the agents layout skips its header on detail pages.
  // The project-nav Automations tab opens the bound-automations LIST; detail
  // keeps this bare-outlet match so only the list stays under project chrome.
  const isAutomationDetail = useMatch({
    from: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
    shouldThrow: false,
  });

  const { project, isLoading } = useProject(asProjectId(projectId));

  // The Automations tab is conditional: a project with nothing bound gets no
  // tab rather than one that opens an empty list. `listAutomations` scoped to
  // a project is a small indexed read, and the tab strip already re-renders on
  // `project`, so this costs one extra subscription on the shell.
  const projectAutomations = useAutomations(
    organizationId,
    asProjectId(projectId),
  );
  const hasAutomations = (projectAutomations.data?.length ?? 0) > 0;

  // Bound automations used to contribute one first-class tab per bundled view
  // (the operator surfaces, e.g. a desk automation). The new engine has no views
  // subsystem yet — when one lands (#2709) its tabs derive here; until then
  // the list is deliberately empty and the views route is retired.
  const viewTabs = EMPTY_VIEW_TABS;

  const allProjectsMode =
    (location.search as { projects?: unknown }).projects === 'all';
  const onTasksPath = isProjectTasksPath(location.pathname, projectId);

  // Stale `?projects=all` on a non-Tasks child (bookmark / manual URL) — send
  // the operator to the Tasks board so the disabled sibling tabs stay coherent.
  useEffect(() => {
    if (!allProjectsMode || onTasksPath || isAutomationDetail) return;
    void navigate({
      to: '/dashboard/$id/projects/$projectId/tasks/board',
      params: { id: organizationId, projectId },
      search: { projects: 'all' },
      replace: true,
    });
  }, [
    allProjectsMode,
    onTasksPath,
    isAutomationDetail,
    navigate,
    organizationId,
    projectId,
  ]);

  // Memoize the tabs array — `TabNavigation` feeds it through a chain of
  // memos that bottom out at a `ResizeObserver` effect; a fresh array every
  // render kicks that effect (and the observer it owns) every render.
  const tabs = useMemo<TabNavigationItem[]>(
    () => [
      {
        label: tTasks('title'),
        href: `/dashboard/${organizationId}/projects/${projectId}/tasks`,
        matchMode: 'exact',
        // The per-view pages (/tasks/board, /tasks/list — prefix-matched via
        // the bare /tasks entry) and the project metrics page are sub-views
        // of Tasks, so keep the tab highlighted there. Metrics stays
        // project-scoped — when All projects is on, that path is redirected
        // away, so the highlight only covers board/list.
        additionalActivePaths: [
          `/dashboard/${organizationId}/projects/${projectId}/tasks`,
          ...(allProjectsMode
            ? []
            : [`/dashboard/${organizationId}/projects/${projectId}/metrics`]),
        ],
        search: allProjectsMode ? { projects: 'all' } : undefined,
      },
      {
        label: t('navigation.overview'),
        href: `/dashboard/${organizationId}/projects/${projectId}/overview`,
        matchMode: 'exact',
        disabled: allProjectsMode,
      },
      {
        label: t('navigation.threads'),
        href: `/dashboard/${organizationId}/projects/${projectId}/threads`,
        matchMode: 'exact',
        disabled: allProjectsMode,
      },
      {
        label: t('navigation.files'),
        href: `/dashboard/${organizationId}/projects/${projectId}/files`,
        matchMode: 'exact',
        disabled: allProjectsMode,
      },
      // Bound automations' views as first-class tabs (1 view = 1 tab) —
      // the operator surfaces, ahead of the management tabs below.
      ...viewTabs.map((tab) =>
        allProjectsMode ? { ...tab, disabled: true } : tab,
      ),
      // Automations bound to THIS project. Shown only when there are any:
      // tasks remain the day-to-day automation interface (status verbs run the
      // workflow, approvals and input files live in the task modal), so a
      // project with nothing bound has no reason to carry the tab. Once
      // something is bound, the operator needs a way in that is not a detour
      // through the org Automations page.
      ...(hasAutomations
        ? [
            {
              label: tAutomations('title'),
              href: `/dashboard/${organizationId}/projects/${projectId}/automations`,
              matchMode: 'exact' as const,
              disabled: allProjectsMode,
            },
          ]
        : []),
      {
        label: t('navigation.agents'),
        href: `/dashboard/${organizationId}/projects/${projectId}/agents`,
        matchMode: 'exact',
        disabled: allProjectsMode,
      },
      // Secrets are administer-only data — even the secret *names* are
      // sensitive (per the query doc comment). Hide the tab from non-admin
      // readers so they never land on the misleading empty state with a dead
      // Add-secret button; the backend still enforces access by throwing a
      // structured `ConvexError({ code: 'PROJECT_FORBIDDEN' })`.
      ...(project?.canAdminister
        ? [
            {
              label: tSecrets('title'),
              href: `/dashboard/${organizationId}/projects/${projectId}/secrets`,
              matchMode: 'exact' as const,
              disabled: allProjectsMode,
            },
          ]
        : []),
      // U8: Settings tab merged into Overview. Identity edit + Sharing live
      // in the Overview header now; Archive/Delete are in the 3-dot row menu
      // on the projects list page.
    ],
    [
      t,
      tTasks,
      tSecrets,
      tAutomations,
      organizationId,
      projectId,
      project?.canAdminister,
      hasAutomations,
      viewTabs,
      allProjectsMode,
    ],
  );

  // Bare pass-through for the automation chrome (see the comment above the
  // `useMatch`); the automation page owns its own loading/not-found states.
  if (isAutomationDetail) {
    return <Outlet />;
  }

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
              <HeaderBreadcrumbs
                ariaLabel={tCommon('aria.breadcrumb')}
                crumbs={[
                  {
                    key: 'projects',
                    content: (
                      <Link
                        to="/dashboard/$id/projects"
                        params={{ id: organizationId }}
                        activeOptions={{ exact: true }}
                        className={HEADER_CRUMB_LINK_CLASS}
                      >
                        {t('title')}
                      </Link>
                    ),
                  },
                ]}
                leaf={
                  <Skeletonize
                    loading={isLoading}
                    label={t('title')}
                    className="contents"
                  >
                    {project ? (
                      <ProjectBreadcrumbSwitcher
                        organizationId={organizationId}
                        projectId={asProjectId(projectId)}
                        projectName={project.name}
                      />
                    ) : (
                      <SkeletonBox>
                        <span className="inline-block h-4 w-32 align-middle" />
                      </SkeletonBox>
                    )}
                  </Skeletonize>
                }
              />
            </AdaptiveHeaderRoot>
            <TabNavigation
              items={tabs}
              standalone={false}
              // View tabs grow with every bound automation — fold the
              // overflow into a More menu instead of a hidden scroll tail.
              overflow="menu"
              ariaLabel={tCommon('aria.projectsNavigation')}
            >
              <ProjectEditorActionsSlot />
            </TabNavigation>
          </>
        }
      >
        {/* Fill the layout's content height so full-height tabs (thread
            views with a sticky-bottom composer, like the main chat) anchor
            correctly instead of collapsing to content height. Auto-height
            tabs (ContentArea-based) are unaffected — they size to content
            and top-align as before. */}
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
