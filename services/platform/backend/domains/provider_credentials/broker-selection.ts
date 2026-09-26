import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  transactSerializable,
} from '@tale/shared/db/serializable';
import { brokerSelectionSchema } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { AppError } from '../../../lib/shared/errors/app-error.ts';
import type { BrokerSelectionResult } from '../../core/provider_credentials/broker_pool.ts';

const accountHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const brokerSelectionArgsSchema = z
  .object({
    organizationId: z.string().min(1),
    credentialId: z.string().min(1),
    selection: brokerSelectionSchema,
    candidates: z
      .array(
        z
          .object({
            hash: accountHashSchema,
            excluded: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();

export const brokerFailureArgsSchema = z
  .object({
    organizationId: z.string().min(1),
    brokerTokenHash: accountHashSchema,
    apiErrorStatus: z.number().int(),
  })
  .strict();

interface AccountState {
  hash: string;
  sequence: string;
  cooldownUntilMs: number;
}

/**
 * Serialize a pick across workers. Retry queue locks are the same established
 * mechanism as budget admissions: a contended SERIALIZABLE transaction retries
 * after taking the session lock, before its snapshot. The credential sequence
 * bump prevents a stale snapshot from picking the account its predecessor did.
 * Network I/O and all plaintext credentials stay outside this transaction.
 */
export async function selectBrokerAccount(
  sql: Sql,
  args: z.infer<typeof brokerSelectionArgsSchema>,
  nowMs = Date.now(),
  randomFn: () => number = Math.random,
): Promise<BrokerSelectionResult> {
  const queueKey = `broker-selection:${args.organizationId}:${args.credentialId}`;
  return transactSerializable(sql, async (tx) => {
    try {
      await tx`SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${queueKey}))`;
      const rows = await tx<{ sequence: string }[]>`
        UPDATE app.provider_credentials
        SET broker_selection_sequence = broker_selection_sequence + 1
        WHERE org_id = ${args.organizationId} AND id = ${args.credentialId}
          AND auth_method = 'subscription-broker' AND status = 'active'
        RETURNING broker_selection_sequence::text AS sequence
      `;
      const sequence = rows[0]?.sequence;
      if (sequence === undefined)
        throw new AppError({
          code: 'CREDENTIAL_NOT_FOUND',
          message: 'The broker credential is no longer active.',
        });
      const hashes = [...new Set(args.candidates.map(({ hash }) => hash))];
      if (hashes.length === 0) return { hash: null, fellBack: false };
      const states = await tx<AccountState[]>`
        SELECT account_hash AS hash, last_selected_sequence::text AS sequence,
          cooldown_until_ms::float8 AS "cooldownUntilMs"
        FROM app.provider_broker_accounts
        WHERE org_id = ${args.organizationId} AND credential_id = ${args.credentialId}
          AND account_hash = ANY(${hashes}::text[])
      `;
      const stateByHash = new Map(states.map((state) => [state.hash, state]));
      // A retry exclusion is advisory; quota and shared cooldown never are.
      const healthy = args.candidates.filter(
        ({ hash }) => (stateByHash.get(hash)?.cooldownUntilMs ?? 0) <= nowMs,
      );
      const preferred = healthy.filter(({ excluded }) => !excluded);
      const fellBack = healthy.length > 0 && preferred.length === 0;
      const candidates = preferred.length > 0 ? preferred : healthy;
      if (candidates.length === 0) {
        return {
          hash: null,
          fellBack: false,
          retryAtMs: Math.min(...states.map((state) => state.cooldownUntilMs)),
        };
      }
      let selected = candidates[0];
      if (args.selection === 'random') {
        selected = candidates[Math.floor(randomFn() * candidates.length)];
      } else if (args.selection === 'round-robin') {
        selected = [...candidates].sort((a, b) => {
          const first = BigInt(stateByHash.get(a.hash)?.sequence ?? '0');
          const second = BigInt(stateByHash.get(b.hash)?.sequence ?? '0');
          return first < second
            ? -1
            : first > second
              ? 1
              : a.hash.localeCompare(b.hash);
        })[0];
      }
      if (selected === undefined) return { hash: null, fellBack: false };
      await tx`
        INSERT INTO app.provider_broker_accounts
          (org_id, credential_id, account_hash, last_selected_sequence, updated_at_ms)
        VALUES (${args.organizationId}, ${args.credentialId}, ${selected.hash}, ${sequence}, ${nowMs})
        ON CONFLICT (org_id, credential_id, account_hash) DO UPDATE SET
          last_selected_sequence = EXCLUDED.last_selected_sequence,
          updated_at_ms = EXCLUDED.updated_at_ms
      `;
      // A legacy broker that rotates token bytes has no stable id. Bound old
      // scheduling state, retaining cooldowns and every current candidate.
      await tx`
        DELETE FROM app.provider_broker_accounts
        WHERE org_id = ${args.organizationId} AND credential_id = ${args.credentialId}
          AND updated_at_ms < ${nowMs - 7 * 86_400_000} AND cooldown_until_ms <= ${nowMs}
          AND NOT (account_hash = ANY(${hashes}::text[]))
      `;
      return { hash: selected.hash, fellBack };
    } catch (error) {
      throw markRetryQueueKey(error, queueKey);
    }
  });
}

/** No vendor Retry-After survives the CLI event protocol. A short, bounded
 * cooldown avoids new jobs hammering a rate-limited account; fresh gateway
 * quota metadata can exclude it for the full vendor reset window. */
export async function recordBrokerFailure(
  sql: Sql,
  args: z.infer<typeof brokerFailureArgsSchema>,
  nowMs = Date.now(),
): Promise<void> {
  if (args.apiErrorStatus !== 429) return;
  await sql`
    UPDATE app.provider_broker_accounts
    SET cooldown_until_ms = greatest(cooldown_until_ms, ${nowMs + 60_000}),
      updated_at_ms = greatest(updated_at_ms, ${nowMs})
    WHERE org_id = ${args.organizationId} AND account_hash = ${args.brokerTokenHash}
  `;
}
