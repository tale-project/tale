'use node';

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action } from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';

// `loadGuardrailsSnapshot` (`convex/governance/sanitize.ts`)
// moved with the config-loading/PII group. `testModerationProvider` is the
// admin-triggered "Test connection" button
// (`app/features/settings/governance/components/moderation-test-connection-panel.tsx`)
// — offline. That panel's own `catch` already turns a thrown error into
// `{ ok: false, kind: 'step_error', errorClass: 'unknown', hint: message }`,
// so a plain `ConvexError` renders exactly like a real step failure with no
// further UI changes needed.

type ErrorClass =
  | 'timeout'
  | 'network'
  | 'parse'
  | 'http_4xx'
  | 'http_5xx'
  | 'config'
  | 'unknown';

interface TestResult {
  ok: boolean;
  kind:
    | 'pass'
    | 'modified'
    | 'flagged'
    | 'blocked'
    | 'step_error'
    | 'not_configured';
  categoryIds?: string[];
  matchCount?: number;
  httpStatus?: number;
  durationMs?: number;
  errorClass?: ErrorClass;
  circuitOpened?: boolean;
  hint?: string;
}

/**
 * Admin-triggered round-trip through the real moderation provider path.
 *
 * Catches config errors (bad URL, wrong key, invalid request template,
 * misconfigured JSONPath, ...) at the moment of configuration rather
 * than later during live chat. Uses the exact same internal action the
 * sanitize pipeline calls, so the outcome shape and error classes match
 * what you'd see in `chatFilterEvents`.
 *
 * Returns a *shape* that's safe to render in the UI — no raw provider
 * response body, no decrypted auth header. If the provider blocks the
 * text we still return the blocked outcome so the admin sees detection
 * actually works end-to-end.
 */
export const testModerationProvider = action({
  args: {
    organizationId: v.string(),
    text: v.string(),
    direction: v.optional(v.union(v.literal('input'), v.literal('output'))),
  },
  returns: v.object({
    ok: v.boolean(),
    // What happened: "pass" / "flagged" / "blocked" / "step_error" — same
    // vocabulary the pipeline uses internally.
    kind: v.union(
      v.literal('pass'),
      v.literal('modified'),
      v.literal('flagged'),
      v.literal('blocked'),
      v.literal('step_error'),
      v.literal('not_configured'),
    ),
    categoryIds: v.optional(v.array(v.string())),
    matchCount: v.optional(v.number()),
    httpStatus: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    errorClass: v.optional(
      v.union(
        v.literal('timeout'),
        v.literal('network'),
        v.literal('parse'),
        v.literal('http_4xx'),
        v.literal('http_5xx'),
        v.literal('config'),
        v.literal('unknown'),
      ),
    ),
    circuitOpened: v.optional(v.boolean()),
    hint: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<TestResult> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.governance.internal_mutations.requireGovernanceAdminInternal,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    throw new ConvexError(
      'Testing the moderation provider is offline while the platform AI backend is rewritten.',
    );
  },
});
