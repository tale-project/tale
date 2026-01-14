'use client';

import { useT } from '@/lib/i18n/client';
import { LoadingDots } from './thinking-animation';

interface WelcomeViewProps {
  isPending: boolean;
}

/**
 * Welcome view shown on new chat page before any messages.
 * Shows loading dots when a message is being sent.
 */
export function WelcomeView({ isPending }: WelcomeViewProps) {
  const { t } = useT('chat');

  return (
    <div className="flex-1 flex items-center justify-center size-full">
      {isPending ? (
        <LoadingDots />
      ) : (
        <h1 className="text-[2rem] font-semibold text-center">{t('welcome')}</h1>
      )}
    </div>
  );
}
