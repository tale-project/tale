'use client';

/** An app's page in the Apps hub. Gates on install state: not-installed shows an
 * Install prompt; installed renders the app's views (the generic ViewRenderer)
 * with a NON-BLOCKING readiness checklist above them — missing integration
 * credentials route to the canonical connect flow; a broken install (a copied
 * resource was deleted) offers Reinstall. The app shell stays usable throughout. */
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAppAgentReadiness } from '../hooks/use-app-agent-readiness';
import { resolvePackLabels } from '../hooks/use-app-pack-labels';
import { type AppTabDoc, type AppViewDoc, useApps } from '../hooks/use-apps';
import {
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
  const { install, isPending } = useAppInstallActions(organizationId);

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
              onClick={() => void install(appSlug)}
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

export function AppPage({
  organizationId,
  appSlug,
  projectId,
}: {
  organizationId: string;
  appSlug: string;
  /** Set when rendered under a project route — the app's bound project. */
  projectId?: string;
}) {
  const { t } = useT('apps');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);
  // The required integration whose connect-only wizard is open (readiness row).
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  // Whether the agent-setup (connect-only) wizard is open.
  const [agentSetupOpen, setAgentSetupOpen] = useState(false);
  const { apps, isLoading } = useApps(organizationId);
  const { bySlug, isLoading: stateLoading } =
    useAppInstallStates(organizationId);
  const { install, verify, isPending } = useAppInstallActions(organizationId);

  const app = apps.find((a) => a.slug === appSlug);
  const state = bySlug.get(appSlug);

  // Bundled-agent readiness — only meaningful once the app is installed. It's an
  // action query (not a live Convex query like the integration state), so it must
  // be refetched after the setup wizard closes for the checklist to clear.
  const { agents: agentReadiness, refetch: refetchAgentReadiness } =
    useAppAgentReadiness(organizationId, appSlug, state !== undefined);
  const blockedAgents = useMemo(
    () =>
      agentReadiness
        .filter((a) => !a.ready)
        .map((a) => ({ agentSlug: a.agentSlug, displayName: a.displayName })),
    [agentReadiness],
  );

  // A project-scoped app is used inside its bound project. When this page is
  // reached at the org-level route (or under the wrong project), redirect to the
  // bound project's app route so the URL and the in-project nav stay honest.
  const boundProjectId =
    app?.scope === 'project' ? state?.projectId : undefined;
  const needsRedirect =
    boundProjectId !== undefined && boundProjectId !== projectId;
  useEffect(() => {
    if (needsRedirect && boundProjectId) {
      void navigate({
        to: '/dashboard/$id/projects/$projectId/apps/$appSlug',
        params: { id: organizationId, projectId: boundProjectId, appSlug },
        replace: true,
      });
    }
  }, [needsRedirect, boundProjectId, organizationId, appSlug, navigate]);

  // The app's pack labels for the active locale (shared resolver — the run view
  // resolves `ui.labelKey` against the same catalog via `useAppPackLabels`).
  const labels = useMemo<Record<string, string>>(
    () => resolvePackLabels(app?.messages, locale),
    [app?.messages, locale],
  );

  // Re-check that the copied files still exist when an installed app opens.
  // Guard by appSlug so it runs once per app (verify's identity is unstable and
  // it mutates the install status, which would otherwise re-fire in a loop).
  const installed = state !== undefined;
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (installed && verifiedRef.current !== appSlug) {
      verifiedRef.current = appSlug;
      void verify(appSlug);
    }
  }, [installed, appSlug, verify]);

  if ((isLoading && !app) || stateLoading || needsRedirect) {
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

  if (!state) {
    // A project-scoped app (needs a target project) or one with required
    // integrations (needs a connect step) routes through the install wizard;
    // an org-scoped app with no requirements installs directly.
    const needsWizard =
      app.scope === 'project' || app.requiredIntegrations.length > 0;
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
                needsWizard
                  ? setWizardOpen(true)
                  : void install(appSlug, projectId)
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
            projectId={projectId}
            requiredIntegrations={app.requiredIntegrations}
          />
        )}
      </>
    );
  }

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
          <ReadinessChecklist
            organizationId={organizationId}
            appSlug={appSlug}
            status={state.status}
            blockedIntegrations={state.blockedIntegrations}
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
              projectId={state.projectId ?? projectId}
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
              projectId={state.projectId ?? projectId}
              requiredIntegrations={app.requiredIntegrations}
              mode="connect-only"
              initialSlugs={[]}
            />
          )}
          {app.views.length === 0 ? (
            <VStack gap={4}>
              {/* Manage menu rides the header even when the app has no views. */}
              <HStack className="justify-end">
                <AppLifecycleActions
                  appSlug={appSlug}
                  appName={app.name}
                  organizationId={organizationId}
                  projectId={state.projectId}
                />
              </HStack>
              <EmptyState
                title={t('noViews.title')}
                description={t('noViews.description')}
              />
            </VStack>
          ) : (
            app.views.map((view, index) => {
              const title = resolvePackLabel(view.title, labels);
              const description = resolvePackLabel(view.description, labels);
              // The app-level manage menu (⋯) rides the first view's title row
              // — a proper header, not its own empty strip.
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
                      {isFirst && (
                        <AppLifecycleActions
                          appSlug={appSlug}
                          appName={app.name}
                          organizationId={organizationId}
                          projectId={state.projectId}
                        />
                      )}
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
