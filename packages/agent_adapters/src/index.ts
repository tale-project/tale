// Public surface of @tale/agent-adapters. This is the package boundary (the
// one entry the exports map points at); internal modules import each other
// directly, never through here.

export type {
  AgentEvent,
  AgentEventParser,
  AgentResultStatus,
  AgentSlug,
  AgentUsage,
} from './events';
export type {
  AgentAdapter,
  AgentRunSpec,
  GatewayTarget,
  SessionExecSpec,
} from './types';
export { DEFAULT_MAX_TURNS } from './types';
export { getAgentAdapter, SUPPORTED_AGENTS } from './registry';
export { ClaudeCodeAdapter } from './claude_code/adapter';
export { ClaudeCodeParser } from './claude_code/parse';
export {
  buildSteerStdinPayload,
  buildStdinUserMessage,
} from './claude_code/stdin';
export { OpenCodeAdapter } from './opencode/adapter';
export { OpenCodeParser } from './opencode/parse';
