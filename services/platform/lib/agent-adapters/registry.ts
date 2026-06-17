// Slug → adapter resolution. The single place entry points map a chosen agent
// to its adapter; adding a new agent (Codex, Gemini CLI) is one line here plus
// its adapter/parser module.

import { ClaudeCodeAdapter } from './claude-code/adapter';
import type { AgentSlug } from './events';
import { OpenCodeAdapter } from './opencode/adapter';
import type { AgentAdapter } from './types';

// Record keyed by AgentSlug — TS enforces every slug is mapped, so adding a
// member to the union is a compile error until its adapter is registered here.
const ADAPTERS: Record<AgentSlug, AgentAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  opencode: new OpenCodeAdapter(),
};

export function getAgentAdapter(slug: AgentSlug): AgentAdapter {
  return ADAPTERS[slug];
}
