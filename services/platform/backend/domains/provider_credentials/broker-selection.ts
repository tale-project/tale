import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  transactSerializable,
} from '@tale/shared/db/serializable';
import { brokerSelectionSchema } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { AppError } from '../../../lib/shared/errors/app-error.ts';
import {
  BROKER_RATE_LIMIT_COOLDOWN_MS,
  BROKER_SUBSCRIPTION_DISABLED_COOLDOWN_MS,
  type BrokerSelectionResult,
} from '../../core/provider_credentials/broker_pool.ts';

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
            /** Held back by the broker for its coming token refresh — a
             * fallback, in the order given. */
            held: z.boolean().optional(),
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
    providerErrorKind: z.literal('subscription_access_disabled').optional(),
  })
  .strict();

interface AccountState {
  hash: string;
  sequence: string;
  cooldownUntilMs: number;
}

type BrokerCandidate = z.infer<
  typeof brokerSelectionArgsSchema
>['candidates'][number];

/**
 * The pick itself, over the candidates' shared state — no I/O. A cooling
 * account is never picked. Among the rest, an account the broker counts as
 * available always beats one it holds back for its coming refresh: the
 * broker judged that another account could take the work, without seeing
 * the cooldowns or the account-id rule that may have left none — a
 * two-account pool would otherwise refuse all work while its one available
 * account cools down. The held tier keeps the order given (the latest
 * refresh first), as the broker would choose itself. Within either tier a
 * retry exclusion only reorders: an excluded account serves when nothing
 * else in its tier can.
 */
export function pickBrokerCandidate(
  candidates: readonly BrokerCandidate[],
  stateByHash: ReadonlyMap<
    string,
    Pick<AccountState, 'sequence' | 'cooldownUntilMs'>
  >,
  selection: z.infer<typeof brokerSelectionSchema>,
  nowMs: number,
  randomFn: () => number,
): {
  selected?: BrokerCandidate;
  fellBack: boolean;
  held: boolean;
  retryAtMs?: number;
} {
  const healthy = candidates.filter(
    ({ hash }) => (stateByHash.get(hash)?.cooldownUntilMs ?? 0) <= nowMs,
  );
  if (healthy.length === 0) {
    const cooling = candidates.map(
      ({ hash }) => stateByHash.get(hash)?.cooldownUntilMs ?? 0,
    );
    return {
      fellBack: false,
      held: false,
      ...(cooling.length > 0 && { retryAtMs: Math.min(...cooling) }),
    };
  }
  const available = healthy.filter(({ held }) => held !== true);
  const tier = available.length > 0 ? available : healthy;
  const preferred = tier.filter(({ excluded }) => !excluded);
  const fellBack = preferred.length === 0;
  const pool = fellBack ? tier : preferred;
  const held = available.length === 0;
  let selected = pool[0];
  if (!held && selection === 'random') {
    selected = pool[Math.floor(randomFn() * pool.length)];
  } else if (!held && selection === 'round-robin') {
    selected = [...pool].sort((a, b) => {
      const first = BigInt(stateByHash.get(a.hash)?.sequence ?? '0');
      const second = BigInt(stateByHash.get(b.hash)?.sequence ?? '0');
      return first < second
        ? -1
        : first > second
          ? 1
          : a.hash.localeCompare(b.hash);
    })[0];
  }
  return { ...(selected !== undefined && { selected }), fellBack, held };
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
      // A retry exclusion and a refresh hold are advisory; quota and shared
      // cooldown never are.
      const { selected, fellBack, held, retryAtMs } = pickBrokerCandidate(
        args.candidates,
        stateByHash,
        args.selection,
        nowMs,
        randomFn,
      );
      if (selected === undefined) {
        return {
          hash: null,
          fellBack: false,
          ...(retryAtMs !== undefined && { retryAtMs }),
        };
      }
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
      return { hash: selected.hash, fellBack, ...(held && { held }) };
    } catch (error) {
      throw markRetryQueueKey(error, queueKey);
    }
  });
}

/** No vendor Retry-After survives the CLI event protocol. A short, bounded
 * cooldown avoids new jobs hammering a rate-limited account or a selected
 * account whose subscription access the provider explicitly refused. Reuse
 * bounded policies; neither refusal disables the provider credential.
 * Fresh gateway quota metadata can exclude it for the full reset window. */
export async function recordBrokerFailure(
  sql: Sql,
  args: z.infer<typeof brokerFailureArgsSchema>,
  nowMs = Date.now(),
): Promise<void> {
  if (
    args.apiErrorStatus !== 429 &&
    !(
      args.apiErrorStatus === 403 &&
      args.providerErrorKind === 'subscription_access_disabled'
    )
  )
    return;
  const cooldownMs =
    args.apiErrorStatus === 403
      ? BROKER_SUBSCRIPTION_DISABLED_COOLDOWN_MS
      : BROKER_RATE_LIMIT_COOLDOWN_MS;
  await sql`
    UPDATE app.provider_broker_accounts
    SET cooldown_until_ms = greatest(cooldown_until_ms, ${nowMs + cooldownMs}),
      updated_at_ms = greatest(updated_at_ms, ${nowMs})
    WHERE org_id = ${args.organizationId} AND account_hash = ${args.brokerTokenHash}
  `;
}
