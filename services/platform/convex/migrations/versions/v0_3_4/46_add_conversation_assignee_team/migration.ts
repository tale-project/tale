/**
 * 0.3.4 / 46 — optional `conversations.assigneeTeamId` for the team queue.
 *
 * Adds an optional Better Auth teamId naming the team a conversation is queued
 * to — set alongside `assigneeUserId` (an individual owner) and used to scope
 * team-visible conversations when the org's `conversation_access` policy is on.
 * Purely additive, so every existing conversation row stays valid without the
 * field and the change cannot be replayed against today's schema (Convex
 * validates existing rows at push time); this documents the already-shipped
 * change and keeps its inverse under round-trip test.
 *
 * up: NO-OP. New/updated rows populate `assigneeTeamId` at write time;
 * historical rows remain un-queued (no team scope).
 * down: drop `assigneeTeamId` when present so rows re-validate against the
 * pre-change schema. Idempotent.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Add optional conversations.assigneeTeamId team-queue field',
  description:
    'Adds the optional conversations.assigneeTeamId (team queue owner) set alongside assigneeUserId. Purely additive: up is a documented no-op and down drops the field to re-validate against the pre-change schema. Reference-only, the runner never executes it.',
  destructive: false,
  snapshot: 'none',
  table: 'conversations',

  async up(_ctx, _doc) {
    // No-op: optional field — existing rows stay valid without `assigneeTeamId`.
  },

  async down(ctx, doc) {
    if (doc.assigneeTeamId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- dropped optional field
    await (ctx.db as any).patch(doc._id, { assigneeTeamId: undefined });
  },
});
