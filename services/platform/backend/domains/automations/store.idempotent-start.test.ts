// @vitest-environment node

/**
 * `beginRunIdempotentInTx` — the run-start twin of the webhook delivery
 * ledger: the key's row is CLAIMED with the conditional upsert before the
 * run starts, a live key answers the run it already started (for the same
 * request), a reused key with another request is refused, and nothing a
 * refusal produces is remembered (an undeployed start forgets its claim;
 * a thrown refusal rolls the transaction back). The real-Postgres probe
 * (`project-scope-check.ts`) proves the concurrent pair on the schema.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { runIdempotencyRequestHash } from '../../core/automations/run_idempotency.ts';
import { HEADER_LANE_WINDOW_MS } from '../../core/automations/webhook_delivery.ts';
import { beginRunIdempotent, RUN_IDEMPOTENCY_WINDOW_MS } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeStore(script: {
  /** Whether the claim upsert wins (RETURNING a row). */
  claimed: boolean;
  remembered?: { requestHash: string; runId: string | null };
  deployed?: number | undefined;
  inputs?: Record<string, unknown>;
}) {
  const statements: Statement[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('INSERT INTO app.automation_run_idempotency')) {
      return script.claimed ? [{ scopeKey: String(values[1]) }] : [];
    }
    if (text.includes('FROM app.automation_run_idempotency')) {
      return script.remembered === undefined ? [] : [script.remembered];
    }
    if (text.includes('FROM app.automation_deployments')) {
      const deployed = 'deployed' in script ? script.deployed : 1;
      return deployed === undefined ? [] : [{ version: deployed }];
    }
    if (text.includes('FROM app.automations')) {
      return [
        {
          document:
            script.inputs === undefined ? {} : { inputs: script.inputs },
          createdAt: 1_700_000_000_000,
        },
      ];
    }
    if (text.includes('FROM app.automation_project_bindings')) return [];
    if (text.includes('FROM app.projects')) return [{ id: 'p-1' }];
    if (text.includes('FROM app.automation_runs WHERE id')) {
      return [{ id: String(values[1]), version: 3 }];
    }
    if (text.startsWith('INSERT INTO app.automation_runs')) {
      return [{ id: 'run-new' }];
    }
    return [];
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  }) as unknown as Sql;
  return { sql, statements };
}

const args = {
  organizationId: 'org-1',
  name: 'orders/process',
  startedBy: 'api-key:user-1',
  mode: 'live' as const,
  input: { orderId: 'order-1' },
};
const key = { key: 'client-key-1' };

beforeEach(() => vi.clearAllMocks());

describe('beginRunIdempotentInTx', () => {
  it('claims the key with the conditional upsert, starts the run, and records it', async () => {
    const { sql, statements } = fakeStore({ claimed: true });
    await expect(beginRunIdempotent(sql, args, key)).resolves.toEqual({
      runId: 'run-new',
      version: 1,
      duplicate: false,
    });
    const claim = statements[0];
    expect(claim?.text).toContain(
      'INSERT INTO app.automation_run_idempotency AS i',
    );
    expect(claim?.text).toContain(
      'ON CONFLICT (org_id, scope_key) DO UPDATE SET',
    );
    expect(claim?.text).toContain(
      'WHERE i.expires_at_ms <= EXCLUDED.received_at_ms',
    );
    expect(claim?.text).toContain('RETURNING scope_key');
    // The window is the day the webhook door keeps an explicit delivery id
    // (VALUES: org, scope key, request hash, a NULL literal, received,
    // expires).
    expect(RUN_IDEMPOTENCY_WINDOW_MS).toBe(HEADER_LANE_WINDOW_MS);
    expect(Number(claim?.values[4]) - Number(claim?.values[3])).toBe(
      RUN_IDEMPOTENCY_WINDOW_MS,
    );
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.automation_runs'),
      ),
    ).toBe(true);
    const recorded = statements.find((s) =>
      s.text.startsWith('UPDATE app.automation_run_idempotency SET run_id'),
    );
    expect(recorded?.values[0]).toBe('run-new');
    // The organization's expired keys go with the accepted start.
    const sweep = statements.find(
      (s) =>
        s.text.startsWith('DELETE FROM app.automation_run_idempotency') &&
        s.text.includes('expires_at_ms <='),
    );
    expect(sweep?.values[0]).toBe('org-1');
  });

  it('answers the remembered run for a repeat of the same request', async () => {
    const requestHash = await runIdempotencyRequestHash({
      input: args.input,
      mode: args.mode,
      version: undefined,
    });
    const { sql, statements } = fakeStore({
      claimed: false,
      remembered: { requestHash, runId: 'run-old' },
    });
    await expect(beginRunIdempotent(sql, args, key)).resolves.toEqual({
      runId: 'run-old',
      version: 3,
      duplicate: true,
    });
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.automation_runs'),
      ),
    ).toBe(false);
  });

  it('refuses a reused key that carries a different request', async () => {
    const { sql, statements } = fakeStore({
      claimed: false,
      remembered: { requestHash: 'another-request', runId: 'run-old' },
    });
    await expect(beginRunIdempotent(sql, args, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    });
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.automation_runs'),
      ),
    ).toBe(false);
  });

  it('forgets its claim when nothing is deployed, so the key runs later', async () => {
    const { sql, statements } = fakeStore({
      claimed: true,
      deployed: undefined,
    });
    await expect(beginRunIdempotent(sql, args, key)).resolves.toBeNull();
    const forgotten = statements.find(
      (s) =>
        s.text.startsWith('DELETE FROM app.automation_run_idempotency') &&
        s.text.includes('scope_key ='),
    );
    expect(forgotten?.values[0]).toBe('org-1');
    expect(
      statements.some((s) =>
        s.text.startsWith('UPDATE app.automation_run_idempotency SET run_id'),
      ),
    ).toBe(false);
  });

  it('lets a refusal escape the transaction before the key is recorded', async () => {
    const { sql, statements } = fakeStore({
      claimed: true,
      inputs: { type: 'object', required: ['orderId'] },
    });
    await expect(
      beginRunIdempotent(sql, { ...args, input: {} }, key),
    ).rejects.toMatchObject({ code: 'AUTOMATION_INPUT_INVALID' });
    expect(
      statements.some((s) =>
        s.text.startsWith('UPDATE app.automation_run_idempotency SET run_id'),
      ),
    ).toBe(false);
  });

  it('scopes the key to the project: the same key in another scope is another start', async () => {
    const org = fakeStore({ claimed: true });
    await beginRunIdempotent(org.sql, args, key);
    const project = fakeStore({ claimed: true });
    await beginRunIdempotent(project.sql, { ...args, projectId: 'p-1' }, key);
    expect(org.statements[0]?.values[1]).not.toBe(
      project.statements[0]?.values[1],
    );
  });
});
