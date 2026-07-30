'use client';

/**
 * The chat index's welcome — the 0.3 chat page's opening screen, restored.
 *
 * One heading and four conversation starters. The starters used to travel
 * with the assistant's config file; the boundary model hardcoded the
 * assistant, so they are catalog strings now — authored per locale, not
 * translated at runtime. Clicking one sends it as the first message.
 */

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';

import { useT } from '@/lib/i18n/client';

/** Explicit key list so the i18n usage check sees every starter. */
const STARTER_KEYS = [
  'starters.email',
  'starters.summarize',
  'starters.brainstorm',
  'starters.explain',
] as const;

export function WelcomeView({
  onSuggestionClick,
}: {
  onSuggestionClick: (suggestion: string) => void;
}) {
  const { t } = useT('chat');

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4">
      <Stack gap={6} className="mx-auto w-full max-w-3xl">
        <Heading level={1} weight="semibold" className="text-[1.75rem]">
          {t('welcomeEmpty')}
        </Heading>
        <Stack as="ul" gap={0} className="divide-border divide-y" role="list">
          {STARTER_KEYS.map((key) => {
            const starter = t(key);
            return (
              <li key={key} className="py-1">
                <button
                  type="button"
                  onClick={() => onSuggestionClick(starter)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground w-full cursor-pointer rounded-md py-3 text-left text-sm transition-all hover:px-2 focus-visible:px-2 focus-visible:outline-none"
                >
                  {starter}
                </button>
              </li>
            );
          })}
        </Stack>
      </Stack>
    </div>
  );
}
