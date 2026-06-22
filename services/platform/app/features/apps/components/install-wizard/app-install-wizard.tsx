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
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { AppScope } from '@/lib/shared/schemas/apps';

import { useAppInstallActions } from '../../hooks/use-install-state';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../../hooks/use-required-integrations';
import { ConnectIntegrationStep } from './connect-integration-step';

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
   * 'install' (default): full flow — project? → install → connect → done.
   * 'connect-only': the app is already installed (app-page readiness checklist) —
   * skip the project + install steps and connect `initialSlugs` directly.
   */
  mode?: 'install' | 'connect-only';
  initialSlugs?: readonly string[];
}

/**
 * Inline install + integration-connect wizard. Clicking Install opens this
 * instead of silently installing and routing the user to Settings → Integrations:
 * it installs the app, then walks each unconnected required integration with the
 * credential form embedded in the dialog. Guided but non-blocking — every connect
 * step is skippable and the app-page readiness checklist remains the fallback.
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
  // steps don't vanish mid-flow as the user connects them — each step gates its
  // own validity instead. Integration credentials are independent of app install,
  // so this is stable before/after the install step.
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

  const requiredBySlug = useMemo(
    () => new Map(required.map((r) => [r.slug, r])),
    [required],
  );

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [createOpen, setCreateOpen] = useState(false);

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
    for (const slug of stepSlugs) {
      list.push({
        id: `connect-${slug}`,
        label: labelFor(slug),
        optional: true,
      });
    }
    list.push({ id: 'done', label: t('installWizard.doneStepLabel') });
    return list;
    // labelFor reads requiredBySlug; both recompute together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsProjectStep, hasInstallStep, stepSlugs, requiredBySlug, t]);

  const targetProjectId =
    scope === 'project'
      ? (projectId ?? selectedProjectId ?? undefined)
      : undefined;

  const doInstall = async (): Promise<boolean> => {
    try {
      await install(appSlug, targetProjectId);
      return true;
    } catch (err) {
      toast({
        title: t('installWizard.installFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      return false;
    }
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

  // Steps still unconnected at finish time drive the "some skipped" summary copy.
  const skippedCount = stepSlugs.filter(
    (slug) => !requiredBySlug.get(slug)?.connected,
  ).length;

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
