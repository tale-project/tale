/**
 * 0.3.4 / 26 — per-API-key budget scope: add `usageLedger.apiKeyId` and the
 * `apiKey` budget rule scope (+ its `apiKeyId` target).
 *
 * Two purely-ADDITIVE, data-safe shape changes ship together:
 *  - Convex schema: `usageLedgerTable` gains an optional `apiKeyId` field and a
 *    `by_org_apiKey_period` index. A new optional field + new index is data-safe
 *    (Convex re-validates existing rows fine; the schema-snapshot guard classes
 *    it as safe growth).
 *  - File-based governance config: `budgetRuleSchema.scope` gains the literal
 *    `'apiKey'` (a WIDENED enum) and a new optional `apiKeyId` target. Zod strips
 *    unknown keys and a widened enum accepts every existing value, so all
 *    existing on-disk `budgets.json` files keep validating (the config-snapshot
 *    guard classes it as safe growth).
 *
 * Because BOTH sides only add capacity, there is nothing to rewrite in existing
 * data: every pre-change `usageLedger` row and every pre-change budget rule is
 * already valid under the new shapes. This is therefore a `reference` migration
 * — it records the shipped shape change for the audit trail and keeps its
 * (no-op) forward/inverse transforms under round-trip test; the runner never
 * executes a `reference` migration (Convex validates at push time, so an
 * already-safe additive change needs no post-deploy pass) — the test calls
 * `up`/`down` directly.
 *
 * up: NO-OP. Nothing to backfill — `apiKeyId` is absent on every historical row
 * and stays absent (only new openai-compat writes populate it; no attribution
 * can be reconstructed for pre-change rows).
 * down: drop `usageLedger.apiKeyId` if present, so a row re-validates against the
 * pre-change schema (which had no such field). Idempotent; loses only the new
 * attribution column, which the pre-change schema never had. No budget-rule
 * `down` is needed — a widened enum narrows cleanly for rules that never used
 * the new literal, and this reference documents that inverse in prose.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Add usageLedger.apiKeyId + apiKey budget scope',
  description:
    'Adds the optional usageLedger.apiKeyId field (+ by_org_apiKey_period ' +
    "index) and the 'apiKey' budget rule scope with its apiKeyId target, so a " +
    'spend/usage cap can bind to one Better Auth API key independently of the ' +
    "owner's user/team/org budget. Both changes are purely additive and " +
    'data-safe (new optional field + widened enum), so up is a documented ' +
    'no-op and down drops usageLedger.apiKeyId to re-validate against the ' +
    'pre-change schema. Reference-only: the runner never executes it.',
  destructive: false,
  snapshot: 'none',
  table: 'usageLedger',

  async up(_ctx, _doc) {
    // No-op: `apiKeyId` is a NEW optional column. Historical rows have no key
    // attribution and none can be reconstructed, so there is nothing to
    // backfill. Only new openai-compat writes populate the field. Kept explicit
    // + idempotent.
  },

  async down(ctx, doc) {
    // Drop the new column so the row re-validates against the pre-change schema
    // (which had no `apiKeyId`). Absent already → nothing to do (idempotent).
    if (doc.apiKeyId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- new optional field absent from the pre-change Doc type
    await (ctx.db as any).patch(doc._id, { apiKeyId: undefined });
  },
});
