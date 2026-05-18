import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../untrusted_content';
import type { UserPersonalization } from './build_user_personalization';

/**
 * Assemble the chat system prompt from its parts in fixed order:
 *  1. agent identity / instructions (per-agent, cacheable across users)
 *  2. untrusted-content trust rules (always present — gives meaning to
 *     `<untrusted_source>` wrappers emitted by web/integration/video-link
 *     tools; without this the wrapping is decorative)
 *  3. user personalization (custom instructions + memories), per (user,
 *     org) — empty when any kill-switch is engaged
 *  4. structured thread context (history summaries / metadata), per turn
 *
 * All call sites in `generate_response.ts` (initial, continue, recovery)
 * MUST go through this helper so multi-step agent loops see the same
 * identity + trust rules + personalization on every step.
 */
export function buildSystemPrompt(
  agentInstructions: string | undefined,
  userPersonalization: UserPersonalization,
  threadContext: string | undefined,
): string {
  const parts: string[] = [];
  if (agentInstructions) parts.push(agentInstructions);
  parts.push(UNTRUSTED_CONTENT_SYSTEM_PROMPT);
  if (userPersonalization.text) parts.push(userPersonalization.text);
  if (threadContext) parts.push(threadContext);
  return parts.join('\n\n');
}
