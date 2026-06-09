import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

type GuardrailPolicy = Doc<'governancePolicies'> | null;

/**
 * Read the three input-guardrail policy rows — chat-filter, PII, moderation — for
 * an org in one parallel round-trip, in that canonical order.
 *
 * Single source for both `getGuardrailsConfigsInternal` (which maps the tuple to
 * a named `{ chatFilter, pii, moderation }` object for the sanitize pipeline) and
 * `getMyFeatureFlags` (which derives the `inputGuardrailsActive` boolean). Keep
 * the order in step with both consumers — they destructure / `.some()` it
 * positionally. Function-free module so server callers import it without the leak
 * concern of value-importing a module that also defines convex functions.
 */
export async function readGuardrailsPolicies(
  ctx: QueryCtx,
  organizationId: string,
): Promise<[GuardrailPolicy, GuardrailPolicy, GuardrailPolicy]> {
  return Promise.all([
    ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q.eq('organizationId', organizationId).eq('policyType', 'chat_filter'),
      )
      .first(),
    ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q.eq('organizationId', organizationId).eq('policyType', 'pii_config'),
      )
      .first(),
    ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('policyType', 'moderation_provider'),
      )
      .first(),
  ]);
}
