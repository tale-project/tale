'use node';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action } from '../../_generated/server';
import { authComponent } from '../../auth';
import { loadGuardrailsSnapshot } from '../sanitize';

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
    orgSlug: v.string(),
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.governance.internal_mutations.requireGovernanceAdminInternal,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    const direction = args.direction ?? 'input';
    const snapshot = await loadGuardrailsSnapshot(ctx, args.organizationId);
    const mod = snapshot.moderation;

    if (!mod || !mod.enabled) {
      return {
        ok: false,
        kind: 'not_configured' as const,
        hint: 'Moderation provider is saved but Enabled toggle is off. Turn it on first.',
      };
    }

    const { outcome, extras } = await ctx.runAction(
      internal.governance.moderation_provider.internal_actions
        .runModerationProviderAction,
      {
        organizationId: args.organizationId,
        orgSlug: args.orgSlug,
        direction,
        text: args.text,
        endpoint: mod.config.endpoint,
        responseShape: mod.config.responseShape,
        categoryMappings: mod.config.categoryMappings,
        failBehavior: mod.config.failBehavior,
      },
    );

    const hint =
      outcome.kind === 'step_error' && outcome.errorClass === 'http_4xx'
        ? extras.httpStatus === 401 || extras.httpStatus === 403
          ? 'The provider rejected the API key. Check the value in the "API key" section — for OpenAI it must start with sk- (not sk-or-).'
          : extras.httpStatus === 404
            ? 'The endpoint URL is wrong. Re-apply a preset or double-check the path.'
            : `Provider returned HTTP ${extras.httpStatus}. See provider docs for what that status means.`
        : outcome.kind === 'step_error' && outcome.errorClass === 'timeout'
          ? 'Provider did not respond within the configured timeout. Increase timeoutMs or check your network.'
          : outcome.kind === 'step_error' && outcome.errorClass === 'config'
            ? 'Config is missing the API key or has a malformed request template. Save the API key below and re-apply a preset if unsure.'
            : outcome.kind === 'step_error' && outcome.errorClass === 'parse'
              ? 'Provider response did not match the configured Response shape. If you picked Custom JSONPath, check the categoriesPath.'
              : outcome.kind === 'pass' &&
                  mod.config.categoryMappings.length === 0
                ? 'Call succeeded, but no category mappings are configured — the provider can never flag anything until you add at least one.'
                : undefined;

    return {
      ok: outcome.kind !== 'step_error',
      kind: outcome.kind,
      categoryIds: outcome.categoryIds,
      matchCount: outcome.matchCount,
      httpStatus: extras.httpStatus,
      durationMs: extras.durationMs,
      errorClass: extras.errorClass,
      circuitOpened: extras.circuitOpened,
      hint,
    };
  },
});
