// @vitest-environment node

/**
 * The app door of an automation's writes without approval: authors read
 * them, and only an owner or admin changes them.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const allowances = vi.hoisted(() => ({
  readApprovalAllowanceRows: vi.fn(),
  setApprovalAllowances: vi.fn(),
}));

/** The signed-in member's organization role. */
const member = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('./approval-allowances.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./approval-allowances.ts')>()),
  ...allowances,
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
        c.set('orgMember', { role: member.role } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    createAutomationRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request(path, init),
  );
}

const put = (allowed: unknown) =>
  request('/morning-digest/approval-allowances', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allowed }),
  });

const ROWS = [
  {
    type: 'slack.send_message',
    used: true,
    allowance: {
      grantedBy: 'u1',
      grantedByName: 'Ada',
      grantedAt: 1_791_000_000_000,
    },
  },
];

beforeEach(() => {
  member.role = 'owner';
  allowances.readApprovalAllowanceRows.mockReset();
  allowances.readApprovalAllowanceRows.mockResolvedValue(ROWS);
  allowances.setApprovalAllowances.mockReset();
  allowances.setApprovalAllowances.mockResolvedValue({
    granted: ['slack.send_message'],
    withdrawn: [],
  });
});

describe('the writes an automation may make without approval, at the app door [APV-R13]', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['developer', false],
  ])(
    'lists them for a %s, saying whether they may change them',
    async (role, canGrant) => {
      member.role = role;
      const response = await request('/morning-digest/approval-allowances');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ actions: ROWS, canGrant });
    },
  );

  it('lists nothing to a member, who cannot open automations', async () => {
    member.role = 'member';
    const response = await request('/morning-digest/approval-allowances');
    expect(response.status).toBe(403);
    expect(allowances.readApprovalAllowanceRows).not.toHaveBeenCalled();
  });

  it('lets an owner or admin set them, as the person who grants', async () => {
    member.role = 'admin';
    const response = await put(['slack.send_message']);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      granted: ['slack.send_message'],
      withdrawn: [],
    });
    expect(allowances.setApprovalAllowances).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'o1',
        allowed: ['slack.send_message'],
        origin: { actor: 'u1', via: 'app' },
        grantedBy: 'u1',
      }),
    );
  });

  it('refuses a developer, who may only read them', async () => {
    member.role = 'developer';
    const response = await put(['slack.send_message']);
    expect(response.status).toBe(403);
    expect(allowances.setApprovalAllowances).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a list of step types', async () => {
    const response = await put('slack.send_message');
    expect(response.status).toBe(400);
    expect(allowances.setApprovalAllowances).not.toHaveBeenCalled();
  });
});
