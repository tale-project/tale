import type { Sql } from 'postgres';

import type { GatewaySpendReading } from '../../core/node_only/sandbox/gateway_key_settlement.ts';
import {
  readVirtualKeySpend,
  revokeVirtualKey,
  setVirtualKeyBudget,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import { isRelayKeyId } from '../../core/node_only/sandbox/relay_keys.ts';

/**
 * A turn's key, read, revoked or capped whichever server serves it
 * (tale-project/tale#4942): the model relay, which keeps a key's spend on
 * its turn's op row, or — for a turn the sandbox LLM gateway served before
 * the relay — the gateway.
 */

/** What a turn's key has spent: a relay key's booked spend on its op row
 * (gone when no op carries the key), a gateway key's from the gateway. */
export async function readTurnKeySpend(
  sql: Sql,
  keyId: string,
): Promise<GatewaySpendReading> {
  if (!isRelayKeyId(keyId)) return readVirtualKeySpend(keyId);
  const rows = await sql<{ cents: number }[]>`
    SELECT relay_spent_cents::float8 AS cents
    FROM app.sandbox_session_ops
    WHERE minted_key_id = ${keyId}
    LIMIT 1
  `;
  const op = rows[0];
  return op === undefined
    ? { status: 'gone' }
    : { status: 'ok', cents: op.cents };
}

/** Revoke a turn's key: a relay key's tokens stop working — the relay
 * refuses them within seconds — and a gateway key is deleted at the
 * gateway. */
export async function revokeTurnKey(sql: Sql, keyId: string): Promise<void> {
  if (!isRelayKeyId(keyId)) {
    await revokeVirtualKey(keyId);
    return;
  }
  await sql`
    UPDATE app.sandbox_session_tokens
    SET revoked_at_ms = ${Date.now()}
    WHERE llm_gateway_key_id = ${keyId} AND revoked_at_ms IS NULL
  `;
}

/** Move a turn key's spend cap: a gateway key's, at the gateway. A relay
 * key has no cap to move — the relay weighs the turn's images against its
 * allowance at every call — so it stands as it is. */
export async function setTurnKeyBudget(
  keyId: string,
  cents: number,
): Promise<'ok' | 'gone'> {
  return isRelayKeyId(keyId) ? 'ok' : setVirtualKeyBudget(keyId, cents);
}
