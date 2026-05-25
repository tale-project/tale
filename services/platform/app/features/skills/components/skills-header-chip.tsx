'use client';

import { Badge } from '@tale/ui/badge';
import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';

import { Stack } from '@/app/components/ui/layout/layout';
import { Popover } from '@/app/components/ui/overlays/popover';
import { Text } from '@/app/components/ui/typography/text';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface SkillsHeaderChipProps {
  organizationId: string;
  threadId: string;
}

/**
 * Shows "N skills" on the chat header when the agent bound to the current
 * thread has any `skillBindings`. Click opens a popover listing each
 * `slug — description`. Renders nothing when there are no skills.
 */
export function SkillsHeaderChip({
  organizationId,
  threadId,
}: SkillsHeaderChipProps) {
  const { t } = useT('settings');
  const { data } = useActionQuery(
    ['config', 'skills', organizationId, 'thread', threadId],
    api.skills.get_thread_skills.getThreadAgentSkills,
    { organizationId, threadId },
  );
  const skills = useMemo(
    () => (data?.skills ?? []) as Array<{ slug: string; description: string }>,
    [data],
  );
  if (skills.length === 0) return null;

  return (
    <Popover
      trigger={
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground border-border inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          aria-label={t('skills.headerChipAria', {
            defaultValue: 'View bound skills',
          })}
        >
          <Sparkles className="size-3.5" />
          <span>
            {t('skills.headerChipLabel', {
              defaultValue: '{count} skills',
              count: skills.length,
            })}
          </span>
        </button>
      }
      align="end"
      contentClassName="w-80 p-3"
    >
      <Stack gap={3}>
        <Text variant="label">
          {t('skills.headerChipTitle', {
            defaultValue: 'Skills available to this agent',
          })}
        </Text>
        <Stack gap={2}>
          {skills.map((s) => (
            <Stack key={s.slug} gap={1}>
              <Badge variant="outline" className="self-start font-mono text-xs">
                {s.slug}
              </Badge>
              <Text variant="muted" className="line-clamp-3">
                {s.description}
              </Text>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Popover>
  );
}
