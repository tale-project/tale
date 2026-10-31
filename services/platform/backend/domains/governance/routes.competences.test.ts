// @vitest-environment node

/**
 * A competence grant's `expiresAt` ends the grant on its own, and the door
 * took any finite number: `9e15` (an instant no `Date` can hold) or a
 * fractional millisecond stored as the grant's expiry. The door now holds
 * it to `epochMsSchema` — whole epoch ms up to 8.64e15 — and refuses the
 * rest with its 400 before the register is touched. The edit door holds a
 * changed expiry to the same bound, and passes on only what it is given.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { grantCompetence, updateCompetence } = vi.hoisted(() => ({
  grantCompetence: vi.fn(),
  updateCompetence: vi.fn(),
}));

vi.mock('./competence.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./competence.ts')>()),
  grantCompetence,
  updateCompetence,
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

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createGovernanceRoutes } from './routes.ts';

async function grant(expiresAt: unknown): Promise<Response> {
  return await createGovernanceRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request('/competences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'u2',
      competence: 'tale:notifications.export',
      expiresAt,
    }),
  });
}

async function edit(body: unknown): Promise<Response> {
  return await createGovernanceRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request('/competences/r1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  grantCompetence.mockReset().mockResolvedValue({ recordId: 'r1' });
  updateCompetence.mockReset().mockResolvedValue({ changed: true });
});

describe('POST /competences holds expiresAt to the epoch bound', () => {
  it.each([9e15, EPOCH_MS_MAX + 1, -1, 1_790_400_000_000.5, '1790400000000'])(
    'refuses expiresAt %s with a 400',
    async (expiresAt) => {
      const res = await grant(expiresAt);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid body' });
      expect(grantCompetence).not.toHaveBeenCalled();
    },
  );

  it('grants up to the latest instant a Date can hold', async () => {
    const res = await grant(EPOCH_MS_MAX);
    expect(res.status).toBe(201);
    expect(grantCompetence).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ expiresAt: EPOCH_MS_MAX }),
    );
  });
});

describe('POST /competences names exactly one holder [GOV-R19]', () => {
  const send = (body: Record<string, unknown>) =>
    createGovernanceRoutes({ sql: {} as never, auth: {} as never }).request(
      '/competences',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ competence: 'tale:models.api', ...body }),
      },
    );

  it.each([
    ['no holder', {}],
    ['a member and a team', { userId: 'u2', teamId: 't1' }],
  ])('refuses %s with a 400 before the register', async (_label, holder) => {
    const res = await send(holder);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid body' });
    expect(grantCompetence).not.toHaveBeenCalled();
  });

  it('hands a team holder to the register, with no member', async () => {
    const res = await send({ teamId: 't1' });
    expect(res.status).toBe(201);
    expect(grantCompetence).toHaveBeenCalledTimes(1);
    const [, args] = grantCompetence.mock.calls[0] as [unknown, object];
    expect(args).toMatchObject({
      organizationId: 'o1',
      teamId: 't1',
      competence: 'tale:models.api',
    });
    expect(args).not.toHaveProperty('userId');
  });
});

describe('PATCH /competences/:recordId changes a grant in place [GOV-R18]', () => {
  it.each([
    [{}],
    [{ expiresAt: 9e15 }],
    [{ expiresAt: 1_790_400_000_000.5 }],
    [{ expiresAt: '1790400000000' }],
    [{ evidence: 'x'.repeat(4001) }],
    [{ evidence: 42 }],
  ])('refuses %j with a 400 before the register is touched', async (body) => {
    const res = await edit(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid body' });
    expect(updateCompetence).not.toHaveBeenCalled();
  });

  it('passes on the fields it is given, a null included, and only those', async () => {
    const res = await edit({ expiresAt: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true });
    expect(updateCompetence).toHaveBeenCalledWith(
      {},
      {
        organizationId: 'o1',
        actor: { userId: 'u1', email: 'u@example.test', role: 'admin' },
        recordId: 'r1',
        expiresAt: null,
      },
    );
  });

  it('passes on a new expiry and evidence together', async () => {
    await edit({ expiresAt: EPOCH_MS_MAX, evidence: 'Course 2026' });
    expect(updateCompetence).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        expiresAt: EPOCH_MS_MAX,
        evidence: 'Course 2026',
      }),
    );
  });

  it('answers a refusal of the register with its code and status', async () => {
    const { CompetenceError } = await import('./competence.ts');
    updateCompetence.mockRejectedValue(
      new CompetenceError(
        'COMPETENCE_EXPIRED',
        'this grant has expired — grant it again instead',
        409,
      ),
    );
    const res = await edit({ evidence: 'Course 2026' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'COMPETENCE_EXPIRED' });
  });
});
