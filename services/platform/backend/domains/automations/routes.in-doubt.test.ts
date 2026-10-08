// @vitest-environment node

/**
 * The app's two doors onto a write that may already have happened when its
 * run was interrupted. Reading it follows the run's read rule — a hidden run
 * answers like one with nothing waiting. Deciding it is a WRITE with the
 * stop's gate: a hidden or missing run is not found, a read-only member is
 * refused, a body that is not one of the three choices about one attempt
 * of the write is the domain's 400, and the store's refusals (the run no
 * longer waits, the step was already decided — or the choice is about an
 * earlier attempt of it) keep their 409.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { getRun, readOpenInDoubt, resolveInDoubtInTx, access } = vi.hoisted(
  () => ({
    getRun: vi.fn(),
    readOpenInDoubt: vi.fn(),
    resolveInDoubtInTx: vi.fn(),
    access: {
      read: true,
      control: 'ok' as 'ok' | 'hidden' | 'forbidden',
    },
  }),
);

vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  getRun,
}));

vi.mock('./node-attempts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./node-attempts.ts')>()),
  readOpenInDoubt,
  resolveInDoubtInTx,
}));

vi.mock('./project-visibility.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./project-visibility.ts')>()),
  canReadRun: vi.fn(async () => access.read),
  runControlAccess: vi.fn(async () => access.control),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: vi.fn(async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: 'member',
    teamIds: [],
  })),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'member' } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

const tx = { tx: true };

function makeApp() {
  const sql = { begin: async (fn: (t: unknown) => unknown) => fn(tx) };
  return createAutomationRoutes({ sql: sql as never, auth: {} as never });
}

async function read(): Promise<Response> {
  return makeApp().request('/runs/run_1/in-doubt?orgId=o1');
}

async function decide(body: unknown): Promise<Response> {
  return makeApp().request('/runs/run_1/in-doubt/attempt_1?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const attempt = {
  attemptId: 'attempt_1',
  nodeId: 'send_invoice',
  itemIndex: 0,
  pass: 0,
  attempt: 1,
  kind: 'connector',
  nodeType: 'imap-smtp.send',
  input: { to: 'billing@example.test' },
  startedAt: 1_790_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  access.read = true;
  access.control = 'ok';
  getRun.mockResolvedValue({ id: 'run_1', projectId: null });
  readOpenInDoubt.mockResolvedValue(attempt);
  resolveInDoubtInTx.mockResolvedValue(undefined);
});

describe('GET /runs/:runId/in-doubt', () => {
  it('answers the open write with its connector in words and its action', async () => {
    const res = await read();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { inDoubt: Record<string, unknown> };
    expect(body.inDoubt).toMatchObject({
      attemptId: 'attempt_1',
      nodeId: 'send_invoice',
      input: { to: 'billing@example.test' },
      action: 'send',
    });
    // The shipped catalog's display name, not the slug of the node type.
    expect(body.inDoubt.connector).toBe('IMAP / SMTP Mailbox');
    expect(readOpenInDoubt).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'run_1',
    );
  });

  it('names a connector nothing ships any more by its slug', async () => {
    readOpenInDoubt.mockResolvedValue({
      ...attempt,
      nodeType: 'retired-vendor.push',
    });
    const body = (await (await read()).json()) as {
      inDoubt: Record<string, unknown>;
    };
    expect(body.inDoubt).toMatchObject({
      connector: 'retired-vendor',
      action: 'push',
    });
  });

  it('answers null when nothing waits', async () => {
    readOpenInDoubt.mockResolvedValue(null);
    await expect((await read()).json()).resolves.toEqual({ inDoubt: null });
  });

  it('answers a hidden run like one with nothing waiting, without reading the ledger', async () => {
    access.read = false;
    getRun.mockResolvedValue({ id: 'run_1', projectId: 'p-hidden' });
    await expect((await read()).json()).resolves.toEqual({ inDoubt: null });
    expect(readOpenInDoubt).not.toHaveBeenCalled();
  });
});

describe('POST /runs/:runId/in-doubt/:attemptId', () => {
  it.each(['retry', 'skip', 'fail'] as const)(
    'records %s as the deciding member, in one transaction',
    async (resolution) => {
      const res = await decide({ resolution, attempt: 2 });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
      // The attempt the choice is about reaches the locked update, which
      // refuses an earlier attempt of the same write [AUTO-R19].
      expect(resolveInDoubtInTx).toHaveBeenCalledWith(tx, {
        organizationId: 'o1',
        runId: 'run_1',
        attemptId: 'attempt_1',
        attempt: 2,
        resolution,
        actor: 'u1',
      });
    },
  );

  it.each([
    ['an empty body', {}],
    ['an unknown choice', { resolution: 'undo', attempt: 1 }],
    ['an extra key', { resolution: 'skip', attempt: 1, note: 'x' }],
    ['a choice that names no attempt', { resolution: 'skip' }],
    ['attempt 0', { resolution: 'skip', attempt: 0 }],
    ['a fractional attempt', { resolution: 'skip', attempt: 1.5 }],
    ['an attempt as text', { resolution: 'skip', attempt: '1' }],
    [
      'an attempt past the ledger int',
      { resolution: 'skip', attempt: 2 ** 31 },
    ],
  ])('refuses %s with the domain 400', async (_label, body) => {
    const res = await decide(body);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid body' });
    expect(resolveInDoubtInTx).not.toHaveBeenCalled();
  });

  it('answers a missing run as not found', async () => {
    getRun.mockResolvedValue(null);
    const res = await decide({ resolution: 'skip', attempt: 1 });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'RUN_NOT_FOUND' });
    expect(resolveInDoubtInTx).not.toHaveBeenCalled();
  });

  it('answers a run in a project the member cannot read as not found', async () => {
    access.control = 'hidden';
    getRun.mockResolvedValue({ id: 'run_1', projectId: 'p-hidden' });
    const res = await decide({ resolution: 'skip', attempt: 1 });
    expect(res.status).toBe(404);
    expect(resolveInDoubtInTx).not.toHaveBeenCalled();
  });

  it('refuses a member who may read the run but not write its project', async () => {
    access.control = 'forbidden';
    getRun.mockResolvedValue({ id: 'run_1', projectId: 'p-readonly' });
    const res = await decide({ resolution: 'retry', attempt: 1 });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'RBAC_FORBIDDEN',
    });
    expect(resolveInDoubtInTx).not.toHaveBeenCalled();
  });

  it.each([
    [
      'RUN_NOT_IN_DOUBT',
      'The run is not waiting for a decision about a step that may already have run.',
    ],
    [
      'IN_DOUBT_ALREADY_RESOLVED',
      'This step was already decided, or it no longer waits for a decision.',
    ],
  ])(
    'keeps the store refusal %s as a 409 in its own words',
    async (code, message) => {
      resolveInDoubtInTx.mockRejectedValue(
        new AutomationError(code, message, 409),
      );
      const res = await decide({ resolution: 'skip', attempt: 1 });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: code, message });
    },
  );
});
