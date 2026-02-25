'use client';

import { Heading } from '@/app/components/ui/typography/heading';
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
    <div className="flex size-full flex-1 items-center justify-center">
      {isPending ? (
        <LoadingDots />
      ) : (
        <Heading
          level={1}
          weight="semibold"
          className="text-center text-[2rem]"
        >
          {t('welcome')}
        </Heading>
      )}
    </div>
  );
}
