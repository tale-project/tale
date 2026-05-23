'use client';

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useIncrementPromptUsage } from '../hooks/mutations';
import { usePrompts } from '../hooks/queries';

const MAX_SIDEBAR_PROMPTS = 5;

interface SidebarPromptSectionProps {
  organizationId: string;
  onSelectPrompt: (content: string) => void;
}

export function SidebarPromptSection({
  organizationId,
  onSelectPrompt,
}: SidebarPromptSectionProps) {
  const { t } = useT('prompts');
  const { prompts, isLoading } = usePrompts(organizationId);
  const incrementUsage = useIncrementPromptUsage();

  const handleSelect = useCallback(
    (promptId: Id<'promptTemplates'>, content: string) => {
      onSelectPrompt(content);
      void incrementUsage.mutateAsync({ promptId });
    },
    [onSelectPrompt, incrementUsage],
  );

  if (isLoading || prompts.length === 0) return null;

  const displayedPrompts = prompts.slice(0, MAX_SIDEBAR_PROMPTS);

  return (
    <Stack gap={4} className="border-border shrink-0 border-b pb-3">
      <Heading
        level={2}
        size="sm"
        weight="medium"
        className="text-muted-foreground px-2"
      >
        {t('sidebar.sectionTitle')}
      </Heading>
      <Stack gap={1}>
        {displayedPrompts.map((prompt) => (
          <button
            key={prompt._id}
            type="button"
            onClick={() => handleSelect(prompt._id, prompt.content)}
            className="group hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
          >
            <span className="min-w-0 flex-1 truncate">{prompt.title}</span>
            {prompt.description && (
              <Text
                as="span"
                variant="caption"
                className="text-muted-foreground hidden truncate md:inline"
              >
                {prompt.description}
              </Text>
            )}
          </button>
        ))}
      </Stack>
    </Stack>
  );
}
