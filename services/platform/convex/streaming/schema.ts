import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';
import {
  autoRouteReasonValidator,
  citationItemValidator,
  contextStatsValidator,
  toolUsageItemValidator,
} from './validators';

export const messageMetadataTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  model: v.string(),
  provider: v.string(),
  // Owning assistant slug. Optional for backward compatibility with rows
  // written before the field existed; new writes should populate it from
  // OnAgentCompleteArgs.agentSlug so feedback rows can attribute by agent.
  agentSlug: v.optional(v.string()),
  // Why the Auto router chose `agentSlug` for this turn. Set only on Auto
  // routes; absent means the user pinned the agent.
  autoRouteReason: v.optional(autoRouteReasonValidator),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  providerMetadata: v.optional(jsonRecordValidator),
  durationMs: v.optional(v.number()),
  timeToFirstTokenMs: v.optional(v.number()),
  // Time to the first reasoning ("thinking") delta — what the user waits for
  // on a reasoning model; streams before the first content token. Optional for
  // rows written before the field existed and for non-reasoning models.
  timeToFirstReasoningMs: v.optional(v.number()),
  // Send-relative time to the first user-visible token (reasoning or content),
  // measured from chatWithAgent entry — includes the pre-stream backend hops
  // that timeToFirstTokenMs (action-relative) misses.
  timeFromSendMs: v.optional(v.number()),
  // Wall-clock pre-answer "thinking" time the user waited: from the turn start
  // (markGenerating, BEFORE Auto routing) to the first answer token. UNLIKE
  // timeToFirstTokenMs (measured from the generation action start, i.e. routing
  // already done) this INCLUDES the router-classifier latency, so the chat
  // "Thought for Ns" summary matches the live timer. Absent when no answer
  // token streamed (aborted / tool-only turn).
  thinkingDurationMs: v.optional(v.number()),
  subAgentUsage: v.optional(v.array(toolUsageItemValidator)),
  toolsUsage: v.optional(v.array(toolUsageItemValidator)),
  citations: v.optional(v.array(citationItemValidator)),
  // Structured context window for debugging (XML-like formatted)
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(contextStatsValidator),
  error: v.optional(v.string()),
  // Set when the guardrails pipeline (pii / chat_filter / moderation_provider)
  // blocks this assistant message either mid-stream or at finalize. The UI
  // checks this field BEFORE rendering text/reasoning/tools so blocked
  // content is never displayed. `auditLogs` + `chatFilterEvents` carry the
  // full forensic record; this field only carries what the UI needs.
  blockedReason: v.optional(
    v.object({
      code: v.union(
        v.literal('pii.blocked'),
        v.literal('chat_filter.blocked'),
        v.literal('moderation_provider.blocked'),
      ),
      direction: v.union(v.literal('input'), v.literal('output')),
      categoryIds: v.array(v.string()),
      sanitizationRunId: v.string(),
    }),
  ),
  costEstimateCents: v.optional(v.number()),
})
  .index('by_messageId', ['messageId'])
  .index('by_threadId', ['threadId']);
