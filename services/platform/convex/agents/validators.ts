/**
 * Agent name validation + shared Convex validators.
 *
 * Runtime-agnostic — safe to import from both Node.js and edge runtimes.
 */

import { v } from 'convex/values';

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function validateAgentName(name: string): boolean {
  return AGENT_NAME_REGEX.test(name);
}

/**
 * Convex validator parallel to `skillBindingResolvedEntrySchema` (zod)
 * in `lib/shared/schemas/agents.ts`. Both must stay in lockstep — the
 * frontend writes go through the zod schema; the runtime reads through
 * Convex's `v.*` validator. The shape was redeclared inline in
 * `agent_chat/internal_actions.ts` until consolidation.
 */
export const skillBindingResolvedEntryValidator = v.object({
  slug: v.string(),
  versionHash: v.string(),
  toolNames: v.array(v.string()),
  integrationBindings: v.array(v.string()),
  workflowBindings: v.array(v.string()),
});
