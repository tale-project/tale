// @vitest-environment node

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  caller,
  createJoinToken,
  getJoinTokenStatus,
  describeDevice,
  grantTicket,
  joinDevice,
  leaveDevice,
  listDevices,
  removeDevice,
  rateLimit,
} = vi.hoisted(() => ({
  caller: { role: 'admin' },
  createJoinToken: vi.fn(),
  getJoinTokenStatus: vi.fn(),
  describeDevice: vi.fn(),
  grantTicket: vi.fn(),
  joinDevice: vi.fn(),
  leaveDevice: vi.fn(),
  listDevices: vi.fn(),
  removeDevice: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test', name: 'User' },
        session: { id: 's1' },
      });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'member-org');
      c.set('orgMember', {
        id: 'm1',
        organizationId: 'member-org',
        userId: 'u1',
        role: caller.role,
      });
      await next();
    },
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkIpRateLimit: rateLimit,
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  createJoinToken,
  getJoinTokenStatus,
  describeDevice,
  grantTicket,
  joinDevice,
  leaveDevice,
  listDevices,
  removeDevice,
}));

import { RateLimitExceededError } from '../../lib/rate-limit.ts';
import { createSandboxDeviceDoorRoutes } from './door-routes.ts';
import { createSandboxDeviceRoutes } from './routes.ts';
import { SandboxDeviceError } from './service.ts';

const admin = () =>
  createSandboxDeviceRoutes({ sql: vi.fn() as never, auth: {} as never });
const door = () =>
  createSandboxDeviceDoorRoutes({
    sql: vi.fn() as never,
    // The deployment's default: loopback and private ranges are proxies.
    trustedProxies: async () => ['loopback', 'uniquelocal', '10.0.0.0/8'],
  });

beforeEach(() => {
  vi.clearAllMocks();
  caller.role = 'admin';
  rateLimit.mockResolvedValue(undefined);
  listDevices.mockResolvedValue({
    devices: [],
    hub: 'available',
    serverVersion: 'dev',
  });
  createJoinToken.mockResolvedValue({
    token: 'tsdj_x',
    expiresAt: 1,
    serverUrl: 'https://acme.tale.dev',
  });
});

describe('settings routes', () => {
  it('reads a grant through the authenticated membership and creator, without caching [SBXDEV-R4]', async () => {
    getJoinTokenStatus.mockResolvedValue({ deviceId: 'dev-own' });
    const res = await admin().request('/join-tokens/grant-1?orgId=foreign');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ deviceId: 'dev-own' });
    expect(getJoinTokenStatus).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'member-org',
      tokenId: 'grant-1',
      actor: { userId: 'u1', email: 'u@example.test' },
    });
  });

  it.each(['developer', 'member'])(
    '%s cannot read grant status [SBXDEV-R2]',
    async (role) => {
      caller.role = role;
      expect((await admin().request('/join-tokens/grant-1')).status).toBe(403);
      expect(getJoinTokenStatus).not.toHaveBeenCalled();
    },
  );

  it('returns the same refusal for a missing or inaccessible grant [SBXDEV-R4]', async () => {
    getJoinTokenStatus.mockRejectedValue(
      new SandboxDeviceError(
        'JOIN_TOKEN_NOT_FOUND',
        'Device command not found',
        404,
      ),
    );
    const res = await admin().request('/join-tokens/other');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Device command not found',
      code: 'JOIN_TOKEN_NOT_FOUND',
    });
  });

  it.each(['owner', 'admin', 'developer'])(
    '%s may list devices [SBXDEV-R1]',
    async (role) => {
      caller.role = role;
      const res = await admin().request('/?orgId=foreign');
      expect(res.status).toBe(200);
      // The organization is the membership's, never the query's.
      expect(listDevices).toHaveBeenCalledWith(expect.anything(), 'member-org');
    },
  );

  it('a member may not list devices [SBXDEV-R1]', async () => {
    caller.role = 'member';
    expect((await admin().request('/')).status).toBe(403);
    expect(listDevices).not.toHaveBeenCalled();
  });

  it('only admins mint a connect command or remove a device [SBXDEV-R2]', async () => {
    caller.role = 'developer';
    expect(
      (await admin().request('/join-tokens', { method: 'POST' })).status,
    ).toBe(403);
    expect((await admin().request('/dev-1', { method: 'DELETE' })).status).toBe(
      403,
    );
    caller.role = 'admin';
    const minted = await admin().request('/join-tokens', { method: 'POST' });
    expect(minted.status).toBe(201);
    expect(minted.headers.get('cache-control')).toBe('no-store');
    expect(createJoinToken).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'member-org',
      actor: { userId: 'u1', email: 'u@example.test' },
    });
    const removed = await admin().request('/dev-1', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(removeDevice).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'member-org',
      deviceId: 'dev-1',
      actor: { userId: 'u1', email: 'u@example.test' },
    });
  });

  it('a domain refusal answers its own status and code', async () => {
    removeDevice.mockRejectedValue(
      new SandboxDeviceError('DEVICE_NOT_FOUND', 'No such device', 404),
    );
    const res = await admin().request('/dev-x', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'No such device',
      code: 'DEVICE_NOT_FOUND',
    });
  });
});

describe('machine door', () => {
  const join = (body: unknown) =>
    door().request('/join', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
    });

  it('validates the join body before touching the database', async () => {
    const res = await join({ token: 'tsdj_abc12345', name: '' });
    expect(res.status).toBe(400);
    expect(joinDevice).not.toHaveBeenCalled();
  });

  it('answers a join with the device credentials', async () => {
    joinDevice.mockResolvedValue({ deviceId: 'dev-1', deviceSecret: 'tsd_s' });
    const res = await join({
      token: 'tsdj_abc12345',
      name: 'studio',
      maxSessions: 2,
      platform: { os: 'darwin', arch: 'arm64' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      deviceId: 'dev-1',
      deviceSecret: 'tsd_s',
    });
  });

  it('charges a refused credential to its source IP, and says so when over [SBXDEV-R6]', async () => {
    joinDevice.mockRejectedValue(
      new SandboxDeviceError('JOIN_TOKEN_INVALID', 'expired', 401),
    );
    const body = {
      token: 'tsdj_abc12345',
      name: 'studio',
      maxSessions: 2,
      platform: { os: 'linux', arch: 'x64' },
    };
    const refused = await join(body);
    expect(refused.status).toBe(401);
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'sandbox-devices:auth-fail-ip',
      '203.0.113.9',
    );
    rateLimit.mockRejectedValue(
      new RateLimitExceededError('sandbox-devices:auth-fail-ip', 60_000),
    );
    expect((await join(body)).status).toBe(429);
  });

  it('a spoofed forwarded-for from an untrusted peer is not the client [SBXDEV-R6]', async () => {
    joinDevice.mockRejectedValue(
      new SandboxDeviceError('JOIN_TOKEN_INVALID', 'expired', 401),
    );
    // The request reaches the door through a trusted proxy that appended the
    // real client; anything left of it is the client's own claim.
    await door().request('/join', {
      method: 'POST',
      body: JSON.stringify({
        token: 'tsdj_abc12345',
        name: 'studio',
        maxSessions: 2,
        platform: { os: 'linux', arch: 'x64' },
      }),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.7, 203.0.113.9',
      },
    });
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'sandbox-devices:auth-fail-ip',
      '203.0.113.9',
    );
  });

  it('a ticket needs the device secret as a bearer credential [SBXDEV-R7]', async () => {
    const missing = await door().request('/ticket', {
      method: 'POST',
      body: JSON.stringify({ version: '0.5.60' }),
    });
    expect(missing.status).toBe(401);
    // Its own code: a stripped header is not a removed device.
    expect(await missing.json()).toMatchObject({
      code: 'DEVICE_CREDENTIAL_MISSING',
    });
    expect(grantTicket).not.toHaveBeenCalled();
    grantTicket.mockResolvedValue({ ticket: 'tdt1.a.b' });
    const ok = await door().request('/ticket', {
      method: 'POST',
      body: JSON.stringify({ version: '0.5.60', maxSessions: 2 }),
      headers: { authorization: 'Bearer tsd_secret' },
    });
    expect(ok.status).toBe(200);
    expect(grantTicket).toHaveBeenCalledWith(expect.anything(), 'tsd_secret', {
      version: '0.5.60',
      maxSessions: 2,
    });
  });

  it('self status and self removal use the same credential [SBXDEV-R7]', async () => {
    describeDevice.mockResolvedValue({ deviceId: 'dev-1', connected: true });
    const status = await door().request('/self', {
      headers: { authorization: 'Bearer tsd_secret' },
    });
    expect(await status.json()).toEqual({ deviceId: 'dev-1', connected: true });
    const removed = await door().request('/self', {
      method: 'DELETE',
      headers: { authorization: 'Bearer tsd_secret' },
    });
    expect(removed.status).toBe(200);
    expect(leaveDevice).toHaveBeenCalledWith(expect.anything(), 'tsd_secret');
  });
});
