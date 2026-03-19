'use client';

import { Heading } from '@/app/components/ui/typography/heading';
import { useT } from '@/lib/i18n/client';

import { LoadingDots } from './thinking-animation';

interface WelcomeViewProps {
  isPending: boolean;
  conversationStarters?: string[];
  onSuggestionClick: (suggestion: string) => void;
}

export function WelcomeView({
  isPending,
  conversationStarters,
  onSuggestionClick,
}: WelcomeViewProps) {
  const { t } = useT('chat');

  if (isPending) {
    return (
      <div className="flex size-full flex-1 items-center justify-center">
        <LoadingDots />
      </div>
    );
  }

  const hasStarters = conversationStarters && conversationStarters.length > 0;

  if (!hasStarters) {
    return (
      <div className="flex size-full flex-1 items-center justify-center">
        <Heading level={1} weight="semibold" className="text-[1.75rem]">
          {t('welcomeEmpty')}
        </Heading>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
      <Heading level={1} weight="semibold" className="text-[1.75rem]">
        {t('welcome')}
      </Heading>

      <ul className="divide-border flex flex-col divide-y" role="list">
        {conversationStarters.map((starter, index) => (
          <li key={index} className="py-1">
            <button
              type="button"
              onClick={() => onSuggestionClick(starter)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground w-full cursor-pointer rounded-md py-3 text-left text-sm transition-all hover:px-2 focus-visible:px-2 focus-visible:outline-none"
            >
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
