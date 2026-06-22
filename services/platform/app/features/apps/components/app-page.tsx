'use client';

/** An app's page. Gates on install state and scope:
 *
 *  - NOT installed → an Install prompt (project-scoped apps route through the
 *    wizard to pick the first project).
 *  - ORG route, project-scoped + installed → the MEMBERSHIP HUB: org readiness +
 *    the list of bound projects (open / remove each) + "Add to a project" +
 *    Reinstall/Uninstall. It renders NO app views and NEVER auto-redirects, so it
 *    behaves identically whether the app is in 0, 1, or N projects.
 *  - ORG route, org-scoped + installed → the app's views.
 *  - PROJECT route, this project bound → the app's views scoped to the URL
 *    project; lifecycle here is "Remove from this project".
 *  - PROJECT route, this project NOT bound → an "Add to this project" prompt.
 *
 *  A non-blocking readiness checklist (missing integration credentials / agent
 *  setup / broken install) rides above the views/hub; the shell stays usable. */
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAppAgentReadiness } from '../hooks/use-app-agent-readiness';
import { resolvePackLabels } from '../hooks/use-app-pack-labels';
import {
  type AppSummary,
  type AppTabDoc,
  type AppViewDoc,
  useApps,
} from '../hooks/use-apps';
import {
  useAppBindings,
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';
import { AppView } from '../registry/app-view';
import { AppRuntimeProvider, resolvePackLabel } from '../runtime/app-runtime';
import { ResourceDetailProvider } from '../runtime/resource-detail';
import { AppLifecycleActions } from './app-lifecycle-actions';
import { AppInstallWizard } from './install-wizard/app-install-wizard';

function ReadinessChecklist({
  organizationId,
  appSlug,
  status,
  blockedIntegrations,
  blockedAgents,
  onConnect,
  onSetupAgents,
}: {
  organizationId: string;
  appSlug: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  /** Bundled agents not yet ready (no provider key / missing secrets). */
  blockedAgents: { agentSlug: string; displayName: string }[];
  /** Open the inline connect wizard for one required integration. */
  onConnect: (slug: string) => void;
  /** Open the inline wizard to finish the bundled agents' setup. */
  onSetupAgents: () => void;
}) {
  const { t } = useT('apps');
  const { reinstall, isPending } = useAppInstallActions(organizationId);

  if (
    status === 'active' &&
    blockedIntegrations.length === 0 &&
    blockedAgents.length === 0
  ) {
    return null;
  }

  return (
    <Alert variant="warning" title={t('readiness.title')}>
      <VStack gap={2} className="mt-1">
        {status === 'broken' && (
          <HStack gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.broken')}
            </Text>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => void reinstall(appSlug)}
            >
              {t('install.reinstall')}
            </Button>
          </HStack>
        )}
        {blockedIntegrations.map((slug) => (
          <HStack key={slug} gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.connect', { integration: slug })}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onConnect(slug)}
            >
              {t('readiness.connectButton')}
            </Button>
          </HStack>
        ))}
        {blockedAgents.map((agent) => (
          <HStack
            key={agent.agentSlug}
            gap={3}
            className="items-center justify-between"
          >
            <Text variant="muted" className="text-sm">
              {t('readiness.agentNeedsSetup', { agent: agent.displayName })}
            </Text>
            <Button size="sm" variant="secondary" onClick={onSetupAgents}>
              {t('readiness.setupButton')}
            </Button>
          </HStack>
        ))}
      </VStack>
    </Alert>
  );
}

/**
 * The non-blocking readiness section (checklist + inline connect/agent-setup
 * wizards + the open-time integrity re-check). Shared by the per-project views
 * and the org-level membership hub — readiness is org-level, so it shows in both.
 */
function ReadinessSection({
  organizationId,
  appSlug,
  app,
  status,
  blockedIntegrations,
  projectId,
}: {
  organizationId: string;
  appSlug: string;
  app: AppSummary;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  projectId?: string;
}) {
  const { verify } = useAppInstallActions(organizationId);
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  const [agentSetupOpen, setAgentSetupOpen] = useState(false);
  const { agents: agentReadiness, refetch: refetchAgentReadiness } =
    useAppAgentReadiness(organizationId, appSlug, true);
  const blockedAgents = useMemo(
    () =>
      agentReadiness
        .filter((a) => !a.ready)
        .map((a) => ({ agentSlug: a.agentSlug, displayName: a.displayName })),
    [agentReadiness],
  );

  // Re-check that the copied files still exist when an installed app opens.
  // Guard by appSlug so it runs once per app (verify's identity is unstable and
  // it mutates the install status, which would otherwise re-fire in a loop).
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (verifiedRef.current !== appSlug) {
      verifiedRef.current = appSlug;
      void verify(appSlug);
    }
  }, [appSlug, verify]);

  return (
    <>
      <ReadinessChecklist
        organizationId={organizationId}
        appSlug={appSlug}
        status={status}
        blockedIntegrations={blockedIntegrations}
        blockedAgents={blockedAgents}
        onConnect={setConnectSlug}
        onSetupAgents={() => setAgentSetupOpen(true)}
      />
      {connectSlug && (
        <AppInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) setConnectSlug(null);
          }}
          organizationId={organizationId}
          appSlug={appSlug}
          appName={app.name}
          scope={app.scope}
          projectId={projectId}
          requiredIntegrations={app.requiredIntegrations}
          mode="connect-only"
          initialSlugs={[connectSlug]}
        />
      )}
      {agentSetupOpen && (
        <AppInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) {
              setAgentSetupOpen(false);
              // Action-query readiness isn't reactive — refetch so the
              // checklist reflects the secrets/mode just configured.
              refetchAgentReadiness();
            }
          }}
          organizationId={organizationId}
          appSlug={appSlug}
          appName={app.name}
          scope={app.scope}
          projectId={projectId}
          requiredIntegrations={app.requiredIntegrations}
          mode="connect-only"
          initialSlugs={[]}
        />
      )}
    </>
  );
}

/** A tab's content: side-by-side columns, or a single Puck Data region. */
function TabContent({ tab }: { tab: AppTabDoc }) {
  if (tab.columns && tab.columns.length > 0) {
    return (
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {tab.columns.map((col, i) => (
          <AppView key={i} data={col} />
        ))}
      </div>
    );
  }
  return <AppView data={tab.data} />;
}

/** A view body: the tabbed shell (navigated) or a flat Puck Data document. Tab
 *  labels are pack-catalog `$label:` references (or literals), resolved here. */
function ViewBody({
  view,
  labels,
}: {
  view: AppViewDoc;
  labels: Record<string, string>;
}) {
  if (view.tabs && view.tabs.length > 0) {
    return (
      <Tabs
        variant="underline"
        defaultValue={view.tabs[0].id}
        items={view.tabs.map((tab) => ({
          value: tab.id,
          label: resolvePackLabel(tab.label, labels) ?? tab.label,
          content: <TabContent tab={tab} />,
        }))}
      />
    );
  }
  return <AppView data={view.data} />;
}

/**
 * The installed app's views, scoped to `projectId` when rendered under a project
 * route (org-scoped apps pass none). Lifecycle context follows: a bound project
 * shows "Remove from this project"; the org route shows Reinstall/Uninstall.
 */
function InstalledAppBody({
  organizationId,
  appSlug,
  app,
  projectId,
  status,
  blockedIntegrations,
  labels,
  lifecycleContext,
}: {
  organizationId: string;
  appSlug: string;
  app: AppSummary;
  projectId?: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  labels: Record<string, string>;
  lifecycleContext: 'org' | 'project';
}) {
  const { t } = useT('apps');
  const lifecycle = (
    <AppLifecycleActions
      appSlug={appSlug}
      appName={app.name}
      organizationId={organizationId}
      context={lifecycleContext}
      projectId={projectId}
    />
  );
  return (
    <AppRuntimeProvider
      value={{
        organizationId,
        ...(projectId !== undefined && { projectId }),
        appSlug,
        allowlist: app.functions,
        labels,
      }}
    >
      <ResourceDetailProvider>
        <VStack gap={6}>
          <ReadinessSection
            organizationId={organizationId}
            appSlug={appSlug}
            app={app}
            status={status}
            blockedIntegrations={blockedIntegrations}
            projectId={projectId}
          />
          {app.views.length === 0 ? (
            <VStack gap={4}>
              <HStack className="justify-end">{lifecycle}</HStack>
              <EmptyState
                title={t('noViews.title')}
                description={t('noViews.description')}
              />
            </VStack>
          ) : (
            app.views.map((view, index) => {
              const title = resolvePackLabel(view.title, labels);
              const description = resolvePackLabel(view.description, labels);
              const isFirst = index === 0;
              return (
                <VStack key={view.id} gap={4}>
                  {(title || description || isFirst) && (
                    <HStack className="items-start justify-between gap-3">
                      <VStack gap={1} className="min-w-0">
                        {title && (
                          <Text as="span" className="text-xl font-semibold">
                            {title}
                          </Text>
                        )}
                        {description && (
                          <Text variant="muted">{description}</Text>
                        )}
                      </VStack>
                      {isFirst && lifecycle}
                    </HStack>
                  )}
                  <ViewBody view={view} labels={labels} />
                </VStack>
              );
            })
          )}
        </VStack>
      </ResourceDetailProvider>
    </AppRuntimeProvider>
  );
}

/**
 * The org-level membership hub for an installed project-scoped app: org readiness
 * + the bound-projects list (open / remove each) + "Add to a project" + the
 * Reinstall/Uninstall menu (Uninstall is blocked while any project is bound).
 * Renders no app views (those live on the project route).
 */
function MembershipHub({
  organizationId,
  appSlug,
  app,
  status,
  blockedIntegrations,
}: {
  organizationId: string;
  appSlug: string;
  app: AppSummary;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
}) {
  const { t } = useT('apps');
  const { bindings } = useAppBindings(organizationId, appSlug);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <VStack gap={6}>
      <HStack className="items-start justify-between gap-3">
        <VStack gap={1} className="min-w-0">
          <Text as="span" className="text-xl font-semibold">
            {app.name}
          </Text>
          {app.description && <Text variant="muted">{app.description}</Text>}
        </VStack>
        <AppLifecycleActions
          appSlug={appSlug}
          appName={app.name}
          organizationId={organizationId}
          context="org"
          boundProjectCount={bindings.length}
        />
      </HStack>

      <ReadinessSection
        organizationId={organizationId}
        appSlug={appSlug}
        app={app}
        status={status}
        blockedIntegrations={blockedIntegrations}
      />

      <VStack gap={3}>
        <HStack className="items-center justify-between">
          <Text className="font-medium">{t('membership.title')}</Text>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => setWizardOpen(true)}
          >
            {t('membership.addProject')}
          </Button>
        </HStack>
        {bindings.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title={t('membership.emptyTitle')}
            description={t('membership.emptyDescription')}
          />
        ) : (
          <VStack gap={2}>
            {bindings.map((binding) => (
              <Card key={binding.projectId} className="py-3">
                <HStack className="items-center justify-between gap-3">
                  <Link
                    to="/dashboard/$id/projects/$projectId/apps/$appSlug"
                    params={{
                      id: organizationId,
                      projectId: binding.projectId,
                      appSlug,
                    }}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {binding.projectName}
                  </Link>
                  <AppLifecycleActions
                    appSlug={appSlug}
                    appName={app.name}
                    organizationId={organizationId}
                    context="project"
                    projectId={binding.projectId}
                  />
                </HStack>
              </Card>
            ))}
          </VStack>
        )}
      </VStack>

      <AppInstallWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={organizationId}
        appSlug={appSlug}
        appName={app.name}
        scope={app.scope}
        requiredIntegrations={app.requiredIntegrations}
      />
    </VStack>
  );
}

/** Project route, app not bound here — prompt to add it to this project. */
function AddToThisProject({
  organizationId,
  appSlug,
  app,
  projectId,
}: {
  organizationId: string;
  appSlug: string;
  app: AppSummary;
  projectId: string;
}) {
  const { t } = useT('apps');
  const { install, isPending } = useAppInstallActions(organizationId);
  return (
    <EmptyState
      icon={LayoutGrid}
      title={t('membership.notInProjectTitle', { defaultValue: app.name })}
      description={t('membership.notInProjectDescription')}
      action={
        <Button
          disabled={isPending}
          onClick={() => void install(appSlug, projectId)}
        >
          {t('membership.addToThisProject')}
        </Button>
      }
    />
  );
}

export function AppPage({
  organizationId,
  appSlug,
  projectId,
}: {
  organizationId: string;
  appSlug: string;
  /** Set when rendered under a project route. */
  projectId?: string;
}) {
  const { t } = useT('apps');
  const { locale } = useLocale();
  const [wizardOpen, setWizardOpen] = useState(false);
  const { apps, isLoading } = useApps(organizationId);
  const { bySlug, isLoading: stateLoading } =
    useAppInstallStates(organizationId);
  const { install, isPending } = useAppInstallActions(organizationId);

  const app = apps.find((a) => a.slug === appSlug);
  const state = bySlug.get(appSlug);
  const { bindings } = useAppBindings(organizationId, appSlug);

  const labels = useMemo<Record<string, string>>(
    () => resolvePackLabels(app?.messages, locale),
    [app?.messages, locale],
  );

  if ((isLoading && !app) || stateLoading) {
    return <SkeletonText lines={6} />;
  }
  if (!app) {
    return (
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    );
  }

  const onProjectRoute = projectId !== undefined;
  const isProjectScoped = app.scope === 'project';

  // PROJECT route — only project-scoped apps land here. Bound → views; not
  // bound (or not yet installed) → an "Add to this project" prompt.
  if (onProjectRoute) {
    const boundHere = bindings.some((b) => b.projectId === projectId);
    if (boundHere && state) {
      return (
        <InstalledAppBody
          organizationId={organizationId}
          appSlug={appSlug}
          app={app}
          projectId={projectId}
          status={state.status}
          blockedIntegrations={state.blockedIntegrations}
          labels={labels}
          lifecycleContext="project"
        />
      );
    }
    return (
      <AddToThisProject
        organizationId={organizationId}
        appSlug={appSlug}
        app={app}
        projectId={projectId}
      />
    );
  }

  // ORG route, not installed — Install prompt (wizard picks the first project
  // for a project-scoped app / walks required integrations).
  if (!state) {
    const needsWizard = isProjectScoped || app.requiredIntegrations.length > 0;
    return (
      <>
        <EmptyState
          icon={LayoutGrid}
          title={t('install.notInstalledTitle', { defaultValue: app.name })}
          description={t('install.notInstalledDescription')}
          action={
            <Button
              disabled={isPending}
              onClick={() =>
                needsWizard ? setWizardOpen(true) : void install(appSlug)
              }
            >
              {t('install.install')}
            </Button>
          }
        />
        {needsWizard && (
          <AppInstallWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            organizationId={organizationId}
            appSlug={appSlug}
            appName={app.name}
            scope={app.scope}
            requiredIntegrations={app.requiredIntegrations}
          />
        )}
      </>
    );
  }

  // ORG route, installed, project-scoped → the membership hub (no views).
  if (isProjectScoped) {
    return (
      <MembershipHub
        organizationId={organizationId}
        appSlug={appSlug}
        app={app}
        status={state.status}
        blockedIntegrations={state.blockedIntegrations}
      />
    );
  }

  // ORG route, installed, org-scoped → the app's views.
  return (
    <InstalledAppBody
      organizationId={organizationId}
      appSlug={appSlug}
      app={app}
      status={state.status}
      blockedIntegrations={state.blockedIntegrations}
      labels={labels}
      lifecycleContext="org"
    />
  );
}
