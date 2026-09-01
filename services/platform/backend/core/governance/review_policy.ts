/**
 * The `review_policy` governance read — who may sign off agent work parked
 * at review.
 *
 * Reads exactly like `approval_policy` (approvals/gate.ts): the per-org JSON
 * file under `$TALE_CONFIG_DIR/<org>/governance/review-policy.json` is the
 * source of truth, mirrored into `configCache` for V8 reads
 * (`readPolicyRow`), validated against `reviewPolicyConfigSchema`. A missing
 * file means no extra requirement — today's behaviour exactly — and a
 * malformed one falls back to absent with a logged warning (the
 * approval-policy fallback stance: a broken governance file must not brick
 * the review gate, and the warning is the operator's signal to fix it).
 *
 * Policy WRITES ride the generic governance write/audit path — the file
 * store validates against `POLICY_SCHEMAS.review_policy` and the shared
 * policy audit covers the change; nothing bespoke lives here.
 */

import {
  type ReviewPolicyConfig,
  reviewPolicyConfigSchema,
} from '../../../lib/shared/schemas/governance';
import type { DatabaseReader } from '../lib/ctx';
import { readPolicyRow } from './helpers';

/** The org's effective review policy, or `null` when none is on file (or
 * the file is malformed — logged, treated as absent). */
export async function readReviewPolicy(
  db: DatabaseReader,
  organizationId: string,
): Promise<ReviewPolicyConfig | null> {
  const row = await readPolicyRow(db, organizationId, 'review_policy');
  if (row === null) return null;
  const parsed = reviewPolicyConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `[governance] malformed review_policy for org '${organizationId}' — treating it as absent`,
    );
    return null;
  }
  return parsed.data;
}
