// @vitest-environment node

import type { Context, Next } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createSsoAdminRoutes } from './admin-routes.ts';
import * as admin from './admin.ts';
import * as config from './config.ts';

/**
 * Who may use the SSO settings surface. The session and org middlewares are
 * stubbed to a caller whose role each test picks (or to nobody signed in),
 * and the settings and discovery services are mocked, so this exercises the
 * routes' own gates alone.
 */

const caller = vi.hoisted(() => ({ signedIn: true, role: 'admin' }));

vi.mock('../../auth/session.ts', () => ({
  requireSession: () => async (c: Context, next: Next) => {
    if (!caller.signedIn) return c.json({ error: 'UNAUTHENTICATED' }, 401);
    c.set('sessionBundle', {
      user: { id: 'user-1', email: 'mia@door.test', name: 'Mia' },
      session: { id: 'sess-1' },
    });
    return next();
  },
}));

vi.mock('../../auth/org.ts', () => ({
  requireOrgMember: () => async (c: Context, next: Next) => {
    c.set('orgId', 'org-1');
    c.set('orgMember', {
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'user-1',
      role: caller.role,
    });
    return next();
  },
}));

vi.mock('./admin.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./admin.ts')>();
  return {
    ...actual,
    getSsoConnectionView: vi.fn(),
    upsertOidcConnection: vi.fn(),
    upsertSamlConnection: vi.fn(),
    setSsoProvisioning: vi.fn(),
    setSsoEnabled: vi.fn(),
    removeSsoConnection: vi.fn(),
    revealSsoClientId: vi.fn(),
    testSsoConnection: vi.fn(),
    parseSsoIdpMetadata: vi.fn(),
  };
});

vi.mock('./config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.ts')>();
  return {
    ...actual,
    getSsoDiscoveryStatus: vi.fn(),
    listSelectableSsoConnections: vi.fn(),
  };
});

const view = { protocol: 'oidc', enabled: true, displayName: 'Contoso' };

/** The roles that may not read `orgSettings`, and the two that may. */
const REFUSED = ['member', 'editor', 'developer', 'disabled'];
const ALLOWED = ['admin', 'owner'];

/** Every route behind the write gate, and every service behind them all. */
const WRITES = [
  ['PUT', '/config/oidc'],
  ['PUT', '/config/saml'],
  ['PUT', '/config/provisioning'],
  ['POST', '/config/enabled'],
  ['DELETE', '/config'],
  ['GET', '/config/client-id'],
  ['POST', '/config/test'],
  ['POST', '/config/parse-idp-metadata'],
];
const SERVICES = [
  admin.getSsoConnectionView,
  admin.upsertOidcConnection,
  admin.upsertSamlConnection,
  admin.setSsoProvisioning,
  admin.setSsoEnabled,
  admin.removeSsoConnection,
  admin.revealSsoClientId,
  admin.testSsoConnection,
  admin.parseSsoIdpMetadata,
];

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the stubbed middlewares and mocked services touch neither
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {} as unknown as Auth;
  return createSsoAdminRoutes({ sql, auth });
}

async function request(path: string, method = 'GET'): Promise<Response> {
  return await app().request(`http://backend-api:3005${path}?orgId=org-1`, {
    method,
    ...(method === 'PUT' || method === 'POST'
      ? { headers: { 'content-type': 'application/json' }, body: '{}' }
      : {}),
  });
}

beforeEach(() => {
  caller.signedIn = true;
  caller.role = 'admin';
  for (const service of SERVICES) vi.mocked(service).mockReset();
  vi.mocked(admin.getSsoConnectionView).mockResolvedValue(view);
  vi.mocked(config.getSsoDiscoveryStatus)
    .mockReset()
    .mockResolvedValue({ enabled: false });
  vi.mocked(config.listSelectableSsoConnections)
    .mockReset()
    .mockResolvedValue([]);
});

describe("the connection's settings are the owner's and admins' alone [SSO-R22]", () => {
  it.each(REFUSED)(
    'GET /config as %s is refused as a write is, and the view is never read',
    async (role) => {
      caller.role = role;

      const res = await request('/config');

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'Only admins can view the SSO settings',
      });
      expect(admin.getSsoConnectionView).not.toHaveBeenCalled();
    },
  );

  it.each(ALLOWED)('GET /config as %s answers the view', async (role) => {
    caller.role = role;

    const res = await request('/config');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(admin.getSsoConnectionView).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
    );
  });

  it.each(WRITES)(
    '%s %s refuses every role that may not read the settings',
    async (method, path) => {
      for (const role of REFUSED) {
        caller.role = role;

        const res = await request(path, method);

        expect(res.status, role).toBe(403);
        expect(await res.json(), role).toEqual({
          error: 'Only admins can configure SSO',
        });
      }
      for (const service of SERVICES) expect(service).not.toHaveBeenCalled();
    },
  );
});

describe('the sign-in page still discovers connections with nobody signed in [SSO-R22]', () => {
  it.each([
    ['/discovery/configured', { enabled: false }],
    ['/discovery/selectable', { connections: [] }],
    ['/discovery/trusted-headers', { handoff: false }],
  ])('GET %s answers', async (path, body) => {
    caller.signedIn = false;

    const res = await app().request(`http://backend-api:3005${path}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it('while the settings ask for a session first', async () => {
    caller.signedIn = false;

    const res = await request('/config');

    expect(res.status).toBe(401);
    expect(admin.getSsoConnectionView).not.toHaveBeenCalled();
  });
});
