'use client';

/**
 * Bundle-aware install wizard: installs every member of a bundle (an
 * automation.json declaring `bundle.members` — see
 * `lib/shared/schemas/automations.ts#automationManifestSchema`) through ONE aggregated
 * flow, calling `installBundle` exactly once. Deliberately a THIN wrapper
 * around the same step components the single-automation `AutomationInstallWizard`
 * uses (`AuthModeStep`/`ConnectProviderStep`/`AgentSecretsStep`/
 * `ConnectIntegrationStep`) — they already render over arbitrary arrays, so
 * they're reused unchanged; only the bundle-specific aggregation (deduped
 * integration union, concatenated agent arrays, per-member override review)
 * is new, in `BundleReviewOverridesStep` and this file.
 *
 * Members are HIDDEN automations (never listed by `listAutomations`/
 * `listCatalogAutomations`), so `previewBundleInstall` is this wizard's only
 * pre-install read of their display name / `requires.integrations` — it is
 * the sole source for both, rather than the hub's usual catalog hooks.
 */
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
  missingScheduleFieldsOf,
  readScheduleReadinessResult,
} from '../../hooks/use-automation-schedule-readiness';
import {
  type BundleMemberInstallPreview,
  isInstallOverridesError,
  useBundleInstallActions,
} from '../../hooks/use-install-state';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../../hooks/use-required-integrations';
import { AgentSecretsStep } from './agent-secrets-step';
import { AuthModeStep } from './auth-mode-step';
import {
  type BundleMemberOverrides,
  BundleReviewOverridesStep,
} from './bundle-review-overrides-step';
import { ConnectIntegrationStep } from './connect-integration-step';
import { ConnectProviderStep } from './connect-provider-step';
import { firstViewIdFromPreviewEntries } from './first-view-id';

export interface BundleInstallWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once the bundle install commits — see `AutomationInstallWizard`. */
  onInstalled?: () => void;
  organizationId: string;
  bundleSlug: string;
  bundleName: string;
  scope: AutomationScope;
  /** Pre-bound project (a project-scoped bundle opened from inside its project). */
  projectId?: string;
}

/** Deduped union of every member's `requires.integrations`, in first-seen order. */
function unionIntegrations(
  previews: readonly BundleMemberInstallPreview[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of previews) {
    for (const slug of p.requiredIntegrations) {
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(slug);
      }
    }
  }
  return out;
}

export function BundleInstallWizard(props: BundleInstallWizardProps) {
  // Radix keeps content mounted during the close animation; bail before hooks
  // run so they don't fight usePresence (mirrors `AutomationInstallWizard`).
  if (!props.open) return null;
  return <BundleInstallWizardContent {...props} />;
}

function BundleInstallWizardContent({
  open,
  onOpenChange,
  onInstalled,
  organizationId,
  bundleSlug,
  bundleName,
  scope,
  projectId,
}: BundleInstallWizardProps) {
  const { t } = useT('automations');
  const { previewBundle } = useBundleInstallActions(organizationId);

  // Snapshot the preview exactly once (same pattern as the single-automation
  // wizard) so steps don't appear/vanish mid-flow.
  const [preview, setPreview] = useState<BundleMemberInstallPreview[] | null>(
    null,
  );
  useEffect(() => {
    if (preview !== null) return undefined;
    let cancelled = false;
    void previewBundle(bundleSlug)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        console.warn('[BundleInstallWizard] preview failed:', err);
        if (!cancelled) setPreview([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleSlug]);

  const requiredIntegrationSlugs = useMemo(
    () => unionIntegrations(preview ?? []),
    [preview],
  );
  const { required, blockedSlugs, isLoading } = useRequiredIntegrations(
    organizationId,
    requiredIntegrationSlugs,
  );

  const [stepSlugs, setStepSlugs] = useState<string[] | null>(null);
  useEffect(() => {
    if (preview !== null && !isLoading && stepSlugs === null) {
      setStepSlugs([...blockedSlugs]);
    }
  }, [preview, isLoading, stepSlugs, blockedSlugs]);

  if (preview === null || stepSlugs === null) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('installWizard.title', { name: bundleName })}
        size="md"
      >
        <WizardLoadingSkeleton />
      </Dialog>
    );
  }

  return (
    <BundleInstallWizardBody
      open={open}
      onOpenChange={onOpenChange}
      onInstalled={onInstalled}
      organizationId={organizationId}
      bundleSlug={bundleSlug}
      bundleName={bundleName}
      scope={scope}
      projectId={projectId}
      preview={preview}
      stepSlugs={stepSlugs}
      required={required}
    />
  );
}

function BundleInstallWizardBody({
  open,
  onOpenChange,
  onInstalled,
  organizationId,
  bundleSlug,
  bundleName,
  scope,
  projectId,
  preview,
  stepSlugs,
  required,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled?: () => void;
  organizationId: string;
  bundleSlug: string;
  bundleName: string;
  scope: AutomationScope;
  projectId?: string;
  preview: BundleMemberInstallPreview[];
  stepSlugs: string[];
  required: RequiredIntegration[];
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { projects } = useProjects(organizationId);
  const { install } = useBundleInstallActions(organizationId);
  const fetchAgentReadiness = useConvexAction(
    api.automations.agent_readiness.getAutomationAgentReadiness,
  );
  const fetchScheduleReadiness = useConvexAction(
    api.automations.schedule_readiness.getAutomationScheduleReadiness,
  );
  const setAuthMode = useConvexAction(api.agents.file_actions.setAgentAuthMode);

  const requiredBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r])),
    [required],
  );
  const labelFor = (slug: string) =>
    requiredBySlug.get(slug)?.integration.title ?? slug;

  // Agent setup is known only once every member is installed (their agent
  // configs are copied then). Agent slugs are globally unique `<member>/<name>`
  // (the automation-scoped composite), so concatenating each member's readiness
  // array is safe with no collision.
  const [agentSnapshot, setAgentSnapshot] = useState<AgentReadiness[] | null>(
    null,
  );
  const [modeChoices, setModeChoices] = useState<Record<string, AgentAuthMode>>(
    {},
  );
  // Members whose ACTIVE schedules still leave required variables blank (known
  // once installed) — the Done step names them instead of claiming ready, and
  // its Triggers link opens the first one (#2611). `null` = not loaded.
  const [memberScheduleGaps, setMemberScheduleGaps] = useState<
    | { automationSlug: string; automationName: string; fields: string[] }[]
    | null
  >(null);
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
  const applyAgents = (agents: AgentReadiness[]) => {
    setAgentSnapshot(agents);
    setModeChoices(
      Object.fromEntries(
        agents.filter(isExternalAgent).map((a) => [a.agentSlug, authModeOf(a)]),
      ),
    );
  };

  const externalAgents = useMemo(
    () => (agentSnapshot ?? []).filter(isExternalAgent),
    [agentSnapshot],
  );
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

  // Per-member override review: only members whose preview found an
  // `override`-status file. Confirming member A never confirms member B —
  // each is namespaced by automationSlug.
  const overrideMembers = useMemo<BundleMemberOverrides[]>(
    () =>
      preview
        .map((p) => ({
          automationSlug: p.automationSlug,
          automationName: p.automationName,
          entries: p.entries.filter((e) => e.status === 'override'),
        }))
        .filter((m) => m.entries.length > 0),
    [preview],
  );
  const hasReviewStep = overrideMembers.length > 0;
  const [confirmedAutomations, setConfirmedAutomations] = useState(
    new Set<string>(),
  );
  const onConfirmedChange = (automationSlug: string, confirmed: boolean) => {
    setConfirmedAutomations((prev) => {
      const next = new Set(prev);
      if (confirmed) next.add(automationSlug);
      else next.delete(automationSlug);
      return next;
    });
  };

  const needsProjectStep = scope === 'project' && !projectId;
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const targetProjectId =
    scope === 'project'
      ? (projectId ?? selectedProjectId ?? undefined)
      : undefined;

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
    list.push({ id: 'install', label: t('installWizard.installStepLabel') });
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
    externalAgents,
    providersToConnect,
    byoAgents,
    stepSlugs,
    requiredBySlug,
    t,
  ]);

  const doInstall = async (): Promise<boolean> => {
    try {
      const confirmedOverridesByAutomation = Object.fromEntries(
        overrideMembers
          .filter((m) => confirmedAutomations.has(m.automationSlug))
          .map((m) => [
            m.automationSlug,
            m.entries.map((e) => `${e.domain}:${e.path}`),
          ]),
      );
      const result = await install(
        bundleSlug,
        targetProjectId,
        confirmedOverridesByAutomation,
      );
      const failed = result.members.filter((m) => !m.ok);
      if (failed.length > 0) {
        toast({
          title: t('installWizard.bundleMembersFailed', {
            count: failed.length,
          }),
          description: failed.map((m) => m.automationSlug).join(', '),
          variant: 'destructive',
        });
      }
    } catch (err) {
      if (isInstallOverridesError(err)) {
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

    // The bundle install committed — let a preview surface (catalog panel)
    // dismiss its now-stale "Install" affordance.
    onInstalled?.();

    // Concatenate every member's agent readiness — each call is independent
    // and their agent slugs (`<member>/<name>`) can never collide.
    const agentLists = await Promise.all(
      preview.map((p) =>
        fetchAgentReadiness
          .mutateAsync({ organizationId, automationSlug: p.automationSlug })
          .then(readAgentsResult)
          .catch((err) => {
            console.warn(
              `[BundleInstallWizard] agent readiness load failed for "${p.automationSlug}":`,
              err,
            );
            return [] as AgentReadiness[];
          }),
      ),
    );
    applyAgents(agentLists.flat());

    // Each member's schedules now exist too — collect the required schedule
    // variables still blank, so the Done step can name the members that need
    // schedule config instead of claiming everything is ready (#2611).
    const gapLists = await Promise.all(
      preview.map((p) =>
        fetchScheduleReadiness
          .mutateAsync({ organizationId, automationSlug: p.automationSlug })
          .then((r) => ({
            automationSlug: p.automationSlug,
            automationName: p.automationName,
            fields: missingScheduleFieldsOf(readScheduleReadinessResult(r)),
          }))
          .catch((err) => {
            console.warn(
              `[BundleInstallWizard] schedule readiness load failed for "${p.automationSlug}":`,
              err,
            );
            return {
              automationSlug: p.automationSlug,
              automationName: p.automationName,
              fields: [] as string[],
            };
          }),
      ),
    );
    setMemberScheduleGaps(gapLists.filter((m) => m.fields.length > 0));
    return true;
  };

  const onChangeMode = (agentSlug: string, nextMode: AgentAuthMode) => {
    setModeChoices((prev) => ({ ...prev, [agentSlug]: nextMode }));
    void setAuthMode
      .mutateAsync({ organizationId, agentName: agentSlug, authMode: nextMode })
      .catch((err) => {
        console.warn('[BundleInstallWizard] setAgentAuthMode failed:', err);
      });
  };

  const handleFinish = () => {
    onOpenChange(false);
    // No single "bundle page" exists (each member is its own automation) — land
    // on the first member's detail. Prefer the project-nested URL when a
    // project was selected (or pre-bound); otherwise the org-level page the
    // catalog opens. Project-nested detail routes bare-outlet under
    // Automations chrome (no project-shell padding). Open the first member's
    // first view tab when it ships views.
    const first = preview[0];
    if (first) {
      const finishProjectId = projectId ?? selectedProjectId;
      const firstViewId = firstViewIdFromPreviewEntries(first.entries);
      const search = firstViewId !== undefined ? { tab: firstViewId } : {};
      if (finishProjectId) {
        void navigate({
          to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
          params: {
            id: organizationId,
            projectId: finishProjectId,
            automationSlug: first.automationSlug,
          },
          search,
        });
      } else {
        void navigate({
          to: '/dashboard/$id/automations/$automationSlug',
          params: {
            id: organizationId,
            automationSlug: first.automationSlug,
          },
          search,
        });
      }
    }
  };

  // Deep link into the first gap member's Triggers tab (`?tab=triggers`),
  // where its schedule variables are edited.
  const openTriggers = () => {
    const target = (memberScheduleGaps ?? [])[0];
    if (!target) return;
    onOpenChange(false);
    void navigate({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: organizationId, automationSlug: target.automationSlug },
      search: { tab: 'triggers' },
    });
  };

  // Required integrations left unconnected at finish BLOCK the bundle from
  // running — the Done screen must not claim it's "ready" when any remain.
  const unconnectedRequired = stepSlugs.filter((slug) => !connectedSlugs[slug]);
  const hasRequiredSkips = unconnectedRequired.length > 0;
  const skippedCount =
    unconnectedRequired.length + providersToConnect.length + byoAgents.length;
  // Members whose active schedules still miss required variables — cron runs
  // fail on them, so Done must name each member and its gaps (#2611).
  const membersNeedingTriggers = memberScheduleGaps ?? [];
  const hasScheduleGaps = membersNeedingTriggers.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('installWizard.title', { name: bundleName })}
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

        {hasReviewStep && (
          <BundleReviewOverridesStep
            members={overrideMembers}
            confirmedAutomations={confirmedAutomations}
            onConfirmedChange={onConfirmedChange}
          />
        )}

        <WizardStep id="install" onBeforeNext={doInstall}>
          <VStack gap={2}>
            <Text className="text-sm font-medium">
              {t('installWizard.bundleInstallReady', {
                name: bundleName,
                count: preview.length,
              })}
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
          <VStack gap={2}>
            <Text className="text-sm font-medium">
              {hasRequiredSkips || hasScheduleGaps
                ? t('installWizard.doneNeedsSetupTitle', { name: bundleName })
                : t('installWizard.doneTitle', { name: bundleName })}
            </Text>
            {/* "Everything connected" only when NOTHING remains — neither a
                skipped required integration nor a blank schedule variable. */}
            {hasRequiredSkips ? (
              <Text variant="muted" className="text-sm">
                {t('installWizard.doneNeedsSetup')}
              </Text>
            ) : skippedCount > 0 ? (
              <Text variant="muted" className="text-sm">
                {t('installWizard.doneSomeSkipped')}
              </Text>
            ) : hasScheduleGaps ? null : (
              <Text variant="muted" className="text-sm">
                {t('installWizard.doneAllConnected')}
              </Text>
            )}
            {hasScheduleGaps && (
              <>
                <Text variant="muted" className="text-sm">
                  {t('installWizard.doneBundleScheduleVars', {
                    members: membersNeedingTriggers
                      .map(
                        (m) => `${m.automationName} (${m.fields.join(', ')})`,
                      )
                      .join(' · '),
                  })}
                </Text>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={openTriggers}
                >
                  {t('installWizard.openTriggers')}
                </Button>
              </>
            )}
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
