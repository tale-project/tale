'use client';

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { Bot, KeyRound, Users } from 'lucide-react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';

/** Closing step: a short what's-next checklist. `onFinish` (on the wizard)
 *  marks onboarding complete and routes to the dashboard. */
export function FinishStep() {
  const { t } = useT('onboarding');

  return (
    <WizardStep id="finish">
      <Heading level={2} className="text-base">
        {t('finish.heading')}
      </Heading>
      <Text variant="muted">{t('finish.subtitle')}</Text>
      <ul role="list" className="mt-2 flex flex-col gap-3">
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
  );
}
