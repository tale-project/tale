'use client';

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
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

  // One real tree for every state — loading, empty, and loaded — so the base
  // structure (the centered max-width column + heading) is visible from the
  // first paint and never reflows. Previously the empty state rendered a lone
  // *centered* heading while the loading/loaded states left-aligned it in the
  // column, so resolving loading→empty jumped the heading from center to left.
  // Now only the starter list changes between states: masked placeholder rows
  // while loading, real starters once loaded, and no list in the empty case.
  const starters = hasStarters
    ? conversationStarters
    : Array.from({ length: 4 }, () => '');

  return (
    <Skeletonize loading={isLoading} label={t('skeleton.loadingWelcome')}>
      <Stack gap={6} className="mx-auto w-full max-w-(--chat-max-width)">
        <Heading level={1} weight="semibold" className="text-[1.75rem]">
          <SkeletonBox>
            {isLoading ? (
              <span className="inline-block h-9 w-80" />
            ) : (
              // Same invite whether starters are present or not — no
              // "{Agent} here…" self-intro; role flavor lives in the starters
              // and the agent picker.
              t('welcomeEmpty')
            )}
          </SkeletonBox>
        </Heading>

        {(hasStarters || isLoading) && (
          <Stack as="ul" gap={0} className="divide-border divide-y" role="list">
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
          </Stack>
        )}
      </Stack>
    </Skeletonize>
  );
}
