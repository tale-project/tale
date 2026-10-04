import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { createAuditLog, emitEvent, emitHintInTx } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit-1'),
  emitEvent: vi.fn(async () => undefined),
  emitHintInTx: vi.fn(async () => undefined),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../events/emit.ts', () => ({ emitEvent }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (
    sql: unknown,
    run: (tx: unknown) => Promise<unknown>,
  ) => run(sql),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (context: Context<OrgEnv>, next: () => Promise<void>) => {
      context.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test', name: 'User' },
        session: { id: 's1' },
      });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (context: Context<OrgEnv>, next: () => Promise<void>) => {
      context.set('orgId', 'o1');
      context.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createContactRoutes } from './routes.ts';

const statements: { text: string; values: unknown[] }[] = [];
const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.startsWith('INSERT INTO app.contacts') ? [{ id: 'c-new' }] : [],
    );
  },
  { json: (value: unknown) => value },
);
const app = createContactRoutes({ sql: sql as never, auth: {} as never });

function create(identity: Record<string, unknown>) {
  return app.request('/?orgId=o1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'manual_import',
      notes: 'Commerce audit empty identity fixture',
      ...identity,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  statements.length = 0;
});

describe('app contact creation identity boundary', () => {
  it.each([
    {},
    { name: null, email: null, externalId: null },
    { name: '   ', email: '   ', externalId: '   ' },
  ])('refuses an anonymous contact without writing: %j', async (identity) => {
    const response = await create(identity);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'CONTACT_IDENTITY_REQUIRED',
    });
    expect(statements).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it.each([
    { identity: { name: ' Ann ' }, stored: ['Ann', null, null] },
    {
      identity: { email: ' Ann@Example.Test ' },
      stored: [null, 'ann@example.test', null],
    },
    { identity: { externalId: ' crm-1 ' }, stored: [null, null, 'crm-1'] },
  ])(
    'accepts a single identity field: $identity',
    async ({ identity, stored }) => {
      const response = await create(identity);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ contactId: 'c-new' });
      const insert = statements.find((statement) =>
        statement.text.startsWith('INSERT INTO app.contacts'),
      );
      expect(insert?.values[0]).toBe('o1');
      expect([insert?.values[1], insert?.values[2], insert?.values[4]]).toEqual(
        stored,
      );
      expect(createAuditLog).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledTimes(1);
      expect(emitHintInTx).toHaveBeenCalledTimes(1);
    },
  );
});
