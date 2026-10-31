// @vitest-environment node

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatWorkToolsStatus } from '../../../lib/chat/work-tools-status.ts';
import type { OrgEnv } from '../../auth/org.ts';

const { caller, readChatWorkToolsStatus } = vi.hoisted(() => ({
  caller: { role: 'admin' },
  readChatWorkToolsStatus: vi.fn(),
}));

vi.mock('./work-tools-status.ts', () => ({ readChatWorkToolsStatus }));

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
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

import { createChatRoutes } from './routes.ts';

const STATUS: ChatWorkToolsStatus = {
  checkedAt: 1_700_000_000_000,
  tools: [
    { tool: 'files', state: 'available', reasons: [] },
    {
      tool: 'code',
      state: 'unavailable',
      reasons: [{ code: 'sandbox_unreachable' }],
    },
    { tool: 'skills', state: 'available', reasons: [] },
    {
      tool: 'images',
      state: 'unavailable',
      reasons: [{ code: 'image_generation_off' }],
    },
  ],
};

describe('GET /work-tools [CHAT-R35]', () => {
  const sql = {};
  const app = createChatRoutes({ sql: sql as never, auth: {} as never });

  beforeEach(() => {
    readChatWorkToolsStatus.mockReset();
    readChatWorkToolsStatus.mockResolvedValue(STATUS);
  });

  it.each(['owner', 'admin', 'Admin'])(
    'answers a %s with the status of their organization, never cached',
    async (role) => {
      caller.role = role;
      const res = await app.request('/work-tools?orgId=o1');
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual(STATUS);
      expect(readChatWorkToolsStatus).toHaveBeenCalledWith(sql, 'o1');
    },
  );

  it.each(['developer', 'editor', 'member', 'disabled'])(
    'refuses a %s without reading anything',
    async (role) => {
      caller.role = role;
      const res = await app.request('/work-tools?orgId=o1');
      expect(res.status).toBe(403);
      expect(readChatWorkToolsStatus).not.toHaveBeenCalled();
    },
  );
});
