import type { Sql } from 'postgres';

import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import {
  activateCreatedSession,
  markSessionDestroyed,
  reserveSessionSlot,
} from './sessions.ts';

/**
 * The sandbox session verbs the render lane (`renderUrlsInSandbox`) calls:
 * reserve a render slot against the organization's quota, activate or settle
 * the row, and mark it destroyed. One table for every ctx the lane runs on —
 * the crawl engine's and a chat turn's (`web_fetch` renders a page that needs
 * a browser) — so the two can never answer the lane differently.
 */
export function renderLaneShimHandlers(sql: Sql): ShimHandlers {
  return {
    'sandbox/session_mutations:reserveSessionSlotAndInsert': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        profile: unknown;
        ownerType: string;
        ownerId: string;
        createdBy: string;
      };
      // Quota errors propagate as-is: the render lane turns them into its
      // `RenderCapacityError` (a scan waits for a slot, a chat read explains).
      return reserveSessionSlot(sql, args);
    },
    'sandbox/session_mutations:setSessionStatus': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as {
        rowId: string;
        status: string;
        /** The spawner holds nothing under the row's id (it refused the
         * create): the row is settled as collected, so the watchdog's
         * COLLECT pass never destroys the id — whose preserved workspace
         * may be another incarnation's. */
        collected?: boolean;
      };
      // The activation after a fresh create: never of a row settled while
      // the create ran (a Destroy that landed meanwhile) — the batch fails.
      if (args.status === 'active') {
        if (!(await activateCreatedSession(sql, args.rowId))) {
          throw new Error(
            `the sandbox session row ${args.rowId} was settled while its sandbox was being created`,
          );
        }
        return null;
      }
      const now = Date.now();
      await sql`
        UPDATE app.sandbox_sessions SET
          status = ${args.status}, last_activity_at_ms = ${now},
          destroyed_at_ms = CASE
            WHEN ${args.status} = 'destroyed' OR ${args.collected === true}
            THEN ${now}::bigint ELSE destroyed_at_ms END
        WHERE id = ${args.rowId}
      `;
      return null;
    },
    'sandbox/session_mutations:markSessionRowDestroyed': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the render lane passes exactly this shape
      const args = raw as { organizationId: string; sessionId: string };
      return markSessionDestroyed(sql, args);
    },
  };
}
