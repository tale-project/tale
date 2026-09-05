// @vitest-environment node

/**
 * Unit lock for `upsertAgentSecret`'s write shape: ONE statement — an
 * INSERT … ON CONFLICT (org_id, name) DO UPDATE — never a SELECT-then-INSERT
 * that two racing first saves could both pass (the loser's 23505 surfaced
 * as a 500), with the per-org cap decided under an advisory lock and only
 * against the OTHER names, so a full org can still rotate a secret.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { AgentSecretError, upsertAgentSecret } from './service.ts';

vi.mock('../../core/lib/secret_box.ts', () => ({
  encryptSecret: vi.fn(() => ({ v: 1, iv: 'iv', tag: 'tag', data: 'data' })),
  decryptSecret: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * Scripted transaction: the lock answers nothing, the count answers
 * `others`, the upsert answers whether the row it landed was inserted.
 */
function fakeSql(script: { others: number; created: boolean }): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT count(*)')) {
      return Promise.resolve([{ count: String(script.others) }]);
    }
    if (text.startsWith('INSERT INTO app.agent_secrets')) {
      return Promise.resolve([{ created: script.created }]);
    }
    return Promise.resolve([]);
  };
  tx.json = (value: unknown) => value;
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tx);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { begin } as unknown as Sql, statements };
}

const args = {
  organizationId: 'org_1',
  actorId: 'user_1',
  name: 'OPENAI_API_KEY',
  value: 'sk-live-0123456789abcdef',
};

describe('upsertAgentSecret', () => {
  it('writes one upsert on (org_id, name) under the org lock and reports what landed', async () => {
    const fresh = fakeSql({ others: 0, created: true });
    expect(await upsertAgentSecret(fresh.sql, args)).toEqual({
      created: true,
    });

    const texts = fresh.statements.map((s) => s.text);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(
      /^SELECT pg_advisory_xact_lock\(\s*hashtext\(\?\)\s*\)$/,
    );
    expect(fresh.statements[0]?.values).toEqual(['agent-secrets:org_1']);
    expect(texts[2]).toContain('ON CONFLICT (org_id, name) DO UPDATE SET');
    expect(texts[2]).toContain('RETURNING (xmax = 0) AS created');
    expect(texts.some((t) => t.startsWith('SELECT id'))).toBe(false);
    expect(vi.mocked(createAuditLog).mock.calls.at(-1)?.[1].action).toBe(
      'agent_secret.created',
    );

    const rotated = fakeSql({ others: 3, created: false });
    expect(await upsertAgentSecret(rotated.sql, args)).toEqual({
      created: false,
    });
    expect(vi.mocked(createAuditLog).mock.calls.at(-1)?.[1].action).toBe(
      'agent_secret.updated',
    );
  });

  it('counts only the other names against the cap and refuses a new one before writing', async () => {
    const full = fakeSql({ others: 200, created: true });
    const err = await upsertAgentSecret(full.sql, args).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AgentSecretError);
    expect((err as AgentSecretError).code).toBe('AGENT_SECRET_LIMIT');
    expect((err as AgentSecretError).status).toBe(409);

    const texts = full.statements.map((s) => s.text);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('AND name <> ?');
    expect(full.statements[1]?.values).toEqual(['org_1', 'OPENAI_API_KEY']);
    expect(texts.some((t) => t.startsWith('INSERT'))).toBe(false);
  });
});
