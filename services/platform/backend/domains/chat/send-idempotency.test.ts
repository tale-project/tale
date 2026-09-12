// @vitest-environment node

/**
 * The send idempotency ledger: the claim idiom on the real statements (an
 * INSERT … ON CONFLICT DO UPDATE … WHERE expired, RETURNING), a replay that
 * answers the remembered 202 for the same request only, and the accept
 * that fills the claimed row in and sweeps the organization's expired keys.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  claimSendIdempotency,
  rememberAcceptedSend,
  SEND_IDEMPOTENCY_WINDOW_MS,
  sendIdempotencyRequestHash,
  sendIdempotencyScopeKey,
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
  it('scopes a key to its project and thread — the same key elsewhere is another send', () => {
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

  it('replays the remembered 202 for the same request under a live key', async () => {
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

  it('refuses a live key reused for a different request with 409 IDEMPOTENCY_KEY_REUSED', async () => {
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
  it('fills the claimed row in with the 202 and sweeps the organization’s expired keys', async () => {
    const { tx, statements } = fakeTx({});
    const response = { threadId: 't-1', status: 'accepted', messageId: 'm-1' };
    await rememberAcceptedSend(tx, {
      organizationId: 'org-1',
      scopeKey: 'scope-a',
      messageId: 'm-1',
      response,
      now: ARGS.now,
    });
    expect(
      statements.map((s) => s.text.split(' ').slice(0, 3).join(' ')),
    ).toEqual([
      'UPDATE app.chat_send_idempotency SET',
      'DELETE FROM app.chat_send_idempotency',
    ]);
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['m-1', { json: response }, 'org-1', 'scope-a']),
    );
    expect(statements[1]?.text).toContain('expires_at_ms <= $?');
    expect(statements[1]?.values).toEqual(['org-1', ARGS.now]);
  });
});
