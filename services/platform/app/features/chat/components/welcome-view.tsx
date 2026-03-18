'use client';

import type { MemberRole } from '@/lib/shared/schemas/organizations';

import { Heading } from '@/app/components/ui/typography/heading';
import { useT } from '@/lib/i18n/client';

import { LoadingDots } from './thinking-animation';

interface WelcomeViewProps {
  isPending: boolean;
  role: MemberRole | null | undefined;
  onSuggestionClick: (suggestion: string) => void;
}

function getSuggestionKey(
  role: MemberRole | null | undefined,
): 'admin' | 'editor' | 'developer' | 'member' {
  if (role === 'owner' || role === 'admin') return 'admin';
  if (role === 'editor') return 'editor';
  if (role === 'developer') return 'developer';
  return 'member';
}

export function WelcomeView({
  isPending,
  role,
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

  const suggestionKey = getSuggestionKey(role);
  const suggestionsRaw = t(`suggestions.${suggestionKey}`, {
    returnObjects: true,
  });
  const suggestions = Array.isArray(suggestionsRaw) ? suggestionsRaw : [];

  return (
    <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
      <Heading level={1} weight="semibold" className="text-[1.75rem]">
        {t('welcome')}
      </Heading>

      <ul className="divide-border flex flex-col divide-y" role="list">
        {suggestions.map((suggestion, index) => (
          <li key={index} className="py-1">
            <button
              type="button"
              onClick={() => onSuggestionClick(suggestion)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground w-full cursor-pointer rounded-md py-3 text-left text-sm transition-all hover:px-2"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
