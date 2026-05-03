'use client';

import type { Doc } from '@/convex/_generated/dataModel';

import { MemoryProposalCard } from './memory-proposal-card';

interface InlineMemoryProposalsProps {
  memories: Doc<'userMemories'>[];
}

/**
 * Renders pending memory proposals attached to a single chat message.
 *
 * Industry pattern (ChatGPT memory chip, Cloudscape inline action card,
 * OpenAI Apps SDK inline display mode): the suggestion belongs to the
 * bubble that produced it, not a global "Pending" tray. This keeps the
 * affordance discoverable in context and lets the agent's reply text
 * stay neutral about UI placement.
 *
 * The chat surface subscribes once to `listPendingMemories({ threadId })`
 * and groups by `sourceMessageId` — this component just renders the
 * pre-filtered slice for one message. Returns null for the empty case
 * so callers can mount it unconditionally.
 */
export function InlineMemoryProposals({
  memories,
}: InlineMemoryProposalsProps) {
  if (memories.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {memories.map((m) => (
        <MemoryProposalCard key={m._id} memory={m} />
      ))}
    </div>
  );
}
