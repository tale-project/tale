'use client';

/** An automation's page. Gates on install state and scope:
 *
 *  - NOT installed → an Install prompt (project-scoped automations route through the
 *    wizard to pick the first project).
 *  - ORG route + installed (org- OR project-scoped) → the automation's own tabbed
 *    page: Editor · Executions · Triggers · Integrations · Configuration (Editor /
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
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Grid, HStack, Row, VStack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { LayoutGrid, UserPen, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useEnvEditorController } from '@/app/components/env/use-env-editor-controller';
import { ContentArea } from '@/app/components/layout/content-area';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import type { TabNavigationItem } from '@/app/components/ui/navigation/tab-navigation';
import { useProject } from '@/app/features/projects/hooks/queries';
import { WorkflowEnvEditor } from '@/app/features/workflows/components/workflow-env-editor';
import { ExecutionsTable } from '@/app/features/workflows/executions/executions-table';
import { Triggers } from '@/app/features/workflows/triggers/triggers';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useUrlState } from '@/app/hooks/use-url-state';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type { CredentialRuntimeMismatchDetail } from '@/lib/shared/agents/readiness';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';
import { startCase } from '@/lib/utils/string';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import { useAutomationAgentReadiness } from '../hooks/use-automation-agent-readiness';
import { useAutomationScheduleReadiness } from '../hooks/use-automation-schedule-readiness';
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
import { AutomationConfiguration } from './automation-configuration';
import { AutomationDeleteAction } from './automation-delete-action';
import { AutomationDetailShell } from './automation-detail-shell';
import { AutomationMarker } from './automation-icon';
import { AutomationIntegrationsTab } from './automation-integrations-tab';
import { AutomationWorkflowEditorTab } from './automation-workflow-editor-tab';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';
import { ProjectScopedViewGate } from './project-scoped-view-gate';

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
const ENVIRONMENT_TAB = 'environment';

/**
 * The Configuration tab's editable keys — the `ConfigurationForm` field names
 * (`automation-configuration.tsx`) plus the project-bindings editor's
 * `projectBindings` (`use-project-bindings-editor.ts`). Powers the per-tab
 * amber unsaved dot (#2573): the strip intersects these with the ACTIVE
 * editor controller's `dirtyKeys`, exactly like the agent settings tabs.
 * Only the mounted tab's editor registers, so these can't false-positive
 * while another tab is open.
 */
const CONFIGURATION_TAB_DIRTY_KEYS = [
  'name',
  'description',
  'timeout',
  'maxRetries',
  'backoffMs',
  'variables',
  'projectBindings',
] as const;

function ReadinessChecklist({
  organizationId,
  status,
  blockedIntegrations,
  blockedAgents,
  missingScheduleFields,
  triggersTo,
  onFinishSetup,
  only,
}: {
  organizationId: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  /** Bundled agents not yet ready (no provider key / missing secrets). */
  blockedAgents: {
    agentSlug: string;
    displayName: string;
    credentialMismatch?: CredentialRuntimeMismatchDetail;
    missingEnvKeys: string[];
  }[];
  /** Required schedule variables no active schedule provides — cron runs
   *  WILL fail until they're set on the Triggers tab. */
  missingScheduleFields: string[];
  /** Base path of the automation page when its Triggers tab is rendered
   *  (developer with a workflow) — the schedule-gap deep link's target. */
  triggersTo?: string;
  /** Open the finish-setup wizard for the remaining steps. */
  onFinishSetup: () => void;
  /** Scope the banner to one tab's concern: integration blockers on the
   *  Integrations tab, agent blockers on the Configuration tab. */
  only?: 'integrations' | 'agents';
}) {
  const { t } = useT('automations');
  // Resolve each blocked slug to its integration display title (the install
  // wizard's `labelFor` lookup) so the summary reads "GitHub", not "github".
  const { required } = useRequiredIntegrations(
    organizationId,
    blockedIntegrations,
  );
  const titleBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r.integration.title])),
    [required],
  );

  // Integration/broken/schedule blockers belong on the Integrations tab; agent
  // blockers on Configuration. `only` filters the banner to the relevant ones.
  const showBroken = only !== 'agents' && status === 'broken';
  const showIntegrations = only !== 'agents' && blockedIntegrations.length > 0;
  const showAgents = only !== 'integrations' && blockedAgents.length > 0;
  const showSchedule = only !== 'agents' && missingScheduleFields.length > 0;

  const missingSummary = useMemo(() => {
    const parts: string[] = [];
    if (showBroken) parts.push(t('readiness.summaryBroken'));
    if (showIntegrations) {
      parts.push(
        t('readiness.summaryIntegrations', {
          names: blockedIntegrations
            .map((slug) => titleBySlug.get(slug) ?? slug)
            .join(', '),
        }),
      );
    }
    if (showAgents) {
      parts.push(
        t('readiness.summaryAgents', {
          names: blockedAgents.map((agent) => agent.displayName).join(', '),
        }),
      );
    }
    if (showSchedule) {
      parts.push(
        t('readiness.summaryScheduleVars', {
          fields: missingScheduleFields.join(', '),
        }),
      );
    }
    return parts.join(' · ');
  }, [
    showBroken,
    showIntegrations,
    showAgents,
    showSchedule,
    blockedIntegrations,
    blockedAgents,
    missingScheduleFields,
    titleBySlug,
    t,
  ]);

  if (!showBroken && !showIntegrations && !showAgents && !showSchedule) {
    return null;
  }

  // One warning banner — the wizard button for broken/integration/agent gaps,
  // a Triggers deep link for schedule-variable gaps (the wizard can't set
  // those; the schedule's own editor can). Laid out like the org danger-zone
  // Alert: summary on the left, the actions pinned right on wider screens,
  // stacked on mobile.
  return (
    <Alert variant="warning" icon={Wrench} title={t('readiness.title')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm">{missingSummary}</span>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {showSchedule && triggersTo !== undefined && (
            <Button asChild variant="secondary">
              <Link to={triggersTo} search={{ tab: TRIGGERS_TAB }}>
                {t('readiness.openTriggers')}
              </Link>
            </Button>
          )}
          {(showBroken || showIntegrations || showAgents) && (
            <Button variant="warning" onClick={onFinishSetup}>
              {t('install.setup')}
            </Button>
          )}
        </div>
      </div>
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
 * The non-blocking readiness banner. Scoped per tab: integration blockers show
 * on the Integrations tab, agent blockers on the Configuration tab. Its single
 * button opens the finish-setup wizard (owned by the page) for the remaining
 * steps.
 */
function ReadinessSection({
  organizationId,
  automationSlug,
  status,
  blockedIntegrations,
  triggersTo,
  onFinishSetup,
  only,
}: {
  organizationId: string;
  automationSlug: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
  /** Base path for the Triggers deep link, when that tab is rendered. */
  triggersTo?: string;
  onFinishSetup: () => void;
  only?: 'integrations' | 'agents';
}) {
  // Only fetch agent readiness when this banner cares about agents.
  const { agents: agentReadiness } = useAutomationAgentReadiness(
    organizationId,
    automationSlug,
    only !== 'integrations',
  );
  // Schedule-variable gaps ride the integrations-scoped banner: an ACTIVE
  // schedule missing a required start-schema field fails at fire time, so a
  // green checklist must not hide it (#2606).
  const { missingFields: missingScheduleFields } =
    useAutomationScheduleReadiness(
      organizationId,
      automationSlug,
      only !== 'agents',
    );
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
    <ReadinessChecklist
      organizationId={organizationId}
      status={status}
      blockedIntegrations={blockedIntegrations}
      blockedAgents={blockedAgents}
      missingScheduleFields={only === 'agents' ? [] : missingScheduleFields}
      triggersTo={triggersTo}
      onFinishSetup={onFinishSetup}
      only={only}
    />
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

/** A view body: the tabbed shell (navigated) or a flat Puck Data document.
 *  Tab labels resolve pack-authored `i18n.<locale>.label` over the English
 *  literal. */
function ViewBody({ view }: { view: AutomationViewDoc }) {
  const { locale } = useLocale();
  if (view.tabs && view.tabs.length > 0) {
    return (
      <Tabs
        variant="underline"
        defaultValue={view.tabs[0].id}
        items={view.tabs.map((tab) => ({
          value: tab.id,
          label:
            resolveLocalizedProp(tab.label, tab.i18n, 'label', locale) ??
            tab.label,
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
 * automation's trailing action (the Editor tab's AI Assistant toggle) — the
 * same slot anatomy as the standalone workflow page's tab strip.
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
 * Executions, Triggers, Integrations, any bundled views (invalid ones as
 * repair-stub tabs), then Configuration last. Editor/Executions/Triggers are
 * gated on developer access AND the automation actually having a workflow
 * (`manifest.workflows[0]`); Configuration and Integrations always show. Tab
 * selection is URL-addressable via the `tab` search param; the default is
 * Configuration for a project-scoped automation on the org route (views need
 * a project), else the first bundled view when one exists (operators and
 * developers alike — developers still reach Editor from the strip), else
 * Editor for a developer with a workflow, else Integrations. The strip's
 * trailing slot carries the active tab's Save/Discard plus — on the Editor
 * tab — the single AI Assistant toggle; lifecycle actions (Reinstall /
 * Export / Uninstall / Remove-from-project) live on the Automations catalog
 * card and the Configuration tab's projects list, not here. Scoped to
 * `projectId` when rendered under a project route.
 */
function InstalledAutomationBody({
  organizationId,
  automationSlug,
  automation,
  projectId,
  status,
  blockedIntegrations,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  projectId?: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const display = useAutomationDisplay()(automation);
  const ability = useAbility();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route param is the bound project's Convex id
  const { project } = useProject(projectId as Id<'projects'> | undefined);
  useOpenTimeIntegrityCheck(organizationId, automationSlug);
  // Invalid-view repair reinstalls through the shared preflight flow.
  const {
    requestReinstall,
    dialog: reinstallDialog,
    isPending,
  } = useReinstallWithPreflight(organizationId);
  // The 1:1 automation↔workflow model: `manifest.workflows[0]`, when it
  // declares one at all (today's email builtins declare none — Inbox only).
  const workflowSlug = automation.workflows[0];
  const isDeveloper = ability.can('read', 'developerSettings');
  const showDevTabs = isDeveloper && workflowSlug !== undefined;

  // "Setup incomplete" = a broken install or unconnected required integrations.
  // Drives the Finish-setup affordances (tab-strip button, editor banner) and
  // suppresses the editor's "workflow is active" claim (it can't run yet).
  const setupIncomplete = status === 'broken' || blockedIntegrations.length > 0;
  const [finishSetupOpen, setFinishSetupOpen] = useState(false);

  // The workflow AI Assistant panel's open-state is lifted here so it persists
  // across tab switches; its ✨ toggle lives in the editor canvas toolbar.
  const [aiChatOpen, setAiChatOpen] = useState(true);

  // Tab selection rides the URL (`?tab=`) so a view is deep-linkable, same as
  // the workflow detail's `?panel=` state. Switching happens through the tab
  // strip's real links; this only READS the param.
  const { state: tabState } = useUrlState({
    definitions: { tab: { default: null } },
  });

  // Configuration = the automation's identity + its workflow's runtime settings
  // and — for a project-scoped automation — the projects it runs in (that last
  // section is what the standalone membership-hub page used to be); all combined
  // in `AutomationConfiguration` under one tab-strip Save/Discard.
  const configuration = (
    <AutomationConfiguration
      organizationId={organizationId}
      automationSlug={automationSlug}
      automation={automation}
      projectId={projectId}
    />
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
    ENVIRONMENT_TAB,
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
    const viewTitle =
      resolveLocalizedProp(view.title, view.i18n, 'title', locale) ??
      view.title;
    const viewDescription = resolveLocalizedProp(
      view.description,
      view.i18n,
      'description',
      locale,
    );
    const viewBody = (
      <VStack gap={4}>
        {viewDescription && <Text variant="muted">{viewDescription}</Text>}
        <ViewBody view={view} />
      </VStack>
    );
    return {
      value: uniqueTabValue(viewId),
      label: viewTitle ?? startCase(viewId),
      content:
        automation.scope === 'project' && projectId === undefined ? (
          <ProjectScopedViewGate
            organizationId={organizationId}
            automationSlug={automationSlug}
            firstViewId={view.id}
          >
            {viewBody}
          </ProjectScopedViewGate>
        ) : (
          viewBody
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
                isAIChatOpen={aiChatOpen}
                onAIChatOpenChange={setAiChatOpen}
                setupIncomplete={setupIncomplete}
              />
            ),
          },
          {
            value: EXECUTIONS_TAB,
            label: t('tabs.executions'),
            content: <ExecutionsTable workflowId={workflowSlug} />,
          },
        ]
      : []),
    ...(showDevTabs && workflowSlug !== undefined
      ? [
          {
            value: TRIGGERS_TAB,
            label: t('tabs.triggers'),
            content: (
              // Lead-in naming WHICH variable bag drives cron runs — the
              // schedule variables edited here, not the Configuration tab's
              // workflow defaults (#2612; Configuration links back here).
              <VStack gap={4}>
                <Text variant="muted" className="text-sm">
                  {t('triggers.scheduleVarsLead')}
                </Text>
                <Triggers
                  workflowId={workflowSlug}
                  organizationId={organizationId}
                  workflowSlug={workflowSlug}
                />
              </VStack>
            ),
          },
          {
            value: ENVIRONMENT_TAB,
            label: t('tabs.environment'),
            // Its own tab, mirroring the Agent settings Environment tab: the
            // same SectionHeader + FormSection chrome, the workflow's env editor
            // (moved out of the Configuration form). Own component so its
            // controller can register into the tab strip's Save/Discard cluster.
            content: (
              <AutomationEnvironmentTab
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
    // Configuration is the automation's settings — the LAST tab, after any
    // bundled views (matching where per-entity settings sit elsewhere).
    {
      value: CONFIGURATION_TAB,
      label: t('tabs.configuration'),
      content: configuration,
    },
  ];
  // An unknown/absent `?tab=` falls back to Configuration for a project-scoped
  // automation on the org route (no `projectId`) — desk views need a project,
  // and Configuration already lists the bound-project entry points. Otherwise
  // the first bundled view when the automation ships one — including for
  // developers (Editor stays one click away). Without views: Editor for a
  // developer with a workflow, else Integrations (where the "Finish setup"
  // banner lives), so a no-workflow automation (e.g. an email inbox) opens on
  // something actionable rather than its last (Configuration) tab. Validated
  // against the tabs actually RENDERED (not `usedTabValues`, which also
  // reserves gated tab values for collision-avoidance even when they aren't
  // shown) — a stale `?tab=editor` from before a role change, or on a
  // non-developer's guessed URL, falls back cleanly instead of selecting a
  // tab that isn't in `tabItems`.
  const renderedTabValues = new Set(tabItems.map((item) => item.value));
  const defaultTab =
    automation.scope === 'project' && projectId === undefined
      ? CONFIGURATION_TAB
      : (viewTabs[0]?.value ?? (showDevTabs ? EDITOR_TAB : INTEGRATIONS_TAB));
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
    dirtyKeys:
      item.value === CONFIGURATION_TAB
        ? CONFIGURATION_TAB_DIRTY_KEYS
        : item.value === ENVIRONMENT_TAB
          ? // The env editor's controller reports 'environment' while its
            // side-table draft is dirty (useEnvEditorController).
            ['environment']
          : undefined,
  }));

  // The tab strip's trailing slot holds only the Finish-setup button (the AI
  // Assistant toggle lives in the editor canvas toolbar). Lifecycle actions
  // (Reinstall / Export / Uninstall) live on the Automations catalog card and,
  // for a project-scoped automation, its Configuration tab.
  const trailingActions = setupIncomplete ? (
    // One warning button (icon-only on small screens) that opens the wizard for
    // the REMAINING integration + agent steps, while setup is incomplete.
    <Button
      variant="warning"
      size="sm"
      icon={Wrench}
      onClick={() => setFinishSetupOpen(true)}
      aria-label={t('install.setup')}
    >
      <span className="hidden sm:inline">{t('install.setup')}</span>
    </Button>
  ) : null;

  const readinessBanner = (only: 'integrations' | 'agents') => (
    <ReadinessSection
      organizationId={organizationId}
      automationSlug={automationSlug}
      status={status}
      blockedIntegrations={blockedIntegrations}
      // The Triggers deep link only exists where the tab does (developer with
      // a workflow); everyone else still sees the gap named in the summary.
      triggersTo={showDevTabs ? basePath : undefined}
      onFinishSetup={() => setFinishSetupOpen(true)}
      only={only}
    />
  );

  return (
    <AutomationRuntimeProvider
      value={{
        organizationId,
        ...(projectId !== undefined && { projectId }),
        ...(typeof project?.name === 'string' && project.name !== ''
          ? { projectName: project.name }
          : {}),
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
            {finishSetupOpen && (
              <AutomationInstallWizard
                open
                onOpenChange={(o) => {
                  if (!o) setFinishSetupOpen(false);
                }}
                organizationId={organizationId}
                automationSlug={automationSlug}
                automationName={display.name}
                scope={automation.scope}
                projectId={projectId}
                requiredIntegrations={automation.requiredIntegrations}
                mode="connect-only"
                initialSlugs={blockedIntegrations}
              />
            )}
            {activeTab === EDITOR_TAB ? (
              /* The Editor is the one full-bleed tab — the canvas fills the
                 page. (Finish-setup lives on the tab-strip button, not a banner
                 over the canvas.) */
              <div className="flex min-h-0 flex-1 flex-col">
                {activeContent}
              </div>
            ) : activeTab === EXECUTIONS_TAB ? (
              /* The executions table brings its own 16px padding (DataTable
                 `p-4`), so it's full-bleed here — otherwise it double-pads. */
              <div className="flex min-h-0 flex-1 flex-col">
                {activeContent}
              </div>
            ) : activeTab === TRIGGERS_TAB || activeTab === INTEGRATIONS_TAB ? (
              /* Triggers and Integrations are full-width operational/catalog
                 views — the integrations grid mirrors the settings catalog
                 layout, so no max-w cap. */
              <ContentArea gap={6} className="px-4 py-4">
                {activeTab === INTEGRATIONS_TAB &&
                  readinessBanner('integrations')}
                {activeContent}
              </ContentArea>
            ) : (
              /* Every other non-editor tab is capped to the same reading width
                 as the Agent settings pages (max-w-3xl) with 16px top padding. */
              <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
                {activeTab === CONFIGURATION_TAB && readinessBanner('agents')}
                {activeContent}
              </ContentArea>
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
    />
  );
}

/**
 * Environment tab body. Its own component (hook rules) so the env editor's
 * controller registers in the active-editor registry only while this tab is
 * mounted — the tab strip's `EditorActions` cluster then drives Save/Discard,
 * replacing the editor's in-content Save button.
 */
function AutomationEnvironmentTab({
  organizationId,
  workflowSlug,
}: {
  organizationId: string;
  workflowSlug: string;
}) {
  const { t: tWorkflows } = useT('workflows');
  const { controller, onEditorState } = useEnvEditorController();
  useRegisterActiveEditor(controller);

  return (
    <>
      <SectionHeader
        title={tWorkflows('configuration.env')}
        description={tWorkflows('configuration.envHelp')}
      />
      <FormSection>
        <WorkflowEnvEditor
          organizationId={organizationId}
          workflowSlug={workflowSlug}
          externalSave
          onEditorState={onEditorState}
        />
      </FormSection>
    </>
  );
}
