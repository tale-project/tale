/**
 * 0.2.90 / 09 — app-embedded discussions: add the `threadMetadata` kind
 * `'app_discussion'` plus its `appSlug` / `subjectType` / `subjectId` columns
 * and the `by_org_app_subject` index.
 *
 * Purely-ADDITIVE, data-safe shape changes that ship together:
 *  - `kind` union gains the literal `'app_discussion'` (a WIDENED enum) — the
 *    AgentChat runtime block's ONE shared thread per
 *    (organizationId, appSlug, subjectType, subjectId), resolved by
 *    `threads/get_or_create_automation_thread.ts`.
 *  - Three new optional columns `appSlug`, `subjectType`, `subjectId` and the
 *    `by_org_app_subject` index over
 *    ['organizationId', 'appSlug', 'subjectType', 'subjectId']. New optional
 *    fields + a new index are data-safe (Convex re-validates existing rows
 *    fine; the schema-snapshot guard classes it as safe growth).
 *
 * GDPR / retention: `app_discussion` rows inherit the project_discussion
 * semantics unchanged — they live in `threadMetadata`, so the retention
 * grace-window machinery (`status` + `statusChangedAt`), the admin Trash
 * flows, and GDPR erasure (`by_org_user` enumeration keyed on the creating
 * user) all apply as they already do for the other discussion kinds. As with
 * project discussions, erasing the creator removes the shared thread.
 *
 * Because both sides only add capacity, there is nothing to rewrite in
 * existing data: every pre-change `threadMetadata` row is already valid under
 * the new shape. This is therefore a `reference` migration — it records the
 * shipped shape change for the audit trail and keeps its (no-op)
 * forward/inverse transforms under round-trip test; the runner never executes
 * a `reference` migration (Convex validates at push time, so an already-safe
 * additive change needs no post-deploy pass) — the test calls `up`/`down`
 * directly.
 *
 * up: NO-OP. Nothing to backfill — the new columns are absent on every
 * historical row and stay absent (only `getOrCreateAutomationThread` populates
 * them; no app-subject attribution can be reconstructed for pre-change rows).
 * down: drop `appSlug`/`subjectType`/`subjectId` if present and clear a
 * `kind: 'app_discussion'` back to undefined, so a row re-validates against
 * the pre-change schema (which had neither the columns nor the literal). A
 * downgraded app thread degrades to a plain owner-only chat — no message data
 * is lost. Idempotent.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: "Add threadMetadata 'app_discussion' kind + app-subject columns",
  description:
    "Adds the 'app_discussion' threadMetadata kind (the AgentChat block's " +
    'one shared thread per (organizationId, appSlug, subjectType, subjectId) ' +
    'triplet), the optional appSlug/subjectType/subjectId columns, and the ' +
    'by_org_app_subject index. Access is org-membership-gated like ' +
    'project/task discussions; GDPR erasure and retention inherit the ' +
    'project_discussion semantics unchanged (threadMetadata rows, by_org_user ' +
    'erasure keyed on the creator, status grace-window disposal). Purely ' +
    'additive and data-safe (widened enum + new optional fields), so up is a ' +
    'documented no-op and down strips the new columns and clears the new ' +
    'kind literal to re-validate against the pre-change schema. ' +
    'Reference-only: the runner never executes it.',
  destructive: false,
  snapshot: 'none',
  table: 'threadMetadata',

  async up(_ctx, _doc) {
    // No-op: `appSlug`/`subjectType`/`subjectId` are NEW optional columns and
    // `'app_discussion'` is a NEW kind literal. Historical rows carry no
    // app-subject attribution and none can be reconstructed, so there is
    // nothing to backfill. Only `getOrCreateAutomationThread` writes the new shape.
    // Kept explicit + idempotent.
  },

  async down(ctx, doc) {
    // Strip the new columns + kind literal so the row re-validates against
    // the pre-change schema. Absent already → nothing to do (idempotent).
    const clearsKind = doc.kind === 'app_discussion';
    if (
      doc.appSlug === undefined &&
      doc.subjectType === undefined &&
      doc.subjectId === undefined &&
      !clearsKind
    ) {
      return;
    }
    // `appSlug` was renamed out of the live schema by the later apps→automations
    // cutover; this historical migration still clears the pre-change column, so
    // the write is untyped (`as any`) — matching `v0_2_88/01`'s convention.
    // oxlint-disable-next-line typescript/no-explicit-any -- field absent from the current schema
    await (ctx.db as any).patch(doc._id, {
      appSlug: undefined,
      subjectType: undefined,
      subjectId: undefined,
      ...(clearsKind ? { kind: undefined } : {}),
    });
  },
});
