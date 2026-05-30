'use client';

import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { useT } from '@/lib/i18n/client';

interface WelcomeViewProps {
  isAgentLoading: boolean;
  agentName: string | undefined;
  conversationStarters?: string[];
  onSuggestionClick: (suggestion: string) => void;
}

export function WelcomeView({
  isAgentLoading,
  agentName,
  conversationStarters,
  onSuggestionClick,
}: WelcomeViewProps) {
  const { t } = useT('chat');

  const hasStarters = conversationStarters && conversationStarters.length > 0;

  // Loading while the agent is still resolving OR agent hasn't arrived yet.
  // agentName is undefined when auth is pending (query disabled) or data
  // hasn't arrived — in both cases mask, rather than show the empty state.
  const isLoading = !hasStarters && (isAgentLoading || agentName === undefined);

  // Empty (resolved, no starters): show the welcome-empty heading as real text.
  if (!hasStarters && !isLoading) {
    return (
      <div className="flex size-full flex-1 items-center justify-center">
        <Heading level={1} weight="semibold" className="text-[1.75rem]">
          {t('welcomeEmpty')}
        </Heading>
      </div>
    );
  }

  // One real tree, always. When loading, no starters have arrived so a few
  // placeholder rows stand in; each dynamic leaf (heading text, starter label)
  // is masked at the point it renders inside <Skeletonize loading>.
  const starters = hasStarters
    ? conversationStarters
    : (Array.from({ length: 4 }, () => '') as string[]);

  return (
    <Skeletonize loading={isLoading} label={t('skeleton.loadingWelcome')}>
      <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
        <Heading level={1} weight="semibold" className="text-[1.75rem]">
          <SkeletonBox>
            {hasStarters ? (
              <>
                {agentName && <em>{agentName}</em>} {t('welcomeSuffix')}
              </>
            ) : (
              <span className="inline-block h-9 w-80" />
            )}
          </SkeletonBox>
        </Heading>

        <ul className="divide-border flex flex-col divide-y" role="list">
          {starters.map((starter, index) => (
            <li key={index} className="py-1">
              <button
                type="button"
                onClick={() => starter && onSuggestionClick(starter)}
                disabled={!hasStarters}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground w-full cursor-pointer rounded-md py-3 text-left text-sm transition-all hover:px-2 focus-visible:px-2 focus-visible:outline-none"
              >
                <SkeletonBox>
                  {hasStarters ? (
                    starter
                  ) : (
                    <span className="inline-block h-5 w-64" />
                  )}
                </SkeletonBox>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Skeletonize>
  );
}
