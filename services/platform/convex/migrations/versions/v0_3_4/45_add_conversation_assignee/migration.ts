/**
 * 0.3.4 / 45 — optional `conversations.assigneeUserId` for the internal owner.
 *
 * Adds an optional Better Auth userId naming the member who owns a conversation
 * — message and assignment notifications target the assignee, falling back to
 * org admins when absent. Purely additive, so every existing conversation row
 * stays valid without the field and the change cannot be replayed against
 * today's schema (Convex validates existing rows at push time); this documents
 * the already-shipped change and keeps its inverse under round-trip test.
 *
 * up: NO-OP. New/updated rows populate `assigneeUserId` at write time; historical
 * rows remain unassigned (→ admin fallback).
 * down: drop `assigneeUserId` when present so rows re-validate against the
 * pre-change schema. Idempotent.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Add optional conversations.assigneeUserId owner field',
  description:
    'Adds the optional conversations.assigneeUserId (internal member owner) that message and assignment notifications target. Purely additive: up is a documented no-op and down drops the field to re-validate against the pre-change schema. Reference-only, the runner never executes it.',
  destructive: false,
  snapshot: 'none',
  table: 'conversations',

  async up(_ctx, _doc) {
    // No-op: optional field — existing rows stay valid without `assigneeUserId`.
  },

  async down(ctx, doc) {
    if (doc.assigneeUserId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- dropped optional field
    await (ctx.db as any).patch(doc._id, { assigneeUserId: undefined });
  },
});
