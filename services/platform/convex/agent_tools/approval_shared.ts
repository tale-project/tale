import { v } from 'convex/values';

import type { SerializableAgentConfig } from '../lib/agent_chat/types';

export const DEFAULT_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'chat-agent',
  instructions: '',
  convexToolNames: [],
  model: 'default',
  knowledgeMode: 'off' as const,
  webSearchMode: 'off' as const,
  includeTeamKnowledge: false,
  includeOrgKnowledge: false,
  knowledgeFileIds: [],
  structuredResponsesEnabled: true,
  timeoutMs: 1_200_000,
};

export const approvalReturnValidator = v.object({
  success: v.boolean(),
  threadId: v.optional(v.string()),
  streamId: v.optional(v.string()),
});
