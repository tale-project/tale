'use client';

import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../../chat/context/chat-layout-context';

interface SkillsHeaderChipProps {
  organizationId: string;
  threadId: string;
}

/**
 * Shows "N skills" on the chat header when the agent bound to the current
 * thread has any `skillBindings`. Click opens a popover listing each
 * `slug — description`. Renders a small skeleton while the action query
 * is in flight; collapses to `null` only once we *know* the count is zero.
 */
export function SkillsHeaderChip({
  organizationId,
  threadId,
}: SkillsHeaderChipProps) {
  const { t } = useT('settings');
  const { selectedAgent } = useChatLayout();
  const queryClient = useQueryClient();
  const chipQueryKey = useMemo(
    () => ['config', 'skills', organizationId, 'thread', threadId],
    [organizationId, threadId],
  );
  const { data } = useActionQuery(
    // agentSlug is intentionally not in the key — the parent invalidates
    // this prefix on every agent-config write, so a thread that swaps
    // agents picks up the new chip count without refetch churn.
    chipQueryKey,
    api.skills.get_thread_skills.getThreadAgentSkills,
    { organizationId, threadId },
  );
  // Composer-side agent switch: chip reads thread-side `agentSlug`
  // which only commits on the next send, but the user expects the chip
  // to reflect their selection. Invalidate the cached result whenever
  // the composer's pick diverges from what the chip thinks the thread's
  // agent is — the refetch returns the same data until the next send
  // (cheap), then updates correctly once the thread metadata commits.
  useEffect(() => {
    if (!selectedAgent?.name || data === undefined) return;
    if (data.agentSlug && data.agentSlug !== selectedAgent.name) {
      void queryClient.invalidateQueries({ queryKey: chipQueryKey });
    }
  }, [selectedAgent?.name, data, queryClient, chipQueryKey]);
  const skills = useMemo(
    () => (data?.skills ?? []) as Array<{ slug: string; description: string }>,
    [data],
  );
  // Render a skeleton while loading so the chip doesn't pop in on every
  // chat-page mount. Only collapse to null when we know the count is 0.
  if (data === undefined) {
    return <Skeleton className="h-6 w-20 rounded-md" />;
  }
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
