/**
 * 0.3.4 / 31 — drop `conversations.customerId` (contract phase, issue #2618).
 *
 * 0.3.4/27 already clears `customerId` on every row it CAN repoint to a
 * contact (any row with a `contactId`), restoring the exact original value on
 * `down` via the linked contact's `metadata.__migratedFrom` stamp. It
 * deliberately leaves alone the one row shape it cannot safely touch:
 * `customerId` set with no `contactId` at all — a customer/vendor that was
 * hard-deleted before 0.3.4/22-23 ever copied it into `contacts`, so no
 * stamp, and no contact, exists to recover from. `conversations/schema.ts` is
 * about to drop the field entirely, so Convex would reject THAT row at push
 * time even though 27 already ran.
 *
 * `up` clears `customerId` on exactly that residual shape (set, no
 * `contactId`) so the schema drop is safe for the whole table — rows with a
 * `contactId` are 0.3.4/27's job and are skipped here (by the time this
 * migration runs in a real deploy, 27 already cleared them; re-touching a
 * row whose `customerId` some LATER step legitimately cleared would make
 * `down` unable to tell "27 already restored this" from "this row never had
 * one", which is exactly the per-frontier reversibility the chain suite
 * proves — see `testing/chain.test.ts`).
 *
 * `down` is a documented no-op: a row this migration ever touches has no
 * `contactId`, hence no contact, hence no `__migratedFrom` stamp to recover
 * a value from — the equivalence assumption 0.3.4/27 relies on (stamped
 * contact ⇒ recoverable customerId) does not hold here by construction. The
 * value was already effectively unrecoverable (0.3.4/27 reached the same
 * conclusion and left it alone); this migration only removes it because the
 * field itself is leaving the schema. Both directions idempotent.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop conversations.customerId (contract phase)',
  description:
    'Clears the residual customerId shape 0.3.4/27 could never repoint ' +
    '(customerId set, no contactId at all — the customer/vendor was ' +
    'hard-deleted before 0.3.4/22-23 ran), so every row satisfies the ' +
    'schema once customerId leaves it. down is a documented no-op: with no ' +
    'contactId there is no stamped contact to recover a value from, so the ' +
    'id was already unrecoverable — the same conclusion 0.3.4/27 reached ' +
    'for these rows.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['conversations'] },
  table: 'conversations',

  async up(ctx, doc) {
    if (doc.customerId === undefined) return; // nothing to clear
    if (doc.contactId !== undefined) return; // 0.3.4/27's row shape, not ours
    await ctx.db.patch(
      doc._id as Id<'conversations'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId: undefined,
      } as any,
    );
  },

  async down() {
    // No-op — see header. A row this migration clears has no contactId, so
    // there is nothing to recover the original customerId from.
  },
});
