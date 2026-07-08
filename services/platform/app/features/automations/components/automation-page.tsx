'use client';

/** An automation's page. Gates on install state and scope:
 *
 *  - NOT installed → an Install prompt (project-scoped automations route through the
 *    wizard to pick the first project).
 *  - ORG route + installed (org- OR project-scoped) → the automation's own tabbed
 *    page: Editor · Executions · Configuration · Triggers · Integrations (Editor /
 *    Executions / Triggers are gated on developer access AND the automation owning
 *    a workflow). A project-scoped automation no longer diverts to a standalone
 *    membership hub — the projects it runs in are a section of its Configuration
 *    tab, alongside its identity and its workflow's runtime settings.
 *  - PROJECT route, this project bound → the same tabbed page, scoped to the URL
 *    project; lifecycle here is "Remove from this project".
 *  - PROJECT route, this project NOT bound → an "Add to this project" prompt.
 *
 *  A non-blocking readiness checklist (missing integration credentials / agent
 *  setup / broken install) names exactly what's missing; the shell stays usable. */
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import { Grid, HStack, Row, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { LayoutGrid, Sparkles, UserPen, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@/app/components/ui/editor';
import type { TabNavigationItem } from '@/app/components/ui/navigation/tab-navigation';
import { ExecutionsTable } from '@/app/features/workflows/executions/executions-table';
import { Triggers } from '@/app/features/workflows/triggers/triggers';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';
import type { CredentialRuntimeMismatchDetail } from '@/lib/shared/agents/readiness';
import { formatEnvKeyList } from '@/lib/shared/agents/readiness';
import { startCase } from '@/lib/utils/string';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import { useAutomationAgentReadiness } from '../hooks/use-automation-agent-readiness';
import { useAutomationDisplay } from '../hooks/use-automation-text';
import {
  type AutomationSummary,
  type AutomationTabDoc,
  type AutomationViewDoc,
  isAutomationViewErrorStub,
  useAutomationCatalog,
  useAutomations,
} from '../hooks/use-automations';
import {
  isInstallOverridesError,
  useAutomationBindings,
  useAutomationInstallActions,
  useAutomationInstallStates,
} from '../hooks/use-install-state';
import { useReinstallWithPreflight } from '../hooks/use-reinstall-with-preflight';
import { useRequiredIntegrations } from '../hooks/use-required-integrations';
import { AutomationView } from '../registry/automation-view';
import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { ResourceDetailProvider } from '../runtime/resource-detail';
import { AutomationAssistantPanel } from './automation-assistant-panel';
import { AutomationConfiguration } from './automation-configuration';
import { AutomationDeleteAction } from './automation-delete-action';
import { AutomationDetailShell } from './automation-detail-shell';
import { AutomationMarker } from './automation-icon';
import { AutomationIntegrationsTab } from './automation-integrations-tab';
import { AutomationLifecycleActions } from './automation-lifecycle-actions';
import { AutomationProjectsSection } from './automation-projects-section';
import { AutomationWorkflowEditorTab } from './automation-workflow-editor-tab';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';

/**
 * Tab values for the automation-owned tabs (as opposed to a manifest view's
 * id, which is dynamic — `uniqueTabValue` guards against a collision with
 * these). Editor/Executions/Triggers are gated on developer access AND the
 * automation actually having a workflow (`manifest.workflows[0]`);
 * Configuration and Integrations always show.
 */
const EDITOR_TAB = 'editor';
const EXECUTIONS_TAB = 'executions';
const CONFIGURATION_TAB = 'configuration';
const TRIGGERS_TAB = 'triggers';
const INTEGRATIONS_TAB = 'integrations';

function ReadinessChecklist({
  organizationId,
  automationSlug,
  status,
  blockedIntegrations,
  blockedAgents,
  onConnect,
  onSetupAgents,
}: {
  organizationId: string;
  automationSlug: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  /** Bundled agents not yet ready (no provider key / missing secrets). */
  blockedAgents: {
    agentSlug: string;
    displayName: string;
    credentialMismatch?: CredentialRuntimeMismatchDetail;
    missingEnvKeys: string[];
  }[];
  /** Open the inline connect wizard for one required integration. */
  onConnect: (slug: string) => void;
  /** Open the inline wizard to finish the bundled agents' setup. */
  onSetupAgents: () => void;
}) {
  const { t } = useT('automations');
  const openAgentLabel = t('readiness.openAgent');
  // Broken-install repair runs through the shared preflight flow so a repair
  // never silently overwrites files the operator edited.
  const {
    requestReinstall,
    dialog: reinstallDialog,
    isPending,
  } = useReinstallWithPreflight(organizationId);
  // Resolve each blocked slug to its integration display title, the same lookup
  // the install wizard's `labelFor` uses — so the checklist reads "Connect
  // GitHub", not the raw "github" slug.
  const { required } = useRequiredIntegrations(
    organizationId,
    blockedIntegrations,
  );
  const titleBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r.integration.title])),
    [required],
  );
  // A one-line "what's actually missing" summary under the banner title — the
  // rows below are the ACTIONS, this names the blockers at a glance so the
  // operator doesn't have to read every row to know what's outstanding.
  const missingSummary = useMemo(() => {
    const parts: string[] = [];
    if (status === 'broken') {
      parts.push(t('readiness.summaryBroken'));
    }
    if (blockedIntegrations.length > 0) {
      parts.push(
        t('readiness.summaryIntegrations', {
          names: blockedIntegrations
            .map((slug) => titleBySlug.get(slug) ?? slug)
            .join(', '),
        }),
      );
    }
    if (blockedAgents.length > 0) {
      parts.push(
        t('readiness.summaryAgents', {
          names: blockedAgents.map((agent) => agent.displayName).join(', '),
        }),
      );
    }
    return parts.join(' · ');
  }, [status, blockedIntegrations, blockedAgents, titleBySlug, t]);

  if (
    status === 'active' &&
    blockedIntegrations.length === 0 &&
    blockedAgents.length === 0
  ) {
    return null;
  }

  return (
    // `icon` keeps this banner visually in step with the app's other warning
    // boxes (e.g. project secrets' "Available to agents") — icon left, content
    // indented.
    <Alert variant="warning" icon={Wrench} title={t('readiness.title')}>
      <VStack gap={2} className="mt-1">
        <Text className="text-sm font-medium">{missingSummary}</Text>
        {status === 'broken' && (
          <HStack gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.broken')}
            </Text>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => void requestReinstall(automationSlug)}
            >
              {t('install.reinstall')}
            </Button>
            {reinstallDialog}
          </HStack>
        )}
        {blockedIntegrations.map((slug) => (
          <HStack key={slug} gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.connect', {
                integration: titleBySlug.get(slug) ?? slug,
              })}
            </Text>
            <Button variant="secondary" onClick={() => onConnect(slug)}>
              {t('readiness.connectButton')}
            </Button>
          </HStack>
        ))}
        {blockedAgents.map((agent) => {
          // `code` is the closed CredentialRuntimeMismatchCode union — every
          // code has platform copy under `readiness.mismatch.*`.
          const mismatchHint = agent.credentialMismatch
            ? t(`readiness.mismatch.${agent.credentialMismatch.code}`, {
                agent: agent.displayName,
                expectedKeys: formatEnvKeyList(
                  agent.credentialMismatch.expectedKeys,
                ),
                configuredKeys: formatEnvKeyList(
                  agent.credentialMismatch.configuredKeys,
                ),
              })
            : undefined;
          const missingKeysHint =
            !mismatchHint && agent.missingEnvKeys.length > 0
              ? t('readiness.agentNeedsKeys', {
                  agent: agent.displayName,
                  keys: formatEnvKeyList(agent.missingEnvKeys),
                })
              : undefined;
          const hint =
            mismatchHint ??
            missingKeysHint ??
            t('readiness.agentNeedsSetup', { agent: agent.displayName });
          return (
            <HStack
              key={agent.agentSlug}
              gap={3}
              className="items-center justify-between"
            >
              <VStack gap={1} className="min-w-0">
                <Text variant="muted" className="text-sm">
                  {hint}
                </Text>
              </VStack>
              {agent.credentialMismatch ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link
                    to="/dashboard/$id/agents/$agentId"
                    params={{
                      id: organizationId,
                      agentId: agent.agentSlug,
                    }}
                  >
                    {openAgentLabel}
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={onSetupAgents}>
                  {t('readiness.setupButton')}
                </Button>
              )}
            </HStack>
          );
        })}
      </VStack>
    </Alert>
  );
}

/**
 * Re-check that the copied files still exist when an installed automation opens.
 * Guarded by automationSlug so it runs once per automation (verify's identity is
 * unstable and it mutates the install status, which would otherwise re-fire in
 * a loop). Lives on the PAGE hosts — not inside `ReadinessSection` — so the
 * check still runs when the readiness banner's tab isn't the one open.
 */
function useOpenTimeIntegrityCheck(
  organizationId: string,
  automationSlug: string,
) {
  const { verify } = useAutomationInstallActions(organizationId);
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (verifiedRef.current !== automationSlug) {
      verifiedRef.current = automationSlug;
      void verify(automationSlug);
    }
  }, [automationSlug, verify]);
}

/**
 * The non-blocking readiness section (checklist + inline connect/agent-setup
 * wizards). Readiness is org-level, so it shows on the org AND project routes;
 * the tabbed page scopes it to the Integrations tab.
 */
function ReadinessSection({
  organizationId,
  automationSlug,
  automation,
  status,
  blockedIntegrations,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  projectId?: string;
}) {
  const display = useAutomationDisplay()(automation);
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  const [agentSetupOpen, setAgentSetupOpen] = useState(false);
  const { agents: agentReadiness, refetch: refetchAgentReadiness } =
    useAutomationAgentReadiness(organizationId, automationSlug, true);
  const blockedAgents = useMemo(
    () =>
      agentReadiness
        .filter((a) => !a.ready)
        .map((a) => {
          const blocked = {
            agentSlug: a.agentSlug,
            displayName: a.displayName,
            missingEnvKeys: a.requiredEnv
              .filter((e) => !e.set)
              .map((e) => e.key),
          };
          if (a.credentialMismatch !== undefined) {
            Object.assign(blocked, {
              credentialMismatch: a.credentialMismatch,
            });
          }
          return blocked;
        }),
    [agentReadiness],
  );

  return (
    <>
      <ReadinessChecklist
        organizationId={organizationId}
        automationSlug={automationSlug}
        status={status}
        blockedIntegrations={blockedIntegrations}
        blockedAgents={blockedAgents}
        onConnect={setConnectSlug}
        onSetupAgents={() => setAgentSetupOpen(true)}
      />
      {connectSlug && (
        <AutomationInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) setConnectSlug(null);
          }}
          organizationId={organizationId}
          automationSlug={automationSlug}
          automationName={display.name}
          scope={automation.scope}
          projectId={projectId}
          requiredIntegrations={automation.requiredIntegrations}
          mode="connect-only"
          initialSlugs={[connectSlug]}
        />
      )}
      {agentSetupOpen && (
        <AutomationInstallWizard
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
          automationSlug={automationSlug}
          automationName={display.name}
          scope={automation.scope}
          projectId={projectId}
          requiredIntegrations={automation.requiredIntegrations}
          mode="connect-only"
          initialSlugs={[]}
        />
      )}
    </>
  );
}

/** A tab's content: side-by-side columns, or a single Puck Data region. */
function TabContent({ tab }: { tab: AutomationTabDoc }) {
  if (tab.columns && tab.columns.length > 0) {
    return (
      <Grid lg={2} className="items-start">
        {tab.columns.map((col, i) => (
          <AutomationView key={i} data={col} />
        ))}
      </Grid>
    );
  }
  return <AutomationView data={tab.data} />;
}

/** A view body: the tabbed shell (navigated) or a flat Puck Data document. Tab
 *  labels are literal display strings. */
function ViewBody({ view }: { view: AutomationViewDoc }) {
  if (view.tabs && view.tabs.length > 0) {
    return (
      <Tabs
        variant="underline"
        defaultValue={view.tabs[0].id}
        items={view.tabs.map((tab) => ({
          value: tab.id,
          label: tab.label,
          content: <TabContent tab={tab} />,
        }))}
      />
    );
  }
  return <AutomationView data={view.data} />;
}

/**
 * Reads the active tab's editor controller (the Configuration form) and
 * renders the unified Save/Discard cluster in the tab strip, alongside the
 * automation's own trailing actions (Assistant + the lifecycle ⋯ menu) —
 * the same slot anatomy as the standalone workflow page's tab strip.
 */
function AutomationEditorActionsSlot({ trailing }: { trailing: ReactNode }) {
  const controller = useActiveEditor();
  if (!controller) {
    return (
      <Row gap={2} className="ml-auto">
        {trailing}
      </Row>
    );
  }
  return (
    <EditorActions
      controller={controller}
      entityKind="automation"
      history={trailing}
    />
  );
}

/**
 * An installed automation's page body — the workflow settings, under the
 * automation: the "Automations / <name>" breadcrumb and ONE shared tab strip
 * (`TabNavigation`, matching every other settings page), in order: Editor,
 * Executions, Configuration, Triggers, Integrations, then any bundled views
 * (invalid ones as repair-stub tabs). Editor/Executions/Triggers are gated on
 * developer access AND the automation actually having a workflow
 * (`manifest.workflows[0]`); Configuration and Integrations always show. Tab
 * selection is URL-addressable via the `tab` search param; the default is
 * Editor for a developer with a workflow, otherwise the first view the
 * viewer can see (Configuration as the last resort). The strip's trailing
 * slot carries the active tab's Save/Discard plus Assistant + lifecycle.
 * Scoped to `projectId` when rendered under a project route; lifecycle
 * context follows: a bound project shows "Remove from this project"; the org
 * route shows Reinstall/Uninstall.
 */
function InstalledAutomationBody({
  organizationId,
  automationSlug,
  automation,
  projectId,
  status,
  blockedIntegrations,
  lifecycleContext,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  projectId?: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  lifecycleContext: 'org' | 'project';
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  const ability = useAbility();
  useOpenTimeIntegrityCheck(organizationId, automationSlug);
  // Invalid-view repair reinstalls through the shared preflight flow.
  const {
    requestReinstall,
    dialog: reinstallDialog,
    isPending,
  } = useReinstallWithPreflight(organizationId);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Org-wide Uninstall is refused server-side while any project is still bound;
  // knowing the count lets the ⋯ menu block it up front with a hint. (Empty for
  // an org-scoped automation, which can never carry bindings.)
  const { bindings } = useAutomationBindings(organizationId, automationSlug);

  // The 1:1 automation↔workflow model: `manifest.workflows[0]`, when it
  // declares one at all (today's email builtins declare none — Inbox only).
  const workflowSlug = automation.workflows[0];
  const isDeveloper = ability.can('read', 'developerSettings');
  const showDevTabs = isDeveloper && workflowSlug !== undefined;

  // Tab selection rides the URL (`?tab=`) so a view is deep-linkable, same as
  // the workflow detail's `?panel=` state. Switching happens through the tab
  // strip's real links; this only READS the param.
  const { state: tabState } = useUrlState({
    definitions: { tab: { default: null } },
  });

  // Configuration = the automation's identity + its workflow's runtime settings
  // (both already combined in `AutomationConfiguration`) and — for a
  // project-scoped automation — the projects it runs in. That last section is
  // what the standalone membership-hub page used to be.
  const configuration = (
    <VStack gap={6}>
      <AutomationConfiguration
        organizationId={organizationId}
        automationSlug={automationSlug}
        automation={automation}
      />
      {automation.scope === 'project' && (
        <AutomationProjectsSection
          organizationId={organizationId}
          automationSlug={automationSlug}
          automation={automation}
        />
      )}
    </VStack>
  );

  // Tab values come from view ids; the automation-owned tab values are
  // reserved up front, and duplicates are suffix-guarded so a colliding view
  // id can never shadow another tab.
  const usedTabValues = new Set<string>([
    EDITOR_TAB,
    EXECUTIONS_TAB,
    CONFIGURATION_TAB,
    TRIGGERS_TAB,
    INTEGRATIONS_TAB,
  ]);
  const uniqueTabValue = (id: string): string => {
    let value = id;
    while (usedTabValues.has(value)) value = `view-${value}`;
    usedTabValues.add(value);
    return value;
  };

  const viewTabs = automation.views.map((view, index) => {
    // A view doc may omit its `id` — fall back to a stable positional value.
    const viewId = view.id ?? `view-${index + 1}`;
    if (isAutomationViewErrorStub(view)) {
      return {
        value: uniqueTabValue(view.id),
        label: startCase(view.id),
        content: (
          <Alert variant="destructive" title={t('viewInvalid.title')}>
            <VStack gap={3}>
              <Text>{t('viewInvalid.description')}</Text>
              <Text variant="muted" className="text-sm">
                {view.error.message}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={isPending}
                onClick={() => void requestReinstall(automationSlug)}
              >
                {t('viewInvalid.reinstall')}
              </Button>
            </VStack>
          </Alert>
        ),
      };
    }
    return {
      value: uniqueTabValue(viewId),
      label: view.title ?? startCase(viewId),
      content: (
        <VStack gap={4}>
          {view.description && <Text variant="muted">{view.description}</Text>}
          <ViewBody view={view} />
        </VStack>
      ),
    };
  });
  const tabItems = [
    ...(showDevTabs && workflowSlug !== undefined
      ? [
          {
            value: EDITOR_TAB,
            label: t('tabs.editor'),
            content: (
              <AutomationWorkflowEditorTab
                organizationId={organizationId}
                workflowSlug={workflowSlug}
              />
            ),
          },
          {
            value: EXECUTIONS_TAB,
            label: t('tabs.executions'),
            content: (
              <ExecutionsTable
                workflowId={workflowSlug}
                organizationId={organizationId}
              />
            ),
          },
        ]
      : []),
    {
      value: CONFIGURATION_TAB,
      label: t('tabs.configuration'),
      content: configuration,
    },
    ...(showDevTabs && workflowSlug !== undefined
      ? [
          {
            value: TRIGGERS_TAB,
            label: t('tabs.triggers'),
            content: (
              <Triggers
                workflowId={workflowSlug}
                organizationId={organizationId}
                workflowSlug={workflowSlug}
              />
            ),
          },
        ]
      : []),
    {
      value: INTEGRATIONS_TAB,
      label: t('tabs.integrations'),
      content: (
        <AutomationIntegrationsTab
          organizationId={organizationId}
          automationSlug={automationSlug}
          automation={automation}
          projectId={projectId}
        />
      ),
    },
    ...viewTabs,
  ];
  // An unknown/absent `?tab=` falls back to Editor for a developer with a
  // workflow, otherwise the first view the viewer can see (Configuration as
  // the last resort). Validated against the tabs actually RENDERED (not
  // `usedTabValues`, which also reserves gated tab values for
  // collision-avoidance even when they aren't shown) — a stale `?tab=editor`
  // from before a role change, or on a non-developer's guessed URL, falls
  // back cleanly instead of selecting a tab that isn't in `tabItems`.
  const renderedTabValues = new Set(tabItems.map((item) => item.value));
  const defaultTab = showDevTabs
    ? EDITOR_TAB
    : (viewTabs[0]?.value ?? CONFIGURATION_TAB);
  const activeTab =
    tabState.tab !== null && renderedTabValues.has(tabState.tab)
      ? tabState.tab
      : defaultTab;
  const activeContent =
    tabItems.find((item) => item.value === activeTab)?.content ?? null;

  // Real links through the shared strip: every tab navigates the SAME route
  // with its `?tab=` value (the default tab clears it), so deep links and
  // back/forward keep working while the strip stays the one every settings
  // page renders.
  const basePath =
    projectId !== undefined
      ? `/dashboard/${organizationId}/projects/${projectId}/automations/${automationSlug}`
      : `/dashboard/${organizationId}/automations/${automationSlug}`;
  const navItems: TabNavigationItem[] = tabItems.map((item) => ({
    label: item.label,
    href: basePath,
    search: item.value === defaultTab ? {} : { tab: item.value },
    isActive: activeTab === item.value,
  }));

  const canUseAssistant = isDeveloper;
  const trailingActions = (
    <>
      {canUseAssistant && (
        <IconButton
          icon={Sparkles}
          aria-label={t('assistant.open')}
          variant="ghost"
          onClick={() => setAssistantOpen(true)}
        />
      )}
      <AutomationLifecycleActions
        automationSlug={automationSlug}
        automationName={display.name}
        organizationId={organizationId}
        context={lifecycleContext}
        projectId={projectId}
        boundProjectCount={
          lifecycleContext === 'org' ? bindings.length : undefined
        }
      />
    </>
  );

  const readiness = (
    <ReadinessSection
      organizationId={organizationId}
      automationSlug={automationSlug}
      automation={automation}
      status={status}
      blockedIntegrations={blockedIntegrations}
      projectId={projectId}
    />
  );

  return (
    <AutomationRuntimeProvider
      value={{
        organizationId,
        ...(projectId !== undefined && { projectId }),
        automationSlug,
        allowlist: automation.functions,
      }}
    >
      <ResourceDetailProvider>
        <ActiveEditorProvider>
          <AutomationDetailShell
            organizationId={organizationId}
            displayName={display.name}
            tabs={navItems}
            tabsChildren={
              <AutomationEditorActionsSlot trailing={trailingActions} />
            }
          >
            {reinstallDialog}
            {activeTab === EDITOR_TAB ? (
              /* The Editor is the one full-bleed tab — the canvas fills the
                 page. */
              <div className="flex min-h-0 flex-1 flex-col">
                {activeContent}
              </div>
            ) : (
              <ContentArea gap={6}>
                {/* The "Finish setup" banner is about connect state, so it
                    lives on the Integrations tab only. */}
                {activeTab === INTEGRATIONS_TAB && readiness}
                {activeContent}
              </ContentArea>
            )}
            {canUseAssistant && (
              <AutomationAssistantPanel
                open={assistantOpen}
                onOpenChange={setAssistantOpen}
                organizationId={organizationId}
                automationSlug={automationSlug}
                automationName={display.name}
                projectId={projectId}
              />
            )}
          </AutomationDetailShell>
        </ActiveEditorProvider>
      </ResourceDetailProvider>
    </AutomationRuntimeProvider>
  );
}

/** Project route, automation not bound here — prompt to add it to this project. */
function AddToThisProject({
  organizationId,
  automationSlug,
  automation,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  projectId: string;
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  const { install, isPending } = useAutomationInstallActions(organizationId);
  return (
    <EmptyState
      icon={LayoutGrid}
      title={t('membership.notInProjectTitle', { defaultValue: display.name })}
      description={t('membership.notInProjectDescription')}
      action={
        <Button
          disabled={isPending}
          onClick={() =>
            notifyOnInstallFailure(
              install(automationSlug, projectId),
              t('install.installFailed'),
            )
          }
        >
          {t('membership.addToThisProject')}
        </Button>
      }
    />
  );
}

/**
 * Org route, automation NOT installed — a real pre-install details page: the full
 * (un-clamped) description plus what the automation brings (its pages / workflows /
 * agents) and what it needs (integrations connected during setup), with Install
 * as the CTA. Replaces the bare "install it first" prompt so you can judge an
 * automation before committing to it. The wizard (project pick / required integrations)
 * lives inside, matching the one-click-vs-wizard split on the hub.
 */
function AutomationDetails({
  organizationId,
  automationSlug,
  automation,
  wizardOpen,
  onWizardOpenChange,
  isCustom,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  // Controlled by AutomationPage: installing flips the automation's install state, which
  // would otherwise unmount this pre-install page (and the open wizard) the
  // instant the wizard's Install step runs. AutomationPage keeps this page mounted
  // while the wizard is open, so the flow reaches its integration/Done steps.
  wizardOpen: boolean;
  onWizardOpenChange: (open: boolean) => void;
  /** A custom (uploaded) automation — earns a "Custom" corner glyph on its icon
   *  tile and a Delete affordance (built-in catalog automations have neither). */
  isCustom: boolean;
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  const navigate = useNavigate();
  const { install, isPending } = useAutomationInstallActions(organizationId);
  const needsWizard =
    automation.scope === 'project' ||
    automation.requiredIntegrations.length > 0;

  // Pages by their literal titles; untitled views drop out — a blank chip says
  // nothing about what the page is.
  const pageTitles = automation.views
    .filter((v): v is AutomationViewDoc => !isAutomationViewErrorStub(v))
    .map((v) => v.title)
    .filter((title): title is string => Boolean(title));

  // The automation's composition, as labelled chip groups. Slugs are humanized for
  // display (we have no friendlier name pre-install); empty groups are dropped.
  const includes = [
    { key: 'views', label: t('details.pages'), items: pageTitles },
    {
      key: 'workflows',
      label: t('details.workflows'),
      items: automation.workflows.map(startCase),
    },
    {
      key: 'agents',
      label: t('details.agents'),
      items: automation.agents.map(startCase),
    },
    {
      key: 'skills',
      label: t('details.skills'),
      items: automation.skills.map(startCase),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <VStack gap={6}>
      <HStack className="items-start justify-between gap-3">
        <HStack gap={3} className="min-w-0 items-start">
          {(() => {
            const tile = (
              <Row
                gap={0}
                justify="center"
                className="bg-muted text-muted-foreground size-10 shrink-0 rounded-lg"
              >
                <LayoutGrid className="size-5" />
              </Row>
            );
            // Same corner-glyph marker the catalog card uses — never a
            // title-row chip.
            return isCustom ? (
              <AutomationMarker
                icon={UserPen}
                label={t('custom')}
                className="shrink-0"
              >
                {tile}
              </AutomationMarker>
            ) : (
              tile
            );
          })()}
          <VStack gap={1} className="min-w-0">
            <Text as="span" className="text-xl font-semibold">
              {display.name}
            </Text>
            <HStack gap={2} className="flex-wrap items-center">
              <Badge variant="slate">
                {t(
                  automation.scope === 'project'
                    ? 'details.scopeProject'
                    : 'details.scopeOrg',
                )}
              </Badge>
            </HStack>
          </VStack>
        </HStack>
        <HStack gap={2} className="shrink-0 items-center">
          <Button
            disabled={isPending}
            onClick={() => {
              if (needsWizard) {
                onWizardOpenChange(true);
                return;
              }
              void install(automationSlug).catch((err: unknown) => {
                // Existing org files would be overwritten — route through the
                // wizard, whose preflight review step collects the per-file
                // confirmation instead of failing flat.
                if (isInstallOverridesError(err)) {
                  onWizardOpenChange(true);
                  return;
                }
                console.error(err);
                toast({
                  title: t('install.installFailed'),
                  description: err instanceof Error ? err.message : undefined,
                  variant: 'destructive',
                });
              });
            }}
          >
            {t('install.install')}
          </Button>
          {isCustom && (
            <AutomationDeleteAction
              automationSlug={automationSlug}
              automationName={display.name}
              organizationId={organizationId}
              onDeleted={() =>
                void navigate({
                  to: '/dashboard/$id/automations',
                  params: { id: organizationId },
                })
              }
            />
          )}
        </HStack>
      </HStack>

      <Text variant="muted">
        {automation.description || t('install.notInstalledDescription')}
      </Text>

      {includes.length > 0 && (
        <Card>
          <VStack gap={4}>
            <Text className="font-medium">{t('details.includesTitle')}</Text>
            {includes.map((section) => (
              <VStack key={section.key} gap={2}>
                <Text variant="muted" className="text-sm">
                  {section.label}
                </Text>
                <HStack gap={2} className="flex-wrap">
                  {section.items.map((item, i) => (
                    <Badge key={`${section.key}-${i}`} variant="outline">
                      {item}
                    </Badge>
                  ))}
                </HStack>
              </VStack>
            ))}
          </VStack>
        </Card>
      )}

      {automation.requiredIntegrations.length > 0 && (
        <Card>
          <VStack gap={3}>
            <Text className="font-medium">{t('details.requiresTitle')}</Text>
            <HStack gap={2} className="flex-wrap">
              {automation.requiredIntegrations.map((slug) => (
                <Badge key={slug} variant="outline">
                  {startCase(slug)}
                </Badge>
              ))}
            </HStack>
            <Text variant="muted" className="text-sm">
              {t('details.requiresHint')}
            </Text>
          </VStack>
        </Card>
      )}

      {/* Mounted for `needsWizard` automations AND for the override fallback above
          (a one-click install that hit AUTOMATION_INSTALL_OVERRIDES re-opens here). */}
      {(needsWizard || wizardOpen) && (
        <AutomationInstallWizard
          open={wizardOpen}
          onOpenChange={onWizardOpenChange}
          organizationId={organizationId}
          automationSlug={automationSlug}
          automationName={automation.name}
          scope={automation.scope}
          requiredIntegrations={automation.requiredIntegrations}
        />
      )}
    </VStack>
  );
}

export function AutomationPage({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Set when rendered under a project route. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay();
  const { automations, isLoading } = useAutomations(organizationId);
  // Fall back to the built-in catalog so a not-yet-installed automation discovered in
  // the hub resolves to its pre-install AutomationDetails page instead of "Automation not
  // found". The installed entry wins (it carries the full per-install data);
  // this mirrors the union in automations-grid.tsx.
  const { automations: catalog, isLoading: catalogLoading } =
    useAutomationCatalog(organizationId);
  const { bySlug, isLoading: stateLoading } =
    useAutomationInstallStates(organizationId);

  const automation =
    automations.find((a) => a.slug === automationSlug) ??
    catalog.find((a) => a.slug === automationSlug);
  const state = bySlug.get(automationSlug);
  // CUSTOM (uploaded) automations live in the org dir but not the built-in catalog —
  // the deletable, marker-worthy kind (mirrors `isCustomAutomation` in
  // automations-grid.tsx). A bundle MEMBER is never custom: it IS built-in,
  // merely hidden from the catalog, so the catalog check alone would mislabel it.
  const isCustom =
    automations.some((a) => a.slug === automationSlug) &&
    !catalog.some((a) => a.slug === automationSlug) &&
    !catalog.some(
      (a) => a.kind === 'bundle' && (a.members ?? []).includes(automationSlug),
    );
  const { bindings, isLoading: bindingsLoading } = useAutomationBindings(
    organizationId,
    automationSlug,
  );
  // Owned here (not in AutomationDetails) so the pre-install details page survives the
  // install: the wizard's Install step flips `state`, which would otherwise
  // unmount AutomationDetails and its still-open wizard before its integration/Done
  // steps run. While the wizard is open we keep rendering AutomationDetails.
  const [detailsWizardOpen, setDetailsWizardOpen] = useState(false);

  // On the project route the bound-vs-not decision reads `bindings`; gate on its
  // load too, or a bound automation flashes the "Add to this project" prompt
  // (with a live Install button) until the bindings query resolves.
  if (
    ((isLoading || catalogLoading) && !automation) ||
    stateLoading ||
    (projectId !== undefined && bindingsLoading)
  ) {
    return (
      <AutomationDetailShell organizationId={organizationId} isLoading>
        <ContentArea>
          <SkeletonText lines={6} />
        </ContentArea>
      </AutomationDetailShell>
    );
  }
  if (!automation) {
    return (
      <AutomationDetailShell
        organizationId={organizationId}
        displayName={automationSlug}
      >
        <ContentArea>
          <EmptyState
            title={t('notFound.title')}
            description={t('notFound.description')}
          />
        </ContentArea>
      </AutomationDetailShell>
    );
  }

  const displayName = display(automation).name;
  const onProjectRoute = projectId !== undefined;

  // Every tab-less state shares the same chrome as the installed body:
  // the "Automations / <name>" breadcrumb over a plain content area.
  const shell = (children: React.ReactNode) => (
    <AutomationDetailShell
      organizationId={organizationId}
      displayName={displayName}
    >
      <ContentArea gap={6}>{children}</ContentArea>
    </AutomationDetailShell>
  );

  // PROJECT route — only project-scoped automations land here. Bound → the
  // workflow settings under the Automations breadcrumb; not bound (or not
  // yet installed) → an "Add to this project" prompt.
  if (onProjectRoute) {
    const boundHere = bindings.some((b) => b.projectId === projectId);
    if (boundHere && state) {
      return (
        <InstalledAutomationBody
          organizationId={organizationId}
          automationSlug={automationSlug}
          automation={automation}
          projectId={projectId}
          status={state.status}
          blockedIntegrations={state.blockedIntegrations}
          lifecycleContext="project"
        />
      );
    }
    return shell(
      <AddToThisProject
        organizationId={organizationId}
        automationSlug={automationSlug}
        automation={automation}
        projectId={projectId}
      />,
    );
  }

  // ORG route, not installed — a pre-install details page (full description +
  // what it includes / needs) with Install as the CTA. The wizard (project pick
  // for a project-scoped automation / required integrations) lives inside it. Stay on
  // this page while its wizard is open even after the install lands `state`, so
  // the flow continues to its integration/Done steps instead of vanishing.
  if (!state || detailsWizardOpen) {
    return shell(
      <AutomationDetails
        organizationId={organizationId}
        automationSlug={automationSlug}
        automation={automation}
        wizardOpen={detailsWizardOpen}
        onWizardOpenChange={setDetailsWizardOpen}
        isCustom={isCustom}
      />,
    );
  }

  // ORG route, installed (org- OR project-scoped) → the automation's own tabbed
  // page. A project-scoped automation no longer diverts to a standalone
  // membership hub: the projects it runs in are a section of its Configuration
  // tab (`AutomationProjectsSection`).
  return (
    <InstalledAutomationBody
      organizationId={organizationId}
      automationSlug={automationSlug}
      automation={automation}
      status={state.status}
      blockedIntegrations={state.blockedIntegrations}
      lifecycleContext="org"
    />
  );
}
