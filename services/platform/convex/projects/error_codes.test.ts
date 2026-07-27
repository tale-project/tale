import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseYamlOrThrow } from '../../lib/shared/config/yaml';

/**
 * Consistency contract between the Convex mutation/action error
 * vocabulary and the i18n `projects.errors.*` keys.
 *
 * Any new `ConvexError({ code: 'PROJECT_...' })` in
 * `convex/projects/**.ts` or in the chat-path plumbing (unified_chat /
 * start_chat) must land with a matching error message in `en.yml`.
 * Without that, the UI falls back to "Couldn't update" generic text and
 * we lose the diagnostic value of the code.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// `__dirname` is `services/platform/convex/projects`. Two parents up
// lands at `services/platform`. From there `convex/...` and
// `messages/...` resolve correctly.
const PLATFORM_ROOT = join(__dirname, '..', '..');

function readSource(relative: string): string {
  return readFileSync(join(PLATFORM_ROOT, 'convex', relative), 'utf-8');
}

/** The English catalog, read through the shared safe YAML loader. */
function readMessages(): Record<string, unknown> {
  return parseYamlOrThrow(
    readFileSync(join(PLATFORM_ROOT, 'messages', 'en.yml'), 'utf-8'),
    { maxBytes: 4 * 1024 * 1024 },
  ) as Record<string, unknown>;
}

function extractThrownProjectCodes(src: string): Set<string> {
  const codes = new Set<string>();
  // Match: ConvexError({ code: 'PROJECT_FOO' }) or ConvexError({code:'PROJECT_FOO',
  const re =
    /ConvexError\(\s*\{\s*code:\s*['"]((?:PROJECT_|DOCUMENT_|THREAD_|RBAC_|ROLE_|ORG_)[A-Z_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    codes.add(m[1]);
  }
  return codes;
}

describe('projects error-code ↔ i18n key consistency', () => {
  it('every projects error code thrown server-side has a matching i18n message', () => {
    // The chat entry points (agents/chat_turn.ts, agents/start_chat.ts)
    // threw project-scoped codes too; they are offline while the chat
    // backend is rebuilt and rejoin this list when their rebuilt versions
    // land. Their i18n messages are tolerated as dormant below.
    const sources = [
      'projects/mutations.ts',
      'projects/queries.ts',
      'projects/internal_queries.ts',
    ];
    const allThrownCodes = new Set<string>();
    for (const path of sources) {
      const src = readSource(path);
      for (const code of extractThrownProjectCodes(src)) {
        allThrownCodes.add(code);
      }
    }

    const messages = readMessages();
    const projects = messages.projects as
      | { errors?: Record<string, unknown> }
      | undefined;
    const errorKeys = new Set(Object.keys(projects?.errors ?? {}));

    const missing: string[] = [];
    for (const code of allThrownCodes) {
      // Skip codes that don't represent UI-surfaceable conditions — these
      // are unauthenticated/internal paths we don't currently surface.
      if (code === 'UNAUTHENTICATED') continue;
      if (!errorKeys.has(code)) missing.push(code);
    }
    missing.sort();
    expect(
      missing,
      `Server throws ConvexError({ code: '<X>' }) for these codes but ` +
        `projects.errors.<X> doesn't exist in en.yml. Add a translation ` +
        `for each so the UI can show a meaningful message instead of the ` +
        `generic fallback:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every i18n error key corresponds to a code thrown by the server (no orphan messages)', () => {
    // The chat entry points (agents/chat_turn.ts, agents/start_chat.ts)
    // threw project-scoped codes too; they are offline while the chat
    // backend is rebuilt and rejoin this list when their rebuilt versions
    // land. Their i18n messages are tolerated as dormant below.
    const sources = [
      'projects/mutations.ts',
      'projects/queries.ts',
      'projects/internal_queries.ts',
    ];
    const allThrownCodes = new Set<string>();
    for (const path of sources) {
      for (const code of extractThrownProjectCodes(readSource(path))) {
        allThrownCodes.add(code);
      }
    }

    const messages = readMessages();
    const projects = messages.projects as
      | { errors?: Record<string, unknown> }
      | undefined;

    // Forward-compatibility allowlist: i18n keys we ship in en.yml that
    // aren't thrown today but represent UI states (e.g., empty effective
    // set, restricted-model select) or RBAC errors thrown by shared
    // helpers — explicitly carried for the UI's typed error handling.
    const ALLOWED_NON_THROWN = new Set([
      // Thrown by the chat entry points (thread-project binding check),
      // which are offline while the chat backend is rebuilt; the message
      // stays so the rebuilt chat ships with it intact.
      'PROJECT_MISMATCH',
      'PROJECT_NAME_INVALID',
      'PROJECT_AGENT_NOT_ALLOWED',
      'PROJECT_MODEL_NOT_ALLOWED',
      'PROJECT_INSTRUCTIONS_TOO_LONG',
      'PROJECT_LEGAL_HOLD',
      'PROJECT_DESCRIPTION_INVALID',
      'PROJECT_SHARING_INVALID',
      'PROJECT_TEAM_INVALID',
      // Thrown via a ternary in unified_chat.ts; the regex above only
      // matches literals at the immediate `code:` position so it can't
      // see ternary branches.
      'PROJECT_ORG_MISMATCH',
      // H3: recommended-not-subset validation throws this; same
      // regex-misses-ternary reason as above for one of the branches.
      'PROJECT_RECOMMENDED_NOT_SUBSET',
      // §6 rate-limit code thrown via `mapRateLimitError`; not a literal
      // at the regex match position, and intentionally lives outside the
      // PROJECT_/DOCUMENT_/THREAD_ namespaces so the regex skips it.
      'RATE_LIMITED',
      // Client-side variant of PROJECT_HAS_BOUND_AUTOMATIONS (which
      // `deleteProject`'s bound-automations guard throws): the dialog picks
      // this `{automations}`-named message when the error data carries the
      // automation names, so the key exists in en.yml but no Convex code
      // throws it as a code.
      'PROJECT_HAS_BOUND_AUTOMATIONS_NAMED',
    ]);

    const orphans: string[] = [];
    for (const key of Object.keys(projects?.errors ?? {})) {
      if (allThrownCodes.has(key)) continue;
      if (ALLOWED_NON_THROWN.has(key)) continue;
      orphans.push(key);
    }
    orphans.sort();
    expect(
      orphans,
      `These projects.errors.* keys are defined in en.yml but no Convex ` +
        `code throws them. Either remove the key or add it to the ` +
        `ALLOWED_NON_THROWN set with a comment explaining why:\n  ` +
        orphans.join('\n  '),
    ).toEqual([]);
  });
});
