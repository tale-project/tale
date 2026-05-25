import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../untrusted_content';
import type { ProjectInstructionsBlock } from './build_project_instructions';
import type { UserPersonalization } from './build_user_personalization';

/**
 * Assemble the chat system prompt from its parts in fixed order:
 *  1. agent identity / instructions (per-agent, cacheable across users)
 *  2. untrusted-content trust rules (always present — gives meaning to
 *     `<untrusted_source>` wrappers emitted by web/integration/video-link
 *     tools; without this the wrapping is decorative)
 *  3. **project instructions** (per project — identical across project
 *     members, cache-friendly). Empty when chat is not in a project.
 *  4. user personalization (custom instructions + memories), per (user,
 *     org) — empty when any kill-switch is engaged. Sits AFTER project
 *     instructions so the privacy auto-disable on shared threads
 *     (`disablePersonalization`) silences only the user block, not the
 *     project context all members see.
 *  5. structured thread context (history summaries / metadata), per turn
 *
 * All call sites in `generate_response.ts` (initial, continue, recovery)
 * MUST go through this helper so multi-step agent loops see the same
 * identity + trust rules + personalization on every step.
 */
export function buildSystemPrompt(
  agentInstructions: string | undefined,
  userPersonalization: UserPersonalization,
  threadContext: string | undefined,
  projectInstructions?: ProjectInstructionsBlock,
): string {
  const parts: string[] = [];
  if (agentInstructions) parts.push(agentInstructions);
  parts.push(UNTRUSTED_CONTENT_SYSTEM_PROMPT);
  if (projectInstructions?.text) parts.push(projectInstructions.text);
  if (userPersonalization.text) parts.push(userPersonalization.text);
  if (threadContext) parts.push(threadContext);
  return parts.join('\n\n');
}
