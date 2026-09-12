import { createHash } from 'node:crypto';

import type { TransactionSql } from 'postgres';

import { sortObjectKeysDeep } from '../../../lib/shared/utils/canonicalize-config.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { toJson } from '../../db/sql.ts';
import { ChatThreadError } from './threads.ts';

/**
 * Send idempotency — what makes a retried `POST …/threads/{id}/messages`
 * recognisable (the chat twin of `core/automations/run_idempotency.ts`).
 *
 * A send answers 202 before the turn runs, so a lost response is the
 * ordinary case a client retries — and every retry used to start, and
 * bill, another turn. A caller that sends `Idempotency-Key` names the send
 * instead: the key is remembered for a day (the run ledger's window), a
 * repeat answers the 202 the first attempt got (flagged `duplicate: true`),
 * and a repeat that carries a DIFFERENT body under the same key is refused
 * rather than silently answered with a turn of something else.
 *
 * Two digests, both bounded whatever the caller sent:
 *
 *  - the SCOPE key — the ledger row's identity: the key is one caller's
 *    choice for one thread in one URL scope (the project, or none), so the
 *    same key aimed at another thread or project is another send;
 *  - the REQUEST hash — the canonical form of what the send asked for (the
 *    whole body), compared on a repeat so a reused key with a changed body
 *    reads as the mistake it is.
 *
 * The claim runs INSIDE the send's transaction, BEFORE the thread's own
 * turn gate: a refused send (the thread mid-turn) throws, the transaction
 * rolls back, and the claim goes with it — a 4xx is never remembered.
 */

/** How long a send's key is remembered — the run ledger's window. */
export const SEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000;

/** Everything the send body can carry — the request hash covers it all. */
export interface SendRequestFacts {
  readonly content: string;
  readonly model: string;
  readonly providerSlug?: string;
  readonly reasoningEffort?: string;
  readonly maxOutputTokens?: number;
  readonly locale?: string;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The ledger row's identity inside the organization. */
export function sendIdempotencyScopeKey(args: {
  projectId: string | null;
  threadId: string;
  key: string;
}): string {
  return sha256Hex(`${args.projectId ?? ''}\n${args.threadId}\n${args.key}`);
}

/**
 * The request a key was first used for, as one digest: object keys are
 * sorted so two spellings of the same body agree, and a field the caller
 * left out is absent from the form rather than `undefined` (JSON drops it).
 */
export function sendIdempotencyRequestHash(facts: SendRequestFacts): string {
  return sha256Hex(
    JSON.stringify(
      sortObjectKeysDeep({
        content: facts.content,
        model: facts.model,
        providerSlug: facts.providerSlug,
        reasoningEffort: facts.reasoningEffort,
        maxOutputTokens: facts.maxOutputTokens,
        locale: facts.locale,
      }),
    ),
  );
}

/** What the claim decided: the row is this send's to fill in, or an
 * earlier attempt under the same key already answered the same request. */
export type SendClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'replay'; readonly response: Record<string, unknown> };

/**
 * Claim the (organization, scope key) row for this send — the run ledger's
 * claim idiom: INSERT … ON CONFLICT DO UPDATE … WHERE expired, RETURNING.
 * A live row means a concurrent or earlier attempt owns the key: the claim
 * waits on its row lock (a concurrent pair commits one accept, the other
 * reads it) and answers the remembered 202 for the same request, or 409
 * `IDEMPOTENCY_KEY_REUSED` for a different one. An expired row is taken
 * over and the send runs again as the new request it is.
 */
export async function claimSendIdempotency(
  tx: TransactionSql,
  args: {
    organizationId: string;
    scopeKey: string;
    requestHash: string;
    threadId: string;
    now: number;
  },
): Promise<SendClaim> {
  const claimed = await tx<{ scopeKey: string }[]>`
    INSERT INTO app.chat_send_idempotency AS i (
      org_id, scope_key, request_hash, thread_id, message_id, response,
      received_at_ms, expires_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.scopeKey}, ${args.requestHash},
      ${args.threadId}, NULL, NULL, ${args.now},
      ${args.now + SEND_IDEMPOTENCY_WINDOW_MS}
    )
    ON CONFLICT (org_id, scope_key) DO UPDATE SET
      request_hash = EXCLUDED.request_hash,
      thread_id = EXCLUDED.thread_id,
      message_id = NULL,
      response = NULL,
      received_at_ms = EXCLUDED.received_at_ms,
      expires_at_ms = EXCLUDED.expires_at_ms
    WHERE i.expires_at_ms <= EXCLUDED.received_at_ms
    RETURNING scope_key AS "scopeKey"
  `;
  if (claimed.length > 0) return { kind: 'claimed' };
  // A live key: the first attempt's 202 is the answer — for the same
  // request. The row is committed (the claim and the accept commit
  // together), so a missing response is a ledger writer's bug, named.
  const remembered = await tx<{ requestHash: string; response: unknown }[]>`
    SELECT request_hash AS "requestHash", response
    FROM app.chat_send_idempotency
    WHERE org_id = ${args.organizationId} AND scope_key = ${args.scopeKey}
  `;
  const row = remembered[0];
  if (row === undefined || !isRecord(row.response)) {
    throw new Error(
      `chat send idempotency ledger row ${args.scopeKey} in ${args.organizationId} carries no accepted send`,
    );
  }
  if (row.requestHash !== args.requestHash) {
    throw new ChatThreadError(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request — send a new key, or repeat the original request unchanged.',
      409,
    );
  }
  return { kind: 'replay', response: row.response };
}

/**
 * Fill the claimed row in with what the send answered — in the same
 * transaction as the accept, so a committed row always carries a 202 —
 * and sweep the organization's expired keys on the way (no sweeper job:
 * the keys go with the send that outlived them).
 */
export async function rememberAcceptedSend(
  tx: TransactionSql,
  args: {
    organizationId: string;
    scopeKey: string;
    messageId: string;
    response: Record<string, unknown>;
    now: number;
  },
): Promise<void> {
  await tx`
    UPDATE app.chat_send_idempotency SET
      message_id = ${args.messageId},
      response = ${tx.json(toJson(args.response))}
    WHERE org_id = ${args.organizationId} AND scope_key = ${args.scopeKey}
  `;
  await tx`
    DELETE FROM app.chat_send_idempotency
    WHERE org_id = ${args.organizationId} AND expires_at_ms <= ${args.now}
  `;
}
