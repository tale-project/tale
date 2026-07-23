/**
 * 0.4.0 / 24 — introduce `slackTeamRoutes`, the inbound Slack routing table.
 *
 * Slack delivers every connected workspace's events to one deployment-wide
 * Request URL, and the only tenant discriminator in the payload is `team_id`.
 * This table is that lookup: workspace → the organization that installed the
 * app, plus the credential holding its bot token. It replaces no data — the
 * routing table of the retired backend was dropped, rows snapshotted, by
 * 0.4.0/11 — so this table is introduced EMPTY and every row in it is written
 * by a completed OAuth install.
 *
 * There is nothing to transform forward: a purely additive table cannot be
 * replayed against today's schema (Convex validates existing rows at push
 * time), so `up` is a documented no-op. `down` removes rows, which is what
 * makes a rollback past this release valid — a deployment on the previous
 * schema does not declare the table, and a row in an undeclared table is
 * exactly what release validation refuses. Nothing a rollback could want is
 * lost: a route is re-derived by re-running the install.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the slackTeamRoutes inbound routing table',
  description:
    'Introduces the slackTeamRoutes table that maps a Slack workspace team_id to the organization that installed the app. up is a documented no-op because the table starts empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'slackTeamRoutes',

  async up(_ctx, _doc) {
    // No-op: the table is introduced empty and only the OAuth install path
    // writes it, so there is no forward transform to replay.
  },

  async down(ctx, doc) {
    // Drop the row so the world re-validates against the pre-change schema.
    // Guarded by a read: deleting an already-deleted id throws, and a second
    // pass over the same rows must be a no-op.
    // oxlint-disable-next-line typescript/no-explicit-any -- MigrationDoc ids are table-agnostic
    const db = ctx.db as any;
    const existing = await db.get(doc._id);
    if (!existing) return;
    await db.delete(doc._id);
  },
});
