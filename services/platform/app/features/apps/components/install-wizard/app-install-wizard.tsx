'use client';

import { Button } from '@tale/ui/button';
import { VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { type WizardStepMeta } from '@/app/components/ui/wizard/use-wizard';
import { Wizard, WizardStep } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { WizardProgress } from '@/app/components/ui/wizard/wizard-progress';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { AppScope } from '@/lib/shared/schemas/apps';

import {
  type AgentAuthMode,
  type AgentReadiness,
  type RequiredProvider,
  authModeOf,
  isExternalAgent,
  readAgentsResult,
} from '../../hooks/use-app-agent-readiness';
import { useAppInstallActions } from '../../hooks/use-install-state';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../../hooks/use-required-integrations';
import { AgentSecretsStep } from './agent-secrets-step';
import { AuthModeStep } from './auth-mode-step';
import { ConnectIntegrationStep } from './connect-integration-step';
import { ConnectProviderStep } from './connect-provider-step';

export interface AppInstallWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  appSlug: string;
  appName: string;
  scope: AppScope;
  /** Pre-bound project (a project-scoped app opened from inside its project). */
  projectId?: string;
  /** Candidate required integrations (install mode) = the app's requires.integrations. */
  requiredIntegrations: readonly string[];
  /**
   * 'install' (default): full flow — project? → install → agents → integrations → done.
   * 'connect-only': the app is already installed (app-page readiness checklist) —
   * skip the project + install steps and finish setup (agents + `initialSlugs`).
   */
  mode?: 'install' | 'connect-only';
  initialSlugs?: readonly string[];
}

/**
 * Inline install + setup wizard. Installs the app, then walks everything it needs
 * before it can run — each unconnected required integration, each external
 * agent's auth mode (managed vs BYO), the provider keys managed agents need, and
 * the secrets BYO agents need — all in the dialog. Guided but non-blocking: every
 * setup step is skippable and the app-page readiness checklist is the fallback.
 */
export function AppInstallWizard(props: AppInstallWizardProps) {
  // Radix keeps content mounted during the close animation; bail before hooks
  // run so they don't fight usePresence (see Dialog docs).
  if (!props.open) return null;
  return <AppInstallWizardContent {...props} />;
}

function AppInstallWizardContent({
  open,
  onOpenChange,
  organizationId,
  appSlug,
  appName,
  scope,
  projectId,
  requiredIntegrations,
  mode = 'install',
  initialSlugs,
}: AppInstallWizardProps) {
  const { t } = useT('apps');
  const candidateSlugs = useMemo(
    () =>
      mode === 'connect-only' ? (initialSlugs ?? []) : requiredIntegrations,
    [mode, initialSlugs, requiredIntegrations],
  );
  const { required, blockedSlugs, isLoading } = useRequiredIntegrations(
    organizationId,
    candidateSlugs,
  );

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

  if (stepSlugs === null) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('installWizard.title', { name: appName })}
        size="md"
      >
        <SkeletonText lines={4} />
      </Dialog>
    );
  }

  return (
    <AppInstallWizardBody
      open={open}
      onOpenChange={onOpenChange}
      organizationId={organizationId}
      appSlug={appSlug}
      appName={appName}
      scope={scope}
      projectId={projectId}
      mode={mode}
      stepSlugs={stepSlugs}
      required={required}
    />
  );
}

function AppInstallWizardBody({
  open,
  onOpenChange,
  organizationId,
  appSlug,
  appName,
  scope,
  projectId,
  mode,
  stepSlugs,
  required,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  appSlug: string;
  appName: string;
  scope: AppScope;
  projectId?: string;
  mode: 'install' | 'connect-only';
  stepSlugs: string[];
  required: RequiredIntegration[];
}) {
  const { t } = useT('apps');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { projects } = useProjects(organizationId);
  const { install } = useAppInstallActions(organizationId);
  const fetchAgentReadiness = useConvexAction(
    api.apps.agent_readiness.getAppAgentReadiness,
  );
  const setAuthMode = useConvexAction(api.agents.file_actions.setAgentAuthMode);

  const requiredBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r])),
    [required],
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [createOpen, setCreateOpen] = useState(false);

  // Agent setup is known only after the app is installed (its agent configs are
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

  // connect-only: the app is already installed → load agent setup on open.
  useEffect(() => {
    if (mode !== 'connect-only' || agentSnapshot !== null) return undefined;
    let cancelled = false;
    void fetchAgentReadiness
      .mutateAsync({ organizationId, appSlug })
      .then((r) => {
        if (cancelled) return;
        applyAgents(readAgentsResult(r));
      })
      .catch((err) => {
        console.warn('[AppInstallWizard] agent readiness load failed:', err);
        if (!cancelled) setAgentSnapshot([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, agentSnapshot, organizationId, appSlug]);

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

  const labelFor = (slug: string) =>
    requiredBySlug.get(slug)?.integration.title ?? slug;

  const steps = useMemo<WizardStepMeta[]>(() => {
    const list: WizardStepMeta[] = [];
    if (needsProjectStep) {
      list.push({ id: 'project', label: t('installWizard.projectStepLabel') });
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
      await install(appSlug, targetProjectId);
    } catch (err) {
      toast({
        title: t('installWizard.installFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      return false;
    }
    // The app's agent configs now exist — load their setup needs before advancing.
    try {
      const r = await fetchAgentReadiness.mutateAsync({
        organizationId,
        appSlug,
      });
      applyAgents(readAgentsResult(r));
    } catch (err) {
      console.warn('[AppInstallWizard] agent readiness load failed:', err);
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
        console.warn('[AppInstallWizard] setAgentAuthMode failed:', err);
      });
  };

  const handleFinish = () => {
    onOpenChange(false);
    if (mode === 'install' && scope === 'project' && targetProjectId) {
      void navigate({
        to: '/dashboard/$id/projects/$projectId/apps/$appSlug',
        params: { id: organizationId, projectId: targetProjectId, appSlug },
      });
    }
  };

  // What's still outstanding at finish → "some skipped" summary copy.
  const skippedCount =
    stepSlugs.filter((slug) => !requiredBySlug.get(slug)?.connected).length +
    providersToConnect.length +
    byoAgents.length;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('installWizard.title', { name: appName })}
      size="md"
    >
      <Wizard
        steps={steps}
        onFinish={handleFinish}
        formatProgress={(current, total, label) =>
          t('installWizard.progress', { current, total, label })
        }
      >
        <WizardProgress ariaLabel={t('installWizard.stepsAriaLabel')} />

        {needsProjectStep && (
          <WizardStep id="project" valid={selectedProjectId !== null}>
            <VStack gap={3}>
              <Text variant="muted" className="text-sm">
                {t('install.chooseProjectDescription')}
              </Text>
              <SearchableSelect
                label={t('install.projectLabel')}
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

        {hasInstallStep && (
          <WizardStep id="install" onBeforeNext={doInstall}>
            <VStack gap={2}>
              <Text className="text-sm font-medium">
                {t('installWizard.installReady', { name: appName })}
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
            />
          );
        })}

        <WizardStep id="done">
          <VStack gap={1}>
            <Text className="text-sm font-medium">
              {t('installWizard.doneTitle', { name: appName })}
            </Text>
            <Text variant="muted" className="text-sm">
              {skippedCount > 0
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
