'use client';

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useState } from 'react';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { type WizardStepMeta } from '@/app/components/ui/wizard/use-wizard';
import { Wizard } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { WizardProgress } from '@/app/components/ui/wizard/wizard-progress';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { AccountStep } from './steps/account-step';
import { FinishStep } from './steps/finish-step';
import { OpenRouterStep } from './steps/openrouter-step';
import { PreferencesStep } from './steps/preferences-step';
import { WorkspaceStep } from './steps/workspace-step';

/**
 * Setup wizard. Two modes share one flow:
 *
 *  - `first-run` (the `/setup` route, unauthenticated): the very first install.
 *    Walks language/theme → owner account → workspace → OpenRouter → finish.
 *    Account creation signs the user in mid-flow; subsequent steps run on the
 *    now-authenticated websocket without leaving the wizard.
 *  - `add-org` (the `/dashboard/create-organization` route, authenticated): an
 *    existing user spinning up another organization — just workspace →
 *    OpenRouter → finish.
 */
export function OnboardingWizard({
  mode = 'add-org',
}: {
  mode?: 'first-run' | 'add-org';
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useT('onboarding');
  const { t: tCommon } = useT('common');

  const setOnboardingCompleted = useMutation(
    api.user_preferences.mutations.setOnboardingCompleted,
  );

  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  const isFirstRun = mode === 'first-run';

  const steps: WizardStepMeta[] = [
    ...(isFirstRun
      ? [
          { id: 'preferences', label: t('steps.preferences') },
          { id: 'account', label: t('steps.account') },
        ]
      : []),
    { id: 'workspace', label: t('steps.workspace') },
    { id: 'provider', label: t('steps.provider'), optional: true },
    { id: 'finish', label: t('steps.finish') },
  ];

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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full items-center justify-between px-4 py-3">
        <TaleLogo />
        {/* No session yet on first-run until the account step completes. */}
        {user ? <UserButton align="end" /> : null}
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
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

          {isFirstRun && <PreferencesStep />}
          {isFirstRun && <AccountStep />}

          <WorkspaceStep
            createdOrgId={createdOrgId}
            onCreated={setCreatedOrgId}
          />
          <OpenRouterStep organizationId={createdOrgId} />
          <FinishStep />

          <WizardFooter
            backLabel={tCommon('actions.back')}
            nextLabel={tCommon('actions.next')}
            finishLabel={t('finish.goToDashboard')}
            skipLabel={tCommon('actions.skip')}
          />
        </Wizard>
      </main>
    </div>
  );
}
