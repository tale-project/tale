// @vitest-environment node

/**
 * A task's `startDate` / `dueDate` are what the board dates it by, and the
 * create and update doors took any positive safe integer: `9e15` stored, and
 * no `Date` can hold it — the card rendered a blank chip and the detail
 * sheet's date picker threw when opened. Both doors now hold the two dates
 * to `epochMsSchema` (whole epoch ms up to 8.64e15), zero still refused.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  createTask,
  updateTask,
  getProjectAuthContext,
  checkUserRateLimit,
  transactSerializable,
} = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getProjectAuthContext: vi.fn(),
  checkUserRateLimit: vi.fn(),
  transactSerializable: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  createTask,
  updateTask,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkUserRateLimit,
}));
vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));

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
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createTaskRoutes } from './routes.ts';

async function post(route: string, body: unknown): Promise<Response> {
  return await createTaskRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAuthContext.mockResolvedValue({ organizationId: 'o1' });
  checkUserRateLimit.mockResolvedValue(undefined);
  transactSerializable.mockImplementation(
    async (_sql: unknown, fn: (tx: unknown) => unknown) => await fn({}),
  );
  createTask.mockResolvedValue('t1');
  updateTask.mockResolvedValue(undefined);
});

const DATE_FIELDS = ['startDate', 'dueDate'] as const;
const REFUSED = [9e15, EPOCH_MS_MAX + 1, 0, -1, 1.5, '1790400000000'];

describe('task date doors hold a date to the epoch bound', () => {
  describe.each(DATE_FIELDS)('%s', (field) => {
    it.each(REFUSED)('refuses %s on create with a 400', async (value) => {
      const res = await post('/', {
        projectId: 'p1',
        title: 'Plan',
        [field]: value,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid body' });
      expect(createTask).not.toHaveBeenCalled();
    });

    it.each(REFUSED)('refuses %s on update with a 400', async (value) => {
      const res = await post('/t1', { [field]: value });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid body' });
      expect(updateTask).not.toHaveBeenCalled();
    });

    it('stores the latest instant a Date can hold', async () => {
      const created = await post('/', {
        projectId: 'p1',
        title: 'Plan',
        [field]: EPOCH_MS_MAX,
      });
      expect(created.status).toBe(200);
      expect(createTask).toHaveBeenCalledWith(
        {},
        { organizationId: 'o1' },
        expect.objectContaining({ [field]: EPOCH_MS_MAX }),
      );

      const updated = await post('/t1', { [field]: EPOCH_MS_MAX });
      expect(updated.status).toBe(200);
      expect(updateTask).toHaveBeenCalledWith(
        {},
        { organizationId: 'o1' },
        expect.objectContaining({ taskId: 't1', [field]: EPOCH_MS_MAX }),
      );
    });

    it('still clears the date with null on update', async () => {
      const res = await post('/t1', { [field]: null });
      expect(res.status).toBe(200);
      expect(updateTask).toHaveBeenCalledWith(
        {},
        { organizationId: 'o1' },
        expect.objectContaining({ taskId: 't1', [field]: null }),
      );
    });
  });
});
