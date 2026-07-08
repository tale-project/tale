'use client';

import { Button } from '@tale/ui/button';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { type WizardStepMeta } from '@/app/components/ui/wizard/use-wizard';
import { Wizard, WizardStep } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { WizardLoadingSkeleton } from '@/app/components/ui/wizard/wizard-loading-skeleton';
import { WizardProgress } from '@/app/components/ui/wizard/wizard-progress';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { AutomationScope } from '@/lib/shared/schemas/automations';

import {
  type AgentAuthMode,
  type AgentReadiness,
  type RequiredProvider,
  authModeOf,
  isExternalAgent,
  readAgentsResult,
} from '../../hooks/use-automation-agent-readiness';
import {
  type AutomationInstallPreview,
  isInstallOverridesError,
  useAutomationInstallActions,
} from '../../hooks/use-install-state';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../../hooks/use-required-integrations';
import { AgentSecretsStep } from './agent-secrets-step';
import { AuthModeStep } from './auth-mode-step';
import { ConnectIntegrationStep } from './connect-integration-step';
import { ConnectProviderStep } from './connect-provider-step';
import { ReviewOverridesStep } from './review-overrides-step';

export interface AutomationInstallWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired once the install commits (before the still-optional setup steps), so
   * a caller that opened the wizard from a preview surface (the catalog detail
   * panel) can dismiss that now-stale "Install" surface instead of leaving it
   * behind the finished wizard.
   */
  onInstalled?: () => void;
  organizationId: string;
  automationSlug: string;
  automationName: string;
  scope: AutomationScope;
  /** Pre-bound project (a project-scoped automation opened from inside its project). */
  projectId?: string;
  /** Candidate required integrations (install mode) = the automation's requires.integrations. */
  requiredIntegrations: readonly string[];
  /**
   * 'install' (default): full flow — project? → install → agents → integrations → done.
   * 'connect-only': the automation is already installed (automation-page readiness checklist) —
   * skip the project + install steps and finish setup (agents + `initialSlugs`).
   */
  mode?: 'install' | 'connect-only';
  initialSlugs?: readonly string[];
}

/**
 * Inline install + setup wizard. Installs the automation, then walks everything it needs
 * before it can run — each unconnected required integration, each external
 * agent's auth mode (managed vs BYO), the provider keys managed agents need, and
 * the secrets BYO agents need — all in the dialog. Guided but non-blocking: every
 * setup step is skippable and the automation-page readiness checklist is the fallback.
 */
export function AutomationInstallWizard(props: AutomationInstallWizardProps) {
  // Radix keeps content mounted during the close animation; bail before hooks
  // run so they don't fight usePresence (see Dialog docs).
  if (!props.open) return null;
  return <AutomationInstallWizardContent {...props} />;
}

function AutomationInstallWizardContent({
  open,
  onOpenChange,
  onInstalled,
  organizationId,
  automationSlug,
  automationName,
  scope,
  projectId,
  requiredIntegrations,
  mode = 'install',
  initialSlugs,
}: AutomationInstallWizardProps) {
  const { t } = useT('automations');
  const candidateSlugs = useMemo(
    () =>
      mode === 'connect-only' ? (initialSlugs ?? []) : requiredIntegrations,
    [mode, initialSlugs, requiredIntegrations],
  );
  const { required, blockedSlugs, isLoading } = useRequiredIntegrations(
    organizationId,
    candidateSlugs,
  );
  const { preview: fetchPreview } = useAutomationInstallActions(organizationId);

  // Snapshot WHICH integrations get a connect step exactly once (after load), so
  // steps don't vanish mid-flow as the user connects them.
  const [stepSlugs, setStepSlugs] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isLoading && stepSlugs === null) {
      setStepSlugs(
        mode === 'connect-only' ? [...candidateSlugs] : blockedSlugs,
      );
    }
  }, [isLoading, stepSlugs, blockedSlugs, candidateSlugs, mode]);

  // Snapshot the install preflight exactly once (same pattern as `stepSlugs`)
  // so the review step doesn't appear/vanish mid-flow. Connect-only mode never
  // installs, so it needs no preview; a failed preview degrades to "no review
  // step" — the server re-checks and rejects unconfirmed overrides anyway.
  const [preview, setPreview] = useState<AutomationInstallPreview | null>(
    mode === 'connect-only' ? { entries: [], overrides: [] } : null,
  );
  useEffect(() => {
    if (mode === 'connect-only' || preview !== null) return undefined;
    let cancelled = false;
    void fetchPreview(automationSlug)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        console.warn('[AutomationInstallWizard] install preview failed:', err);
        if (!cancelled) setPreview({ entries: [], overrides: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, preview, automationSlug]);

  if (stepSlugs === null || preview === null) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('installWizard.title', { name: automationName })}
        size="md"
      >
        <WizardLoadingSkeleton />
      </Dialog>
    );
  }

  return (
    <AutomationInstallWizardBody
      open={open}
      onOpenChange={onOpenChange}
      onInstalled={onInstalled}
      organizationId={organizationId}
      automationSlug={automationSlug}
      automationName={automationName}
      scope={scope}
      projectId={projectId}
      mode={mode}
      stepSlugs={stepSlugs}
      required={required}
      preview={preview}
    />
  );
}

function AutomationInstallWizardBody({
  open,
  onOpenChange,
  onInstalled,
  organizationId,
  automationSlug,
  automationName,
  scope,
  projectId,
  mode,
  stepSlugs,
  required,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled?: () => void;
  organizationId: string;
  automationSlug: string;
  automationName: string;
  scope: AutomationScope;
  projectId?: string;
  mode: 'install' | 'connect-only';
  stepSlugs: string[];
  required: RequiredIntegration[];
  /** Install preflight snapshot (empty in connect-only mode). */
  preview: AutomationInstallPreview;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { projects } = useProjects(organizationId);
  const { install } = useAutomationInstallActions(organizationId);
  const fetchAgentReadiness = useConvexAction(
    api.automations.agent_readiness.getAutomationAgentReadiness,
  );
  const setAuthMode = useConvexAction(api.agents.file_actions.setAgentAuthMode);

  const requiredBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r])),
    [required],
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  // Which required integrations the user actually connected DURING this wizard.
  // Each ConnectIntegrationStep reports up; this is the Done screen's source of
  // truth, since the reactive required-integrations query can lag an in-wizard
  // connect (it's an action query, not a live subscription).
  const [connectedSlugs, setConnectedSlugs] = useState<Record<string, boolean>>(
    {},
  );
  const handleConnectedChange = useCallback(
    (slug: string, connected: boolean) => {
      setConnectedSlugs((prev) =>
        prev[slug] === connected ? prev : { ...prev, [slug]: connected },
      );
    },
    [],
  );

  // Agent setup is known only after the automation is installed (its agent configs are
  // copied then). Snapshot the agents once, and track per-external-agent mode.
  const [agentSnapshot, setAgentSnapshot] = useState<AgentReadiness[] | null>(
    null,
  );
  const [modeChoices, setModeChoices] = useState<Record<string, AgentAuthMode>>(
    {},
  );

  const applyAgents = (agents: AgentReadiness[]) => {
    setAgentSnapshot(agents);
    setModeChoices(
      Object.fromEntries(
        agents.filter(isExternalAgent).map((a) => [a.agentSlug, authModeOf(a)]),
      ),
    );
  };

  // connect-only: the automation is already installed → load agent setup on open.
  useEffect(() => {
    if (mode !== 'connect-only' || agentSnapshot !== null) return undefined;
    let cancelled = false;
    void fetchAgentReadiness
      .mutateAsync({ organizationId, automationSlug: automationSlug })
      .then((r) => {
        if (cancelled) return;
        applyAgents(readAgentsResult(r));
      })
      .catch((err) => {
        console.warn(
          '[AutomationInstallWizard] agent readiness load failed:',
          err,
        );
        if (!cancelled) setAgentSnapshot([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, agentSnapshot, organizationId, automationSlug]);

  const externalAgents = useMemo(
    () => (agentSnapshot ?? []).filter(isExternalAgent),
    [agentSnapshot],
  );

  // Effective mode per agent (the chosen toggle, or its current default).
  const effMode = (a: AgentReadiness): AgentAuthMode =>
    isExternalAgent(a)
      ? (modeChoices[a.agentSlug] ?? authModeOf(a))
      : 'managed';
  const needsProvider = (a: AgentReadiness): boolean => {
    if (a.mode === 'internal' || a.mode === 'image') return true;
    if (!isExternalAgent(a)) return false;
    if (effMode(a) === 'byo') return false;
    return a.mode === 'external-gateway-managed';
  };
  const needsEnv = (a: AgentReadiness): boolean => {
    if (!isExternalAgent(a)) return false;
    if (effMode(a) === 'byo') return true;
    return a.mode === 'external-env-managed';
  };

  // Providers to connect: distinct, exist-but-unkeyed providers that a
  // not-yet-resolvable provider+model agent needs under its chosen mode.
  const providersToConnect = useMemo<RequiredProvider[]>(() => {
    const map = new Map<string, RequiredProvider>();
    for (const a of agentSnapshot ?? []) {
      if (!needsProvider(a) || a.supportedModelsResolvable) continue;
      for (const p of a.requiredProviders) {
        if (p.exists && !p.hasKey && !map.has(p.name)) map.set(p.name, p);
      }
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSnapshot, modeChoices]);

  const byoAgents = useMemo<AgentReadiness[]>(
    () =>
      (agentSnapshot ?? []).filter(
        (a) => needsEnv(a) && a.requiredEnv.some((e) => !e.set),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentSnapshot, modeChoices],
  );

  const needsProjectStep =
    mode === 'install' && scope === 'project' && !projectId;
  const hasInstallStep = mode === 'install';
  // The override-review step precedes install whenever the preflight found
  // files the install would overwrite; its checkbox gates Next.
  const overrideEntries = useMemo(
    () => preview.entries.filter((e) => e.status === 'override'),
    [preview],
  );
  const hasReviewStep = hasInstallStep && preview.overrides.length > 0;
  const [overridesConfirmed, setOverridesConfirmed] = useState(false);

  const labelFor = (slug: string) =>
    requiredBySlug.get(slug)?.integration.title ?? slug;

  const steps = useMemo<WizardStepMeta[]>(() => {
    const list: WizardStepMeta[] = [];
    if (needsProjectStep) {
      list.push({ id: 'project', label: t('installWizard.projectStepLabel') });
    }
    if (hasReviewStep) {
      list.push({
        id: 'review-overrides',
        label: t('installWizard.reviewStepLabel'),
      });
    }
    if (hasInstallStep) {
      list.push({ id: 'install', label: t('installWizard.installStepLabel') });
    }
    if (externalAgents.length > 0) {
      list.push({
        id: 'auth-mode',
        label: t('installWizard.authModeStepLabel'),
      });
    }
    for (const p of providersToConnect) {
      list.push({
        id: `provider-${p.name}`,
        label: p.displayName ?? p.name,
        optional: true,
      });
    }
    for (const a of byoAgents) {
      list.push({
        id: `agent-env-${a.agentSlug}`,
        label: a.displayName,
        optional: true,
      });
    }
    for (const slug of stepSlugs) {
      list.push({
        id: `connect-${slug}`,
        label: labelFor(slug),
        optional: true,
      });
    }
    list.push({ id: 'done', label: t('installWizard.doneStepLabel') });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    needsProjectStep,
    hasReviewStep,
    hasInstallStep,
    externalAgents,
    providersToConnect,
    byoAgents,
    stepSlugs,
    requiredBySlug,
    t,
  ]);

  const targetProjectId =
    scope === 'project'
      ? (projectId ?? selectedProjectId ?? undefined)
      : undefined;

  const doInstall = async (): Promise<boolean> => {
    try {
      // Pass the confirmed override keys only when the review step was shown
      // AND ticked — never a blanket confirmation the user didn't see.
      await install(
        automationSlug,
        targetProjectId,
        hasReviewStep && overridesConfirmed ? preview.overrides : undefined,
      );
    } catch (err) {
      if (isInstallOverridesError(err)) {
        // Race: the disk changed after the preview, so the confirmation is
        // stale. Stay on the step; the operator re-runs the wizard to re-review.
        toast({
          title: t('installWizard.overridesChanged'),
          variant: 'destructive',
        });
        return false;
      }
      toast({
        title: t('installWizard.installFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      return false;
    }
    // The install committed — let a preview surface (catalog panel) dismiss its
    // now-stale "Install" affordance even if the operator later cancels the
    // remaining optional setup steps.
    onInstalled?.();
    // The automation's agent configs now exist — load their setup needs before advancing.
    try {
      const r = await fetchAgentReadiness.mutateAsync({
        organizationId,
        automationSlug: automationSlug,
      });
      applyAgents(readAgentsResult(r));
    } catch (err) {
      console.warn(
        '[AutomationInstallWizard] agent readiness load failed:',
        err,
      );
      setAgentSnapshot([]);
    }
    return true;
  };

  const onChangeMode = (agentSlug: string, nextMode: AgentAuthMode) => {
    setModeChoices((prev) => ({ ...prev, [agentSlug]: nextMode }));
    // Persist so the runtime honors the choice; best-effort.
    void setAuthMode
      .mutateAsync({ organizationId, agentName: agentSlug, authMode: nextMode })
      .catch((err) => {
        console.warn('[AutomationInstallWizard] setAgentAuthMode failed:', err);
      });
  };

  const handleFinish = () => {
    onOpenChange(false);
    // Land on the automation's ORG-level detail page — the same target the
    // catalog card opens. The project-nested route wraps the detail in the
    // project layout's own PageLayout + ContentArea, doubling the page padding.
    if (mode === 'install') {
      void navigate({
        to: '/dashboard/$id/automations/$automationSlug',
        params: { id: organizationId, automationSlug },
      });
    }
  };

  // Required integrations left unconnected at finish BLOCK the automation from
  // running — the Done screen must not claim it's "ready" when any remain.
  const unconnectedRequired = stepSlugs.filter((slug) => !connectedSlugs[slug]);
  const hasRequiredSkips = unconnectedRequired.length > 0;
  // Everything still outstanding at finish (required + optional providers/BYO
  // agents) → the "some skipped" summary copy.
  const skippedCount =
    unconnectedRequired.length + providersToConnect.length + byoAgents.length;

  // connect-only loads agent readiness up front (effect above), and the agent
  // steps sit ahead of the integration-connect steps. Rendering before it
  // resolves would commit a steps array missing those agent steps, so step 0
  // shows the connect-integration step for a frame, then flips to the agent
  // step once the snapshot lands. Hold the skeleton until it's ready.
  if (mode === 'connect-only' && agentSnapshot === null) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('installWizard.title', { name: automationName })}
        size="md"
      >
        <WizardLoadingSkeleton />
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('installWizard.title', { name: automationName })}
      size="md"
    >
      <Wizard
        steps={steps}
        onFinish={handleFinish}
        formatProgress={(current, total, label) =>
          t('installWizard.progress', { current, total, label })
        }
      >
        <WizardProgress
          segmented
          ariaLabel={t('installWizard.stepsAriaLabel')}
        />

        {needsProjectStep && (
          <WizardStep id="project" valid={selectedProjectId !== null}>
            <VStack gap={3}>
              <Text variant="muted" className="text-sm">
                {t('install.chooseProjectDescription')}
              </Text>
              <SearchableSelect
                aria-label={t('install.projectLabel')}
                placeholder={t('install.projectPlaceholder')}
                searchPlaceholder={t('install.projectSearchPlaceholder')}
                emptyText={t('install.noProjects')}
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
                options={projects.map((p) => ({ value: p._id, label: p.name }))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Plus}
                className="self-start"
                onClick={() => setCreateOpen(true)}
              >
                {t('install.createProject')}
              </Button>
            </VStack>
          </WizardStep>
        )}

        {hasReviewStep && (
          <ReviewOverridesStep
            entries={overrideEntries}
            confirmed={overridesConfirmed}
            onConfirmedChange={setOverridesConfirmed}
          />
        )}

        {hasInstallStep && (
          <WizardStep id="install" onBeforeNext={doInstall}>
            <VStack gap={2}>
              <Text className="text-sm font-medium">
                {t('installWizard.installReady', { name: automationName })}
              </Text>
              {stepSlugs.length > 0 && (
                <Text variant="muted" className="text-sm">
                  {t('installWizard.installNeeds', {
                    integrations: stepSlugs.map(labelFor).join(', '),
                  })}
                </Text>
              )}
            </VStack>
          </WizardStep>
        )}

        {externalAgents.length > 0 && (
          <AuthModeStep
            externalAgents={externalAgents}
            modeChoices={modeChoices}
            onChange={onChangeMode}
          />
        )}

        {providersToConnect.map((p) => (
          <ConnectProviderStep
            key={p.name}
            provider={p}
            organizationId={organizationId}
          />
        ))}

        {byoAgents.map((a) => (
          <AgentSecretsStep
            key={a.agentSlug}
            agent={a}
            organizationId={organizationId}
          />
        ))}

        {stepSlugs.map((slug) => {
          const r = requiredBySlug.get(slug);
          if (!r) return null;
          return (
            <ConnectIntegrationStep
              key={slug}
              required={r}
              organizationId={organizationId}
              onConnectedChange={handleConnectedChange}
            />
          );
        })}

        <WizardStep id="done">
          <VStack gap={1}>
            <Text className="text-sm font-medium">
              {hasRequiredSkips
                ? t('installWizard.doneNeedsSetupTitle', {
                    name: automationName,
                  })
                : t('installWizard.doneTitle', { name: automationName })}
            </Text>
            <Text variant="muted" className="text-sm">
              {hasRequiredSkips
                ? t('installWizard.doneNeedsSetup')
                : skippedCount > 0
                  ? t('installWizard.doneSomeSkipped')
                  : t('installWizard.doneAllConnected')}
            </Text>
          </VStack>
        </WizardStep>

        <WizardFooter
          backLabel={tCommon('actions.back')}
          nextLabel={tCommon('actions.next')}
          finishLabel={t('installWizard.finish')}
          skipLabel={t('installWizard.skipForNow')}
        />
      </Wizard>

      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        navigateOnCreate={false}
        onCreated={(id) => setSelectedProjectId(String(id))}
      />
    </Dialog>
  );
}
