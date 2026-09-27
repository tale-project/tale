// @vitest-environment node

/**
 * A competence grant's `expiresAt` ends the grant on its own, and the door
 * took any finite number: `9e15` (an instant no `Date` can hold) or a
 * fractional millisecond stored as the grant's expiry. The door now holds
 * it to `epochMsSchema` — whole epoch ms up to 8.64e15 — and refuses the
 * rest with its 400 before the register is touched.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { grantCompetence } = vi.hoisted(() => ({ grantCompetence: vi.fn() }));

vi.mock('./competence.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./competence.ts')>()),
  grantCompetence,
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

beforeEach(() => {
  grantCompetence.mockReset().mockResolvedValue({ recordId: 'r1' });
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
