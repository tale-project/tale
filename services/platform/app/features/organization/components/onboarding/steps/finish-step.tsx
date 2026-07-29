'use client';

import { Button } from '@tale/ui/button';
import { Check, KeyRound, Users } from 'lucide-react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/** Where a finish-step CTA sends the user (after marking onboarding complete). */
export type FinishTarget = 'providers' | 'members';

interface FinishStepProps {
  /**
   * Completes onboarding, then routes to the chosen destination. Provided by
   * the wizard so the CTAs and the footer's "Go to dashboard" share the same
   * mark-complete logic. When absent (e.g. a story), CTAs render disabled.
   */
  onFinishTo?: (target: FinishTarget) => void;
  /**
   * When true, the "connect a provider" row renders as already-done (a check,
   * not a CTA) — the user connected one during onboarding, so listing it as a
   * pending next step would be confusing.
   */
  providerConnected?: boolean;
}

/**
 * Closing step: instead of a static checklist, each "what's next" item is an
 * actionable CTA that marks onboarding complete and lands the user exactly
 * where the task gets done — so a fresh workspace never dead-ends on "now
 * what?". An item the user already finished (e.g. a connected AI provider)
 * renders as done instead of a redundant CTA. The footer's "Go to dashboard"
 * remains the skip-everything exit.
 */
export function FinishStep({ onFinishTo, providerConnected }: FinishStepProps) {
  const { t } = useT('onboarding');

  const items: {
    target: FinishTarget;
    icon: typeof KeyRound;
    text: string;
    cta: string;
    done: boolean;
    doneText: string;
  }[] = [
    {
      target: 'providers',
      icon: KeyRound,
      text: t('finish.providerItem'),
      cta: t('finish.providerCta'),
      done: Boolean(providerConnected),
      doneText: t('finish.providerConnected'),
    },
    {
      target: 'members',
      icon: Users,
      text: t('finish.inviteItem'),
      cta: t('finish.inviteCta'),
      done: false,
      doneText: '',
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
        {items.map(({ target, icon: Icon, text, cta, done, doneText }) => (
          <li
            key={target}
            className="flex items-center justify-between gap-3 p-3"
          >
            <span className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg',
                  done
                    ? 'bg-success/10 text-success'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {done ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Icon className="size-4" aria-hidden />
                )}
              </span>
              <span className={cn('text-sm', done && 'text-muted-foreground')}>
                {done ? doneText : text}
              </span>
            </span>
            {done ? null : (
              <Button
                type="button"
                variant="secondary"
                disabled={!onFinishTo}
                onClick={() => onFinishTo?.(target)}
              >
                {cta}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </WizardStep>
  );
}
