import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../untrusted_content';
import type { ProjectInstructionsBlock } from './build_project_instructions';
import type { UserPersonalization } from './build_user_personalization';

/**
 * Build the response-language directive, applied centrally to every agent.
 *
 * This used to be duplicated inside each built-in agent's `systemInstructions`
 * (referencing the `{{user.language}}` template var); it now lives here so all
 * agents — built-in and custom — share one rule, and the fallback is richer.
 * `fallbackLocale` is resolved by the caller in priority order — UI language →
 * browser locale → org default — and only feeds rule 3. Appended last in the
 * system prompt so it's the strongest, most recent instruction on output
 * language.
 */
export function responseLanguageDirective(
  fallbackLocale: string | undefined,
): string {
  const rule3 = fallbackLocale
    ? `reply in the language of the user's locale \`${fallbackLocale}\` (and if that is also indeterminate, English)`
    : 'reply in English';
  return [
    '## Language',
    '',
    'Choose your reply language by these rules. Evaluate them 1→3 and stop at the first match:',
    '',
    '1. **Explicit request.** If the user\'s latest message explicitly asks for a language (e.g. "reply in German", "auf Deutsch", "répondez en français", "translate to French"), use that language.',
    "2. **Message language.** Otherwise, detect the natural language of the user's latest message and reply in that language.",
    `3. **Fallback.** Only if the latest message has no detectable natural language — code-only, a bare URL, pure numbers, a single emoji, or a one- or two-character ambiguous token — ${rule3}.`,
    '',
    'Never use timezone, IP, or geolocation to choose the reply language; only rule 3 uses the fallback.',
  ].join('\n');
}

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
 *  6. response-language directive: mirror the user's input language, with
 *     `fallbackLocale` (resolved by the caller: UI → browser → org) used
 *     only for ambiguous input. Appended last so it's the strongest
 *     instruction on output language.
 *
 * All call sites in `generate_response.ts` (initial, continue, recovery)
 * MUST go through this helper so multi-step agent loops see the same
 * identity + trust rules + personalization + response language on every step.
 */
export function buildSystemPrompt(
  agentInstructions: string | undefined,
  userPersonalization: UserPersonalization,
  threadContext: string | undefined,
  projectInstructions?: ProjectInstructionsBlock,
  fallbackLocale?: string,
): string {
  const parts: string[] = [];
  if (agentInstructions) parts.push(agentInstructions);
  parts.push(UNTRUSTED_CONTENT_SYSTEM_PROMPT);
  if (projectInstructions?.text) parts.push(projectInstructions.text);
  if (userPersonalization.text) parts.push(userPersonalization.text);
  if (threadContext) parts.push(threadContext);
  parts.push(responseLanguageDirective(fallbackLocale));
  return parts.join('\n\n');
}
