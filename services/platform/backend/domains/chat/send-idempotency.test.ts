// @vitest-environment node

/**
 * The send idempotency ledger: the claim idiom on the real statements (an
 * INSERT … ON CONFLICT DO UPDATE … WHERE expired, RETURNING), a replay that
 * answers the remembered 202 for the same request only, the accept that
 * fills the claimed row in, and the scheduled sweep of expired keys. Which
 * real rows the sweep takes is proven against Postgres by the
 * `checkChatTurnWrites` lane of `backend:integration`.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  claimSendIdempotency,
  rememberAcceptedSend,
  SEND_IDEMPOTENCY_WINDOW_MS,
  SEND_KEY_SWEEP_BATCH,
  sendIdempotencyRequestHash,
  sendIdempotencyScopeKey,
  sweepExpiredSendKeys,
} from './send-idempotency.ts';

interface Captured {
  text: string;
  values: unknown[];
}

/** A tagged-template transaction double answering each statement by its
 * leading words, recording every statement and its bound values. */
function fakeTx(answers: {
  claimed?: boolean;
  remembered?: { requestHash: string; response: unknown };
}): { tx: TransactionSql; statements: Captured[] } {
  const statements: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('INSERT INTO app.chat_send_idempotency')) {
      return Promise.resolve(
        answers.claimed === false ? [] : [{ scopeKey: 'k' }],
      );
    }
    if (text.startsWith('SELECT request_hash AS "requestHash", response')) {
      return Promise.resolve(
        answers.remembered === undefined ? [] : [answers.remembered],
      );
    }
    return Promise.resolve([]);
  };
  const json = (value: unknown) => ({ json: value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return {
    tx: Object.assign(tag, { json }) as unknown as TransactionSql,
    statements,
  };
}

const ARGS = {
  organizationId: 'org-1',
  scopeKey: 'scope-a',
  requestHash: 'hash-a',
  threadId: 't-1',
  now: 1_700_000_000_000,
};

describe('the digests', () => {
  it('scopes a key to its project and thread — the same key elsewhere is another send [CHAT-R15]', () => {
    const base = sendIdempotencyScopeKey({
      projectId: 'p-1',
      threadId: 't-1',
      key: 'send-1',
    });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(
      sendIdempotencyScopeKey({
        projectId: 'p-1',
        threadId: 't-1',
        key: 'send-1',
      }),
    ).toBe(base);
    expect(
      sendIdempotencyScopeKey({
        projectId: null,
        threadId: 't-1',
        key: 'send-1',
      }),
    ).not.toBe(base);
    expect(
      sendIdempotencyScopeKey({
        projectId: 'p-1',
        threadId: 't-2',
        key: 'send-1',
      }),
    ).not.toBe(base);
    expect(
      sendIdempotencyScopeKey({
        projectId: 'p-1',
        threadId: 't-1',
        key: 'send-2',
      }),
    ).not.toBe(base);
  });

  it('hashes the canonical body: field order is immaterial, an absent field is absent, a changed one is another request', () => {
    const hash = sendIdempotencyRequestHash({
      content: 'Count to ten',
      model: 'model-a',
      maxOutputTokens: 64,
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      sendIdempotencyRequestHash({
        maxOutputTokens: 64,
        model: 'model-a',
        content: 'Count to ten',
        locale: undefined,
      }),
    ).toBe(hash);
    expect(
      sendIdempotencyRequestHash({
        content: 'Count to ten',
        model: 'model-a',
        maxOutputTokens: 65,
      }),
    ).not.toBe(hash);
    expect(
      sendIdempotencyRequestHash({
        content: 'Count to ten',
        model: 'model-a',
        maxOutputTokens: 64,
        locale: 'de',
      }),
    ).not.toBe(hash);
  });
});

describe('claimSendIdempotency', () => {
  it('claims a free (or expired) key with one conditional upsert that returns the row', async () => {
    const { tx, statements } = fakeTx({ claimed: true });
    await expect(claimSendIdempotency(tx, ARGS)).resolves.toEqual({
      kind: 'claimed',
    });
    expect(statements).toHaveLength(1);
    const claim = statements[0];
    expect(claim?.text).toContain(
      'ON CONFLICT (org_id, scope_key) DO UPDATE SET',
    );
    expect(claim?.text).toContain(
      'WHERE i.expires_at_ms <= EXCLUDED.received_at_ms RETURNING scope_key',
    );
    // The window: received now, expires a day later.
    expect(claim?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'scope-a',
        'hash-a',
        't-1',
        ARGS.now,
        ARGS.now + SEND_IDEMPOTENCY_WINDOW_MS,
      ]),
    );
  });

  it('replays the remembered 202 for the same request under a live key [CHAT-R15]', async () => {
    const response = { threadId: 't-1', status: 'accepted', messageId: 'm-1' };
    const { tx } = fakeTx({
      claimed: false,
      remembered: { requestHash: 'hash-a', response },
    });
    await expect(claimSendIdempotency(tx, ARGS)).resolves.toEqual({
      kind: 'replay',
      response,
    });
  });

  it('refuses a live key reused for a different request with 409 IDEMPOTENCY_KEY_REUSED [CHAT-R15]', async () => {
    const { tx } = fakeTx({
      claimed: false,
      remembered: { requestHash: 'hash-other', response: { messageId: 'm-1' } },
    });
    await expect(claimSendIdempotency(tx, ARGS)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    });
  });

  it('names a ledger bug rather than replaying a row that carries no accepted send', async () => {
    const { tx } = fakeTx({
      claimed: false,
      remembered: { requestHash: 'hash-a', response: null },
    });
    await expect(claimSendIdempotency(tx, ARGS)).rejects.toThrow(
      /carries no accepted send/,
    );
  });
});

describe('rememberAcceptedSend', () => {
  it('fills the claimed row in with the 202 and sweeps nothing', async () => {
    const { tx, statements } = fakeTx({});
    const response = { threadId: 't-1', status: 'accepted', messageId: 'm-1' };
    await rememberAcceptedSend(tx, {
      organizationId: 'org-1',
      scopeKey: 'scope-a',
      messageId: 'm-1',
      response,
    });
    // A sweep here had concurrent sends of one organization delete the same
    // expired rows, each waiting on the one before it; the hourly job sweeps.
    expect(
      statements.map((s) => s.text.split(' ').slice(0, 3).join(' ')),
    ).toEqual(['UPDATE app.chat_send_idempotency SET']);
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['m-1', { json: response }, 'org-1', 'scope-a']),
    );
  });
});

/** A handle whose every DELETE answers the next count in `counts` (0 once
 * they run out), recording each statement and its bound values. */
function recordingSql(
  counts: number[],
  onStatement?: (index: number) => void,
): { sql: Sql; statements: Captured[] } {
  const statements: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    onStatement?.(statements.length - 1);
    const count = counts[statements.length - 1] ?? 0;
    return Promise.resolve(Object.assign([], { count }));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { sql: tag as unknown as Sql, statements };
}

describe('sweepExpiredSendKeys', () => {
  it('deletes a bounded batch of keys whose window has closed, in every organization', async () => {
    const { sql, statements } = recordingSql([0]);
    await sweepExpiredSendKeys(sql, { now: ARGS.now });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toBe(
      'DELETE FROM app.chat_send_idempotency WHERE (org_id, scope_key) IN ( SELECT org_id, scope_key FROM app.chat_send_idempotency WHERE expires_at_ms <= $? ORDER BY expires_at_ms LIMIT $? FOR UPDATE SKIP LOCKED )',
    );
    // A key is expired from the end of its window on, the moment the claim
    // takes one over as a new send.
    expect(statements[0]?.values).toEqual([ARGS.now, SEND_KEY_SWEEP_BATCH]);
  });

  it('keeps deleting full batches until one comes back short', async () => {
    const { sql, statements } = recordingSql([10, 10, 3]);
    const result = await sweepExpiredSendKeys(sql, {
      now: ARGS.now,
      batch: 10,
    });
    expect(result).toEqual({ deleted: 23, drained: true });
    expect(statements).toHaveLength(3);
    expect(statements.every((row) => row.values[1] === 10)).toBe(true);
  });

  it('runs a single statement when nothing has expired', async () => {
    const { sql, statements } = recordingSql([0]);
    const result = await sweepExpiredSendKeys(sql, { now: ARGS.now });
    expect(result).toEqual({ deleted: 0, drained: true });
    expect(statements).toHaveLength(1);
  });

  it('stops at its batch budget and says it did not drain', async () => {
    const { sql, statements } = recordingSql([5, 5, 5, 5, 5]);
    const result = await sweepExpiredSendKeys(sql, {
      now: ARGS.now,
      batch: 5,
      maxBatches: 3,
    });
    expect(result).toEqual({ deleted: 15, drained: false });
    expect(statements).toHaveLength(3);
  });

  it('takes at most 100 batches by default', async () => {
    const { sql, statements } = recordingSql(
      Array.from({ length: 150 }, () => 2),
    );
    const result = await sweepExpiredSendKeys(sql, {
      now: ARGS.now,
      batch: 2,
    });
    expect(result).toEqual({ deleted: 200, drained: false });
    expect(statements).toHaveLength(100);
  });

  it('stops between batches once the job is aborted', async () => {
    const controller = new AbortController();
    const { sql, statements } = recordingSql([5, 5, 5], (index) => {
      if (index === 0) controller.abort();
    });
    const result = await sweepExpiredSendKeys(sql, {
      now: ARGS.now,
      batch: 5,
      signal: controller.signal,
    });
    expect(result).toEqual({ deleted: 5, drained: false });
    expect(statements).toHaveLength(1);
  });

  it('touches nothing when aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const { sql, statements } = recordingSql([5]);
    const result = await sweepExpiredSendKeys(sql, {
      now: ARGS.now,
      signal: controller.signal,
    });
    expect(result).toEqual({ deleted: 0, drained: false });
    expect(statements).toHaveLength(0);
  });
});
