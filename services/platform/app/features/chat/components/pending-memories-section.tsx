'use client';

import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { usePersonalizationActiveForThread } from '../hooks/use-personalization-active';
import { MemoryProposalCard } from './memory-proposal-card';

interface PendingMemoriesSectionProps {
  threadId: string | undefined;
}

/**
 * Non-blocking inline pending-memory section, rendered at the bottom of
 * the chat thread. Subscribes to `listPendingMemories({ threadId })`;
 * when the user accepts/edits/discards a card, the underlying mutation
 * flips the row state and reactivity removes the card.
 *
 * Hidden when personalization is disabled (org / user / thread gate)
 * or when the list is empty, to keep the chat visually quiet.
 */
export function PendingMemoriesSection({
  threadId,
}: PendingMemoriesSectionProps) {
  const { t } = useT('personalization');
  const active = usePersonalizationActiveForThread(threadId);
  const memories = useQuery(
    api.user_memories.queries.listPendingMemories,
    active && threadId ? { threadId } : 'skip',
  );

  if (!active) return null;
  if (!memories || memories.length === 0) return null;

  return (
    <section className="mt-3 flex flex-col gap-2">
      <div className="text-muted-foreground text-xs font-medium">
        {t('page.pending.title')}
      </div>
      {memories.map((m) => (
        <MemoryProposalCard key={m._id} memory={m} />
      ))}
    </section>
  );
}
