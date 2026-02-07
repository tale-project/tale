/**
 * Type-safe function references for chat agent module.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

interface SubAgentUsage {
  toolName: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface ContextStats {
  totalTokens: number;
  messageCount: number;
  approvalCount: number;
  hasRag: boolean;
  hasIntegrations: boolean;
}

interface ChatCompleteResult {
  threadId: string;
  text: string;
  toolCalls?: Array<{ toolName: string; status: string }>;
  model: string;
  provider: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  subAgentUsage?: SubAgentUsage[];
  contextWindow?: string;
  contextStats?: ContextStats;
}

export type OnChatCompleteRef = FunctionReference<
  'mutation',
  'internal',
  { result: ChatCompleteResult },
  null
>;

export function getOnChatCompleteRef(): OnChatCompleteRef {
  return createRef<OnChatCompleteRef>('internal', ['agents', 'chat', 'internal_mutations', 'onChatComplete']);
}

interface FileAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface SerializableAgentConfig {
  name: string;
  instructions: string;
  convexToolNames?: string[];
  useFastModel?: boolean;
  model?: string;
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  outputFormat?: 'text' | 'json';
  enableVectorSearch?: boolean;
}

interface AgentHooksConfig {
  beforeContext?: string;
  beforeGenerate?: string;
  afterGenerate?: string;
  onError?: string;
}

type RunAgentGenerationArgs = {
  agentType: string;
  agentConfig: SerializableAgentConfig;
  model: string;
  provider: string;
  debugTag: string;
  enableStreaming?: boolean;
  hooks?: AgentHooksConfig;
  threadId: string;
  organizationId: string;
  userId?: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  agentOptions?: unknown;
  attachments?: FileAttachment[];
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  userTeamIds?: string[];
  [key: string]: unknown;
}

export type RunAgentGenerationRef = FunctionReference<
  'action',
  'internal',
  RunAgentGenerationArgs,
  unknown
>;

export function getRunAgentGenerationRef(): RunAgentGenerationRef {
  return createRef<RunAgentGenerationRef>('internal', ['lib', 'agent_chat', 'internal_actions', 'runAgentGeneration']);
}
