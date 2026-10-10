import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentRunnerTenant } from '../../lib/engine/runners/tenant.ts';
import { trustedRoleHolds } from '../domains/trusted_headers/service.ts';
import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import {
  MembershipError,
  requireOrganizationMembership,
} from './membership.ts';
import { requireOrgMember, type OrgEnv } from './org.ts';

vi.mock('./membership.ts', async (original) => ({
  ...(await original<typeof import('./membership.ts')>()),
  requireOrganizationMembership: vi.fn(),
}));
vi.mock('../domains/trusted_headers/service.ts', () => ({
  trustedRoleHolds: vi.fn(),
}));
vi.mock('../domains/two_factor/service.ts', () => ({
  evaluateTwoFactorEnforcement: vi.fn(),
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
      vi.mocked(requireOrganizationMembership).mockRejectedValue(
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

describe('a trusted-headers role on the session [THDR-R10]', () => {
  /** The role the gate settles on for a member whose seat is `seat` and
   * whose session carries `session`. */
  async function roleFor(
    seat: string,
    session: Record<string, unknown>,
  ): Promise<string> {
    vi.mocked(requireOrganizationMembership).mockResolvedValue({
      member: {
        id: 'member-a',
        organizationId: 'org-a',
        userId: 'user-a',
        role: seat,
      },
      organizationIds: ['org-a'],
    });
    vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue({
      decision: 'allowed',
    } as never);
    const app = new Hono<OrgEnv>();
    app.use(async (c, next) => {
      c.set('sessionBundle', {
        user: { id: 'user-a', email: 'a@example.invalid', name: 'A' },
        session: { id: 'session-a', ...session },
      });
      await next();
    });
    app.use(requireOrgMember({} as never));
    app.get('/me', (c) => c.json({ role: c.get('orgMember').role }));
    const response = await app.request('/me?orgId=org-a');
    const body = (await response.json()) as { role: string };
    return body.role;
  }

  it('applies the proxy role while the organization still allows it', async () => {
    vi.mocked(trustedRoleHolds).mockResolvedValue(true);
    await expect(
      roleFor('member', {
        trustedRole: 'Editor',
        trustedOrganizationId: 'org-a',
      }),
    ).resolves.toBe('editor');
    expect(trustedRoleHolds).toHaveBeenCalledWith({}, 'org-a', 'editor');
  });

  it("falls back to the member's own seat when the role could not have been asserted", async () => {
    vi.mocked(trustedRoleHolds).mockResolvedValue(false);
    await expect(
      roleFor('member', {
        trustedRole: 'owner',
        trustedOrganizationId: 'org-a',
      }),
    ).resolves.toBe('member');
  });

  it('asks nothing for a session without a trusted role, or one bound to another organization', async () => {
    await expect(roleFor('member', {})).resolves.toBe('member');
    await expect(
      roleFor('member', {
        trustedRole: 'admin',
        trustedOrganizationId: 'org-b',
      }),
    ).resolves.toBe('member');
    expect(trustedRoleHolds).not.toHaveBeenCalled();
  });
});

describe("a request's automation code", () => {
  it("queues as its organization's in the runner", async () => {
    vi.mocked(requireOrganizationMembership).mockResolvedValue({
      member: {
        id: 'member-a',
        organizationId: 'org-a',
        userId: 'user-a',
        role: 'member',
      },
      organizationIds: ['org-a'],
    });
    vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue({
      decision: 'allowed',
    } as never);
    const app = new Hono<OrgEnv>();
    app.use(async (c, next) => {
      c.set('sessionBundle', {
        user: { id: 'user-a', email: 'a@example.invalid', name: 'A' },
        session: { id: 'session-a' },
      });
      await next();
    });
    app.use(requireOrgMember({} as never));
    app.get('/me', (c) => c.json({ tenant: currentRunnerTenant() }));
    const response = await app.request('/me?orgId=org-a');
    expect(await response.json()).toEqual({ tenant: 'org-a' });
  });
});
