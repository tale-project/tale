'use client';

import { Button } from '@tale/ui/button';
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
      {/* Heading + subtitle live in the wizard hero now. One bordered panel
          with divided rows (not three separate cards) reads as a single
          "what's next" list; each row leads with an icon chip. */}
      <ul
        role="list"
        className="divide-border border-border divide-y overflow-hidden rounded-lg border"
      >
        {items.map(({ target, icon: Icon, text, cta }) => (
          <li
            key={target}
            className="flex items-center justify-between gap-3 p-3"
          >
            <span className="flex items-center gap-3">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-4" aria-hidden />
              </span>
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
