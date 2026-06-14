import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

type GuardrailPolicy = Doc<'configCache'> | null;

/**
 * Read the three input-guardrail policy rows — chat-filter, PII, moderation — for
 * an org in one parallel round-trip, in that canonical order, from the
 * file-derived `configCache` mirror (domain `'governance'`).
 *
 * Single source for both `getGuardrailsConfigsInternal` (which maps the tuple to
 * a named `{ chatFilter, pii, moderation }` object for the sanitize pipeline) and
 * `getMyFeatureFlags` (which derives the `inputGuardrailsActive` boolean). Keep
 * the order in step with both consumers — they destructure / `.some()` it
 * positionally. Returns the cache docs (with `_id`) so the sanitize snapshot can
 * still derive `policyDocId` for chat-filter event linkage. Function-free module
 * so server callers import it without the leak concern of value-importing a
 * module that also defines convex functions.
 */
export async function readGuardrailsPolicies(
  ctx: QueryCtx,
  organizationId: string,
): Promise<[GuardrailPolicy, GuardrailPolicy, GuardrailPolicy]> {
  const read = (key: string): Promise<GuardrailPolicy> =>
    ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('domain', 'governance')
          .eq('key', key),
      )
      .first();
  return Promise.all([
    read('chat_filter'),
    read('pii_config'),
    read('moderation_provider'),
  ]);
}
