// Slug → adapter resolution. The single place entry points map a chosen agent
// to its adapter; adding a new product runtime is one adapter module + a line
// here (and extending PRODUCT_AGENT_SLUGS in events.ts).

import { ClaudeCodeAdapter } from './claude-code/adapter';
import { CodexAdapter } from './codex/adapter';
import { CursorAdapter } from './cursor/adapter';
import { PRODUCT_AGENT_SLUGS, type ProductAgentSlug } from './events';
import { GeminiCliAdapter } from './gemini-cli/adapter';
import { HermesAdapter } from './hermes/adapter';
import { OpenClawAdapter } from './openclaw/adapter';
import { OpenCodeAdapter } from './opencode/adapter';
import { PiAdapter } from './pi/adapter';
import type { AgentAdapter } from './types';

const ADAPTERS: Record<ProductAgentSlug, AgentAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  cursor: new CursorAdapter(),
  opencode: new OpenCodeAdapter(),
  hermes: new HermesAdapter(),
  gemini: new GeminiCliAdapter(),
  codex: new CodexAdapter(),
  pi: new PiAdapter(),
  openclaw: new OpenClawAdapter(),
};

export function getAgentAdapter(slug: ProductAgentSlug): AgentAdapter {
  return ADAPTERS[slug];
}

export function listProductAgentSlugs(): readonly ProductAgentSlug[] {
  return PRODUCT_AGENT_SLUGS;
}
