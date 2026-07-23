/**
 * 0.4.0 / 25 — introduce `integrationOauthStates`, the pending-authorization
 * table of the integration OAuth2 flow.
 *
 * One row exists for the few minutes between a consent redirect and the
 * callback that consumes it, holding the hash of the opaque state token, the
 * organization/user/connector the callback may act for, and the PKCE verifier.
 * The table is introduced EMPTY: it holds no history, only in-flight
 * authorizations, and every row is written by the `start` route and deleted by
 * the `callback` that claims it (or swept once expired).
 *
 * There is nothing to transform forward — a purely additive table cannot be
 * replayed against today's schema (Convex validates existing rows at push
 * time) — so `up` is a documented no-op. `down` removes rows so a deployment
 * rolled back past this release, whose schema does not declare the table,
 * validates. Nothing durable is lost: an authorization interrupted by a
 * rollback is simply restarted, which is also what its expiry would have
 * forced.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the integrationOauthStates pending-authorization table',
  description:
    'Introduces the integrationOauthStates table that holds one short-lived row per OAuth2 consent redirect (hashed state, bound organization/user/connector, PKCE verifier). up is a documented no-op because the table starts empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'integrationOauthStates',

  async up(_ctx, _doc) {
    // No-op: the table is introduced empty and only the OAuth start route
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
