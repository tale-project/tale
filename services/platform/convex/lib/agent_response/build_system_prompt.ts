import { renderPrompt } from '../prompts/registry';
import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../untrusted_content';
import type { ProjectInstructionsBlock } from './build_project_instructions';
import type { UserPersonalization } from './build_user_personalization';
import { CACHE_BREAKPOINT_MARKER } from './prompt_caching/markers';

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
 *
 * The rules are evaluated per-message and a translation/explicit-language
 * request is one-off (#1622): without that, the model tends to keep replying
 * in the language of a previous one-shot translation instead of mirroring the
 * user's next message.
 */
export function responseLanguageDirective(
  fallbackLocale: string | undefined,
): string {
  const rule3 = fallbackLocale
    ? `reply in the language of the user's locale \`${fallbackLocale}\` (and if that is also indeterminate, English)`
    : 'reply in English';
  return renderPrompt('system.response_language', { rule3 });
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
  /**
   * Whether the stable prefix is genuinely cacheable this turn. Pass `false`
   * when the agent instructions embed time-varying template variables
   * (`{{current_time}}` / `{{current_date}}`): those resolve to a fresh
   * timestamp every call, so the "stable" prefix would change each turn —
   * caching it only wastes cache writes and breaks prewarm prefix-matching.
   * (`{{user_profile}}` is NOT time-varying — see `VOLATILE_TEMPLATE_VARS`.)
   * When `false` we omit the breakpoint marker so the whole system prompt is
   * treated as volatile (no cache_control / breakpoint).
   */
  cacheable = true,
  /**
   * ISO-8601 timestamp injected into the VOLATILE tail so the model stays
   * time-aware without a per-turn timestamp sitting in the cacheable prefix
   * (which is what previously defeated prompt caching — see `buildUserProfile`).
   * Caller-supplied (not `new Date()` here) to keep this builder pure and
   * deterministic. Omitted in tests / when time awareness isn't needed.
   */
  currentTimeIso?: string,
): string {
  // Stable prefix — identical across a thread's turns and across threads on the
  // same agent/project/user. This is the cacheable unit.
  const stable: string[] = [];
  if (agentInstructions) stable.push(agentInstructions);
  stable.push(UNTRUSTED_CONTENT_SYSTEM_PROMPT);
  if (projectInstructions?.text) stable.push(projectInstructions.text);
  if (userPersonalization.text) stable.push(userPersonalization.text);

  // Volatile tail — the current time (per-turn, so it MUST sit here rather than
  // in any agent's cacheable instructions; this is what lets `{{user_profile}}`
  // stay in the stable prefix), then per-turn thread context, then the language
  // directive (appended last so it stays the strongest instruction on output
  // language).
  const volatile: string[] = [];
  if (currentTimeIso) {
    volatile.push(`The current date and time is ${currentTimeIso} (UTC).`);
  }
  if (threadContext) volatile.push(threadContext);
  volatile.push(responseLanguageDirective(fallbackLocale));

  // Join the two groups with the cache-breakpoint marker in place of the usual
  // `'\n\n'` separator. The cache-control middleware splits the system string
  // here (explicit-breakpoints models) or strips the marker back to `'\n\n'`
  // (everything else), so non-caching providers see the byte-identical prompt.
  // When the prefix isn't cacheable, join with a plain `'\n\n'` (no marker) so
  // the middleware places no breakpoint.
  const separator = cacheable ? CACHE_BREAKPOINT_MARKER : '\n\n';
  return `${stable.join('\n\n')}${separator}${volatile.join('\n\n')}`;
}

/**
 * Time-varying template variables make the "stable" prefix change every turn,
 * so an agent whose instructions use any of them is NOT prompt-cacheable.
 *
 * `{{user_profile}}` is intentionally NOT in this set: it now resolves to a
 * byte-stable identity block (name/email/role/org/timezone/locale) — the
 * per-turn current time was moved out of it into the volatile tail of
 * `buildSystemPrompt` (see `resolve_template_variables.ts::buildUserProfile`).
 * Keeping it out is what lets the common chat agent (whose instructions end in
 * `{{user_profile}}`) be prompt-cached. Only `{{current_time}}`/`{{current_date}}`
 * — which an author opts into explicitly — remain volatile.
 */
const VOLATILE_TEMPLATE_VARS = /\{\{\s*(current_time|current_date)\s*\}\}/;

/** Whether agent instructions are safe to place in the cacheable prefix. */
export function instructionsAreCacheable(
  agentInstructions: string | undefined,
): boolean {
  return !agentInstructions || !VOLATILE_TEMPLATE_VARS.test(agentInstructions);
}
