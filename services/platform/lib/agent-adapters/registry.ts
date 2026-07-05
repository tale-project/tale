// Slug → adapter resolution. The single place entry points map a chosen agent
// to its adapter; adding a new product runtime is one adapter module + a line
// here (and extending PRODUCT_AGENT_SLUGS in events.ts).

import { ClaudeCodeAdapter } from './claude-code/adapter';
import { CursorAdapter } from './cursor/adapter';
import { PRODUCT_AGENT_SLUGS, type ProductAgentSlug } from './events';
import type { AgentAdapter } from './types';

const ADAPTERS: Record<ProductAgentSlug, AgentAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  cursor: new CursorAdapter(),
};

export function getAgentAdapter(slug: ProductAgentSlug): AgentAdapter {
  return ADAPTERS[slug];
}

export function listProductAgentSlugs(): readonly ProductAgentSlug[] {
  return PRODUCT_AGENT_SLUGS;
}
