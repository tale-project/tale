'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Grid, Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { ChevronLeft, X } from 'lucide-react';
import { useState } from 'react';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import {
  useWizard,
  type WizardStepMeta,
} from '@/app/components/ui/wizard/use-wizard';
import { Wizard } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { WizardProgress } from '@/app/components/ui/wizard/wizard-progress';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { AccountStep } from './steps/account-step';
import { FinishStep, type FinishTarget } from './steps/finish-step';
import { WorkspaceStep } from './steps/workspace-step';

/**
 * Setup wizard. Two modes share one flow:
 *
 *  - `first-run` (the `/setup` route, unauthenticated): the very first install.
 *    Walks owner account → workspace → OpenRouter → finish. Account creation
 *    signs the user in mid-flow; subsequent steps run on the now-authenticated
 *    websocket without leaving the wizard.
 *  - `add-org` (the `/dashboard/create-organization` route, authenticated): an
 *    existing user spinning up another organization — just workspace →
 *    OpenRouter → finish.
 *
 * Language and theme aren't asked for: both are inferred from the client
 * (browser locale + OS color-scheme) by the locale/theme providers, and stay
 * changeable later in settings.
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
  // Controlled step index so the page header can host the Back control (it
  // lives outside the wizard's provider). All wizard navigation routes through
  // `onIndexChange`, keeping this the single source of truth.
  const [stepIndex, setStepIndex] = useState(0);

  // The AI-provider step (connect an OpenRouter key) is omitted while the
  // provider backend is rebuilt — there is nowhere to save the key. The
  // finish step keeps its provider row as an open to-do pointing at the
  // provider settings page, which explains the rebuild status.
  const providerConnected = false;

  const isFirstRun = mode === 'first-run';

  const steps: WizardStepMeta[] = [
    ...(isFirstRun ? [{ id: 'account', label: t('steps.account') }] : []),
    { id: 'workspace', label: t('steps.workspace') },
    { id: 'finish', label: t('steps.finish') },
  ];

  const completeOnboarding = async () => {
    if (!createdOrgId) return;
    try {
      await setOnboardingCompleted({
        organizationId: createdOrgId,
        completed: true,
      });
    } catch (err) {
      console.warn('Failed to mark onboarding complete:', err);
    }
  };

  const finishOnboarding = async () => {
    await completeOnboarding();
    if (createdOrgId) {
      void navigate({ to: '/dashboard/$id', params: { id: createdOrgId } });
    } else {
      void navigate({ to: '/dashboard' });
    }
  };

  // Finish-step CTAs: mark onboarding complete, then land the user where the
  // task actually gets done instead of dumping them on an empty dashboard.
  const finishTo = (target: FinishTarget) => {
    void (async () => {
      await completeOnboarding();
      if (!createdOrgId) {
        void navigate({ to: '/dashboard' });
        return;
      }
      const params = { id: createdOrgId };
      switch (target) {
        case 'providers':
          void navigate({
            to: '/dashboard/$id/settings/providers',
            params,
          });
          return;
        case 'agents':
          void navigate({ to: '/dashboard/$id/agents', params });
          return;
        case 'members':
          // Members live on Organization now; `/settings/people` redirects to
          // Teams (legacy split), which is the wrong place for "Invite teammates".
          void navigate({
            to: '/dashboard/$id/settings/organization',
            params,
          });
          return;
      }
    })();
  };

  return (
    <Stack gap={0} className="min-h-screen">
      {/* Three zones, two distinct affordances: step Back (left) navigates
          within the flow; the close (right) leaves it. A back-chevron vs an
          ✕-close, on opposite sides — so they never read as duplicate "Back"s. */}
      <Grid
        as="header"
        cols={3}
        gap={0}
        className="w-full items-center px-4 py-3"
      >
        <div className="justify-self-start">
          {stepIndex > 0 && (
            <Button
              variant="ghost"
              icon={ChevronLeft}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              className="-ml-2"
            >
              {tCommon('actions.back')}
            </Button>
          )}
        </div>
        <div className="justify-self-center">
          <TaleLogo />
        </div>
        <Row gap={2} className="justify-self-end">
          {/* No session yet on first-run until the account step completes. */}
          {user ? <UserButton align="end" /> : null}
          {/* add-org mode only: a close affordance to leave setup and return to
              the app (first-run has no app to return to yet). Rendered as an ✕,
              not a "Back", so it can't be mistaken for the step-back control. */}
          {!isFirstRun ? (
            <Link
              to="/dashboard"
              aria-label={t('backToApp')}
              title={t('backToApp')}
              className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </Link>
          ) : null}
        </Row>
      </Grid>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-20 pb-12">
        <Wizard
          steps={steps}
          activeIndex={stepIndex}
          onIndexChange={setStepIndex}
          onFinish={finishOnboarding}
          formatProgress={(current, total, label) =>
            t('progress', { current, total, label })
          }
        >
          <Stack gap={8}>
            <WizardProgress segmented ariaLabel={t('stepsAriaLabel')} />
            <StepHero />
          </Stack>

          {isFirstRun && <AccountStep />}

          <WorkspaceStep
            createdOrgId={createdOrgId}
            onCreated={setCreatedOrgId}
          />
          <FinishStep
            onFinishTo={finishTo}
            providerConnected={providerConnected}
          />

          <WizardFooter
            stacked
            backLabel={tCommon('actions.back')}
            nextLabel={tCommon('actions.next')}
            finishLabel={t('finish.goToDashboard')}
            skipLabel={tCommon('actions.skip')}
            nextDisabledReason={tCommon('actions.completeStepToContinue')}
          />
        </Wizard>
      </main>
    </Stack>
  );
}

/**
 * The wizard's single title/subtitle, driven by the active step — so each step
 * shows exactly one heading (the hero) instead of duplicating it inside the
 * step body. Lives inside `<Wizard>` so it can read the active step.
 */
function StepHero() {
  const { t } = useT('onboarding');
  const { activeStep } = useWizard();

  const copy: Record<string, { title: string; subtitle: string }> = {
    account: { title: t('account.heading'), subtitle: t('account.why') },
    workspace: { title: t('title'), subtitle: t('subtitle') },
    provider: { title: t('provider.heading'), subtitle: t('provider.why') },
    finish: { title: t('finish.heading'), subtitle: t('finish.subtitle') },
  };
  const { title, subtitle } = copy[activeStep?.id ?? ''] ?? {
    title: '',
    subtitle: '',
  };

  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <Heading level={1} size="2xl" weight="semibold">
        {title}
      </Heading>
      <Text variant="muted" className="text-base">
        {subtitle}
      </Text>
    </div>
  );
}
