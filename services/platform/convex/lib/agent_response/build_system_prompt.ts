import type { UserPersonalization } from './build_user_personalization';

/**
 * Assemble the chat system prompt from its three parts in fixed order:
 *  1. agent identity / instructions (per-agent, cacheable across users)
 *  2. user personalization (custom instructions + memories), per (user,
 *     org) — empty when any kill-switch is engaged
 *  3. structured thread context (history summaries / metadata), per turn
 *
 * All three call sites in `generate_response.ts` (initial, continue,
 * recovery) MUST go through this helper so multi-step agent loops see
 * the same identity + personalization on every step.
 */
export function buildSystemPrompt(
  agentInstructions: string | undefined,
  userPersonalization: UserPersonalization,
  threadContext: string | undefined,
): string {
  const parts: string[] = [];
  if (agentInstructions) parts.push(agentInstructions);
  if (userPersonalization.text) parts.push(userPersonalization.text);
  if (threadContext) parts.push(threadContext);
  return parts.join('\n\n');
}
