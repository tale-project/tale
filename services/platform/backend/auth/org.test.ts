import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MembershipError, requireOrganizationMember } from './membership.ts';
import { requireOrgMember, type OrgEnv } from './org.ts';

vi.mock('./membership.ts', async (original) => ({
  ...(await original<typeof import('./membership.ts')>()),
  requireOrganizationMember: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
});

describe('organization membership error envelope', () => {
  it.each([
    ['ORG_NOT_FOUND', 404],
    ['ORG_FORBIDDEN', 403],
  ] as const)(
    'preserves %s as a machine code for the dashboard access gate',
    async (code, status) => {
      vi.mocked(requireOrganizationMember).mockRejectedValue(
        new MembershipError('Organization access refused.', code),
      );
      const app = new Hono<OrgEnv>();
      app.use(async (c, next) => {
        c.set('sessionBundle', {
          user: {
            id: 'user-a',
            email: 'user@example.invalid',
            name: 'Test user',
          },
          session: { id: 'session-a' },
        });
        await next();
      });
      app.use(requireOrgMember({} as never));
      app.get('/me', (c) => c.json({ status: 'ok' }));
      const response = await app.request('/me?orgId=org-a');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: code,
        message: 'Organization access refused.',
      });
    },
  );
});
