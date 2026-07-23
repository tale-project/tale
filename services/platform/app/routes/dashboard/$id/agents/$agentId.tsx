import { convexQuery } from '@convex-dev/react-query';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@/app/components/layout/header-breadcrumbs';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { AgentBreadcrumbSwitcher } from '@/app/features/agents/components/agent-breadcrumb-switcher';
import { AgentNavigation } from '@/app/features/agents/components/agent-navigation';
import {
  useListAgents,
  useReadAgent,
} from '@/app/features/agents/hooks/queries';
import { AgentConfigProvider } from '@/app/features/agents/hooks/use-agent-config-context';
import { toConfigurableAgent } from '@/app/features/agents/utils/agent-list-item';
import { configKeys } from '@/app/hooks/config-query-keys';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId')({
  head: () => ({
    meta: seo('agent'),
  }),
  loader: ({ context, params }) => {
    const { id: organizationId, agentId: agentName } = params;
    // This warm calls the Convex action directly, bypassing the auth gate that
    // useActionQuery applies to useReadAgent. On a cold load / reload the loader
    // runs before the WebSocket auth handshake completes, so firing it then ran
    // the action unauthenticated → a thrown `UNAUTHENTICATED` ConvexError logged
    // as a console Server Error on every cold entry. Gate on the same signal the
    // app's authed queries use — the getCurrentUser auth probe having resolved a
    // user into the shared cache — so the row-hover preload (already in-app and
    // authenticated) still warms the config, while a cold load defers to the
    // auth-gated useReadAgent hook, which fetches the moment auth is ready.
    const isAuthenticated = !!context.queryClient.getQueryData(
      convexQuery(api.users.queries.getCurrentUser, {}).queryKey,
    );
    if (!isAuthenticated) return;
    // Warm the agent config (filesystem-backed action) so the detail paints
    // without a skeleton — also runs on the agents list's row-hover preload.
    // Mirrors useReadAgent's key + args so the component reads it warm.
    void context.queryClient.prefetchQuery({
      queryKey: configKeys.detail('agents', organizationId, agentName),
      queryFn: () =>
        context.convexQueryClient.convexClient.action(
          api.agents.file_actions.readAgent,
          { organizationId, agentName },
        ),
      staleTime: Infinity,
      retry: false,
    });
  },
  component: AgentDetailLayout,
});

function AgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { data, isLoading, error, refetch } = useReadAgent(
    organizationId,
    agentId,
  );
  const agentConfig = data?.ok ? data.config : null;
  // A load failure (bad slug, missing or corrupt file) renders a friendly
  // not-found message — never the raw result message, which leaks the internal
  // `<slug>.json` storage path (e.g. "File not found: does-not-exist.json").
  const loadFailed = data ? !data.ok : Boolean(error);
  const { i18n: i18nCtx } = useTranslation();
  const resolvedDisplayName = useMemo(
    () =>
      agentConfig
        ? resolveAgentLocale(agentConfig, i18nCtx.language).displayName
        : '',
    [agentConfig, i18nCtx.language],
  );
  // The agent's folder (e.g. `github`) is metadata on the roster row, NOT
  // part of the slug — a global agent at `agents/github/issue-triager` still
  // has the flat slug `issue-triager`. So resolve the folder from the
  // agent list (already cached from the List view) and break it into clickable
  // segments: "Agents / GitHub / <Name>" jumps back to the rest of the
  // folder. No folder (root agent) → [] → breadcrumb unchanged.
  const { agents: rawAgents } = useListAgents(organizationId);
  const folderSegments = useMemo(() => {
    for (const raw of rawAgents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (agent?.name === agentId) {
        return agent.folder ? agent.folder.split('/') : [];
      }
    }
    return [];
  }, [rawAgents, agentId]);

  // Terminal load failure — not a loading state, so no skeleton here.
  if (!isLoading && (loadFailed || !agentConfig)) {
    return (
      <PageLayout>
        <ContentArea className="mx-auto max-w-3xl px-4 pt-6">
          <Text variant="muted">{t('agents.agentNotFound')}</Text>
        </ContentArea>
      </PageLayout>
    );
  }

  // Breadcrumb header — identical structure in both states; only the agent
  // display name is dynamic, so it is the sole masked leaf. The
  // tab-navigation row and the page body below differ between states because
  // their loaded forms (`AgentNavigation`, the routed `Outlet`) both consume
  // `AgentConfigProvider` and therefore cannot mount until the config loads.
  // `activeOptions={{ exact: true }}` stops TanStack's `<Link>` from
  // auto-tagging the parent crumb with `aria-current="page"` just because
  // this detail route is nested under `/agents`. Folder crumbs render the RAW
  // path segment — table folder navigation shows paths verbatim, exactly as
  // the documents table does.
  const breadcrumb = (
    <AdaptiveHeaderRoot standalone={false} className="gap-2">
      <HeaderBreadcrumbs
        ariaLabel={tCommon('aria.breadcrumb')}
        showImmediateParentOnMobile
        crumbs={[
          {
            key: 'agents',
            content: (
              <Link
                to="/dashboard/$id/agents"
                params={{ id: organizationId }}
                activeOptions={{ exact: true }}
                className={HEADER_CRUMB_LINK_CLASS}
              >
                {t('agents.title')}
              </Link>
            ),
          },
          ...folderSegments.map((segment, i) => {
            const path = folderSegments.slice(0, i + 1).join('/');
            return {
              key: `folder:${path}`,
              content: (
                <Link
                  to="/dashboard/$id/agents"
                  params={{ id: organizationId }}
                  search={{ folder: path }}
                  className={HEADER_CRUMB_LINK_CLASS}
                >
                  {segment}
                </Link>
              ),
            };
          }),
        ]}
        leaf={
          /* `contents` keeps the Skeletonize wrapper from adding a block box
             so the truncating heading stays one line. */
          <Skeletonize
            loading={isLoading}
            label={t('agents.title')}
            className="contents"
          >
            <SkeletonBox>
              {resolvedDisplayName ? (
                <AgentBreadcrumbSwitcher
                  organizationId={organizationId}
                  agentId={agentId}
                  displayName={resolvedDisplayName}
                />
              ) : (
                <span className="inline-block h-4 w-32 align-middle" />
              )}
            </SkeletonBox>
          </Skeletonize>
        }
      />
    </AdaptiveHeaderRoot>
  );

  // The body + nav-actions need the agent config to mount; while it loads we
  // render placeholder leaves wrapped in `<Skeletonize loading>` in their
  // place (real `PageLayout`/`ContentArea`/header chrome stays mounted).
  if (isLoading || !agentConfig) {
    return (
      <PageLayout
        header={
          <>
            {breadcrumb}
            <TabNavigation
              items={
                [
                  {
                    label: t('agents.navigation.general'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.instructionsModel'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/instructions`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.tools'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/tools`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.skills'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/skills`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.knowledge'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/knowledge`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.conversationStarters'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/conversation-starters`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.webhook'),
                    href: `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}/webhook`,
                    matchMode: 'exact',
                  },
                ] satisfies TabNavigationItem[]
              }
              standalone={false}
              ariaLabel={tCommon('aria.agentsNavigation')}
            >
              {/* `ml-auto` on the Skeletonize wrapper itself — its rendered
                  <div> is the flex child of the tab nav, so the alignment must
                  live there (an `ml-auto` on an inner block does nothing). */}
              <Skeletonize
                loading
                label={t('agents.title')}
                className="ml-auto flex items-center gap-2"
              >
                <SkeletonBox>
                  <div className="h-8 w-14 rounded-md" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="h-8 w-20 rounded-md" />
                </SkeletonBox>
              </Skeletonize>
            </TabNavigation>
          </>
        }
      >
        <Skeletonize loading label={t('agents.title')}>
          {/* Same width as the loaded tabs (#2567) so the swap doesn't jump. */}
          <ContentArea className="mx-auto max-w-3xl px-4 pt-4">
            <Stack gap={6}>
              <Stack gap={1}>
                <SkeletonText lines={1} />
                <SkeletonText lines={1} />
              </Stack>
              <Stack gap={3}>
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-9 w-full" />
                  </SkeletonBox>
                </Stack>
                <SkeletonText lines={1} />
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-9 w-full" />
                  </SkeletonBox>
                </Stack>
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-16 w-full" />
                  </SkeletonBox>
                </Stack>
              </Stack>
            </Stack>
          </ContentArea>
        </Skeletonize>
      </PageLayout>
    );
  }

  return (
    <AgentConfigProvider agentName={agentId} initialConfig={agentConfig}>
      {/* Active-editor registry: side-table editors (the Environment tab's
          env/secret list) register here and AgentNavigation composes them into
          the ONE header Save/Discard cluster — no per-tab save buttons. */}
      <ActiveEditorProvider>
        <PageLayout
          header={
            <>
              {breadcrumb}
              <AgentNavigation
                organizationId={organizationId}
                agentId={agentId}
                onSaved={() => {
                  void refetch();
                }}
              />
            </>
          }
          organizationId={organizationId}
          className="relative"
        >
          <Outlet />
        </PageLayout>
      </ActiveEditorProvider>
    </AgentConfigProvider>
  );
}
