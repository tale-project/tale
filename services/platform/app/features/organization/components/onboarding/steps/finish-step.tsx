'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { Bot, KeyRound, Users } from 'lucide-react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';

/** Where a finish-step CTA sends the user (after marking onboarding complete). */
export type FinishTarget = 'providers' | 'agents' | 'members';

interface FinishStepProps {
  /**
   * Completes onboarding, then routes to the chosen destination. Provided by
   * the wizard so the CTAs and the footer's "Go to dashboard" share the same
   * mark-complete logic. When absent (e.g. a story), CTAs render disabled.
   */
  onFinishTo?: (target: FinishTarget) => void;
}

/**
 * Closing step: instead of a static checklist, each "what's next" item is an
 * actionable CTA that marks onboarding complete and lands the user exactly
 * where the task gets done — so a fresh workspace never dead-ends on "now
 * what?". The footer's "Go to dashboard" remains the skip-everything exit.
 */
export function FinishStep({ onFinishTo }: FinishStepProps) {
  const { t } = useT('onboarding');

  const items: {
    target: FinishTarget;
    icon: typeof KeyRound;
    text: string;
    cta: string;
  }[] = [
    {
      target: 'providers',
      icon: KeyRound,
      text: t('finish.providerItem'),
      cta: t('finish.providerCta'),
    },
    {
      target: 'agents',
      icon: Bot,
      text: t('finish.agentItem'),
      cta: t('finish.agentCta'),
    },
    {
      target: 'members',
      icon: Users,
      text: t('finish.inviteItem'),
      cta: t('finish.inviteCta'),
    },
  ];

  return (
    <WizardStep id="finish">
      <Heading level={2} className="text-base">
        {t('finish.heading')}
      </Heading>
      <Text variant="muted">{t('finish.subtitle')}</Text>
      <ul role="list" className="mt-2 flex flex-col gap-3">
        {items.map(({ target, icon: Icon, text, cta }) => (
          <li
            key={target}
            className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <span className="flex items-start gap-2">
              <Icon className="text-fg-muted mt-0.5 size-4" aria-hidden />
              <span className="text-sm">{text}</span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!onFinishTo}
              onClick={() => onFinishTo?.(target)}
            >
              {cta}
            </Button>
          </li>
        ))}
      </ul>
    </WizardStep>
  );
}
