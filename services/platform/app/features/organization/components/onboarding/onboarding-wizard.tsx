'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { ArrowRight, Bot, KeyRound, Users } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import {
  Wizard,
  WizardFooter,
  WizardProgress,
  WizardStep,
  type WizardStepMeta,
} from '@/app/components/ui/wizard';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { MAX_ORG_SLUG_LENGTH } from '@/lib/shared/constants/org-slug';
import { isReservedOrgSlug } from '@/lib/shared/constants/reserved-org-slugs';

import { useInitializeDefaultWorkflows } from '../../hooks/actions';

/**
 * Derive the on-disk slug from a free-form display name. Mirrors
 * `services/platform/lib/shared/constants/org-slug.ts` ORG_SLUG_REGEX and
 * truncates to the shared cap so a long name can't mint a slug the
 * RAG/crawler validators would reject.
 */
function deriveOrgSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORG_SLUG_LENGTH);
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/**
 * First-run / per-organization setup wizard. The same flow runs whenever any
 * organization is created (first or additional). Step 1 creates the org;
 * the AI-provider and team steps are optional, strongly-encouraged guidance;
 * the finish step shows a what's-next checklist.
 */
export function OnboardingWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useT('onboarding');
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');

  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const setOnboardingCompleted = useMutation(
    api.user_preferences.mutations.setOnboardingCompleted,
  );
  const { mutateAsync: initializeDefaultWorkflows } =
    useInitializeDefaultWorkflows();

  const [name, setName] = useState('');
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  const trimmed = name.trim();
  const slug = deriveOrgSlug(name);
  const nameValid =
    trimmed.length > 0 &&
    NAME_PATTERN.test(trimmed) &&
    !isReservedOrgSlug(slug);

  const nameError =
    trimmed.length === 0
      ? undefined
      : !NAME_PATTERN.test(trimmed)
        ? tSettings('organization.companyNameCharacterError')
        : isReservedOrgSlug(slug)
          ? tSettings('organization.nameReserved')
          : undefined;

  const steps: WizardStepMeta[] = [
    { id: 'workspace', label: t('steps.workspace') },
    { id: 'provider', label: t('steps.provider'), optional: true },
    { id: 'team', label: t('steps.team'), optional: true },
    { id: 'finish', label: t('steps.finish') },
  ];

  const createWorkspace = async (): Promise<boolean> => {
    if (!user || createdOrgId) return Boolean(createdOrgId);
    try {
      const result = await authClient.organization.create({
        name: trimmed,
        slug,
        metadata: { creatorId: user.userId },
      });
      const newOrgId = result?.data?.id;
      if (!newOrgId) throw new Error('Organization id missing from response');

      await authClient.organization.setActive({ organizationId: newOrgId });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      await initializeDefaultWorkflows({ organizationId: newOrgId });
      try {
        await recordOrgSwitch({ organizationId: newOrgId });
      } catch (err) {
        console.warn('Failed to record org switch audit entry:', err);
      }

      setCreatedOrgId(newOrgId);
      toast({
        title: tSettings('organization.organizationCreated'),
        variant: 'success',
      });
      return true;
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: tCommon('errors.unexpectedError'),
        variant: 'destructive',
      });
      return false;
    }
  };

  const finishOnboarding = async () => {
    if (createdOrgId) {
      try {
        await setOnboardingCompleted({
          organizationId: createdOrgId,
          completed: true,
        });
      } catch (err) {
        console.warn('Failed to mark onboarding complete:', err);
      }
      void navigate({ to: '/dashboard/$id', params: { id: createdOrgId } });
    } else {
      void navigate({ to: '/dashboard' });
    }
  };

  const goToProviders = () => {
    if (!createdOrgId) return;
    void navigate({
      to: '/dashboard/$id/settings/providers',
      params: { id: createdOrgId },
    });
  };

  const goToPeople = () => {
    if (!createdOrgId) return;
    void navigate({
      to: '/dashboard/$id/settings/people',
      params: { id: createdOrgId },
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full items-center justify-between px-4 py-3">
        <TaleLogo />
        <UserButton align="end" />
      </header>
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
        <Heading level={1} className="mb-2">
          {t('title')}
        </Heading>
        <Text variant="muted" className="mb-8 block">
          {t('subtitle')}
        </Text>

        <Wizard
          steps={steps}
          onFinish={finishOnboarding}
          formatProgress={(current, total, label) =>
            t('progress', { current, total, label })
          }
        >
          <WizardProgress ariaLabel={t('stepsAriaLabel')} />

          <WizardStep
            id="workspace"
            valid={nameValid}
            onBeforeNext={createWorkspace}
          >
            <Heading level={2} className="text-base">
              {t('workspace.heading')}
            </Heading>
            <Text variant="muted">{t('workspace.why')}</Text>
            <Input
              id="org-name"
              type="text"
              label={tSettings('organization.organizationName')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tSettings('organization.enterCompanyName')}
              errorMessage={nameError}
              disabled={Boolean(createdOrgId)}
              description={
                slug
                  ? tSettings('organization.identifierPreview', { slug })
                  : undefined
              }
            />
          </WizardStep>

          <WizardStep id="provider">
            <Heading level={2} className="text-base">
              <KeyRound
                className="text-fg-muted mr-2 inline size-4"
                aria-hidden
              />
              {t('provider.heading')}
            </Heading>
            <Text variant="muted">{t('provider.why')}</Text>
            <div>
              <Button
                variant="secondary"
                icon={ArrowRight}
                onClick={goToProviders}
              >
                {t('provider.cta')}
              </Button>
            </div>
          </WizardStep>

          <WizardStep id="team">
            <Heading level={2} className="text-base">
              <Users className="text-fg-muted mr-2 inline size-4" aria-hidden />
              {t('team.heading')}
            </Heading>
            <Text variant="muted">{t('team.why')}</Text>
            <div>
              <Button
                variant="secondary"
                icon={ArrowRight}
                onClick={goToPeople}
              >
                {t('team.cta')}
              </Button>
            </div>
          </WizardStep>

          <WizardStep id="finish">
            <Heading level={2} className="text-base">
              {t('finish.heading')}
            </Heading>
            <Text variant="muted">{t('finish.subtitle')}</Text>
            <ul className="mt-2 flex flex-col gap-3">
              <li className="flex items-start gap-2">
                <KeyRound className="text-fg-muted mt-0.5 size-4" aria-hidden />
                <span className="text-sm">{t('finish.providerItem')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Bot className="text-fg-muted mt-0.5 size-4" aria-hidden />
                <span className="text-sm">{t('finish.agentItem')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Users className="text-fg-muted mt-0.5 size-4" aria-hidden />
                <span className="text-sm">{t('finish.inviteItem')}</span>
              </li>
            </ul>
          </WizardStep>

          <WizardFooter
            backLabel={tCommon('actions.back')}
            nextLabel={tCommon('actions.next')}
            finishLabel={t('finish.goToDashboard')}
            skipLabel={tCommon('actions.skip')}
          />
        </Wizard>
      </div>
    </div>
  );
}
