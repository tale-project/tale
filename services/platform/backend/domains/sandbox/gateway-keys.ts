import type { Sql } from 'postgres';

import { revokeVirtualKey } from '../../core/node_only/sandbox/llm_gateway_admin.ts';

/**
 * Session-teardown credential reclaim — the 0.5 twin of 0.4's
 * `node_only/sandbox/session_teardown.ts` + the revoke half of
 * `session_admin_actions.destroySandbox`.
 *
 * WHY this exists as its own seam: the gateway has NO native TTL on a
 * virtual key, and `mintVirtualKey` deliberately gives every key a
 * `reset_duration: '1M'` budget window because teardown is supposed to
 * delete it long before any reset matters. A key that outlives its session
 * is therefore a permanent bearer credential with a self-refilling monthly
 * allowance against the org's own provider keys. Every teardown edge — TTL
 * expiry, admin destroy, phantom heal, a deadline-failed agent run — has to
 * come through here, and there is exactly ONE copy of the behaviour so the
 * edges cannot drift.
 *
 * THE ELECTION IS THE TOKEN FLIP. `UPDATE … WHERE revoked_at_ms IS NULL
 * RETURNING llm_gateway_key_id` hands each live key to exactly one caller,
 * so a watchdog sweeping the same session twice, or a destroy racing the
 * expiry sweep, revokes once and the second pass is a no-op. (The gateway
 * itself is idempotent too — `revokeVirtualKey` treats a 404 for an unknown
 * key as success — so even a genuine double DELETE cannot fail a teardown.)
 *
 * FAILURE POSTURE: best-effort per key, like 0.4. A gateway that is
 * unreachable must never wedge a teardown, so the HTTP failure is caught —
 * but it is caught at `console.error` with the key id, because the key stays
 * spendable and only an operator can delete it by hand.
 */

/** Delete the given virtual keys on the gateway. Never throws: one key's
 * failure is logged (loudly — that key stays spendable) and the rest run. */
async function revokeGatewayKeys(
  keyIds: string[],
  context: string,
): Promise<{ revoked: number; failed: number }> {
  let revoked = 0;
  let failed = 0;
  for (const keyId of keyIds) {
    try {
      await revokeVirtualKey(keyId);
      revoked += 1;
    } catch (error) {
      failed += 1;
      // NOT a warning: the key survives with a self-refilling monthly
      // budget against this org's provider keys, and nothing else tracks
      // it — an operator has to delete it on the gateway by hand.
      console.error(
        `[sandbox] LEAKED gateway key ${keyId} (${context}): revoke failed, the key stays spendable until an operator deletes it:`,
        error,
      );
    }
  }
  return { revoked, failed };
}

/**
 * Claim and revoke the gateway virtual keys a torn-down session still holds.
 *
 * Scope:
 *  - no `execId` — the WHOLE session (TTL expiry, destroy, phantom heal):
 *    every unrevoked session token is marked revoked and every gateway key
 *    among them deleted, plus the key id parked on the session row itself
 *    (`app.sandbox_sessions.llm_gateway_key_id`, cleared here so a later
 *    sweep can tell a revoked key from a live one — nothing reads that
 *    column downstream, unlike the token table's copy, which the run
 *    provenance ledger matches turns by and which therefore keeps its id
 *    and carries `revoked_at_ms` as the mark).
 *  - with `execId` — ONE turn of a STANDING session (a deadline-failed
 *    task-agent run): only that exec's minted key, so a sibling turn still
 *    running on the same `pa-<agentId>` session keeps its own credential.
 */
export async function revokeSessionGatewayKeys(
  sql: Sql,
  args: { organizationId: string; sessionId: string; execId?: string },
): Promise<{ revoked: number; failed: number }> {
  const execId = args.execId ?? null;
  const now = Date.now();
  // The flip IS the claim — see the module note. An exec-scoped teardown
  // narrows to the key that exec's op row minted; a token row with no
  // gateway key (the subscription lane mints none) never matches it.
  const claimed = await sql<{ keyId: string | null }[]>`
    UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${now}
    WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
      AND revoked_at_ms IS NULL
      AND (${execId}::text IS NULL OR llm_gateway_key_id = (
        SELECT minted_key_id FROM app.sandbox_session_ops
        WHERE session_id = ${args.sessionId} AND exec_id = ${execId}
        LIMIT 1
      ))
    RETURNING llm_gateway_key_id AS "keyId"
  `;
  const keyIds = new Set(
    claimed
      .map((row) => row.keyId)
      .filter((keyId): keyId is string => keyId !== null),
  );
  if (execId === null) {
    // `RETURNING` answers with the NEW row, so the id has to be read before
    // the clear — one statement, so the `FOR UPDATE` re-check makes this a
    // claim too: a racing sweep sees the already-cleared row and skips it.
    const parked = await sql<{ keyId: string }[]>`
      WITH live AS (
        SELECT id, llm_gateway_key_id AS key_id
        FROM app.sandbox_sessions
        WHERE session_id = ${args.sessionId}
          AND org_id = ${args.organizationId}
          AND llm_gateway_key_id IS NOT NULL
        FOR UPDATE
      ), cleared AS (
        UPDATE app.sandbox_sessions SET llm_gateway_key_id = NULL
        WHERE id IN (SELECT id FROM live)
        RETURNING id
      )
      SELECT key_id AS "keyId" FROM live
      WHERE id IN (SELECT id FROM cleared)
    `;
    for (const row of parked) keyIds.add(row.keyId);
  }
  if (keyIds.size === 0) return { revoked: 0, failed: 0 };
  return revokeGatewayKeys(
    [...keyIds],
    execId === null
      ? `session ${args.sessionId}`
      : `session ${args.sessionId} exec ${execId}`,
  );
}
