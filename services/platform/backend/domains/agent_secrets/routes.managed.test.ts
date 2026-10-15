// @vitest-environment node

/**
 * The managed configuration door of an agent secret
 * (`/api/app/agent-secrets/configuration`): the same admin-or-developer gate
 * as every write of the secrets manager, the secret named in the query and
 * the body alike, and a refusal that never carries the value.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { readManagedAgentSecret, writeManagedAgentSecret, member } = vi.hoisted(
  () => ({
    readManagedAgentSecret: vi.fn(),
    writeManagedAgentSecret: vi.fn(),
    member: { role: 'admin' },
  }),
);

vi.mock('./managed.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managed.ts')>()),
  readManagedAgentSecret,
  writeManagedAgentSecret,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: member.role } as never);
      await next();
    },
}));

import { createAgentSecretRoutes } from './routes.ts';

const VALUE = 'ghp_route-secret-value-0001';

function send(method: 'GET' | 'POST', route: string, body?: unknown) {
  return createAgentSecretRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  member.role = 'admin';
  readManagedAgentSecret.mockResolvedValue({ config: null, hash: null });
  writeManagedAgentSecret.mockResolvedValue(undefined);
});

describe('the managed door of an agent secret', () => {
  it('reads and writes for an admin or developer only, like every secret write', async () => {
    member.role = 'member';
    expect((await send('GET', '/configuration?name=GITHUB_TOKEN')).status).toBe(
      403,
    );
    expect(
      (
        await send('POST', '/configuration?name=GITHUB_TOKEN', {
          name: 'GITHUB_TOKEN',
          value: VALUE,
          expectedHash: null,
          createIfMissing: true,
        })
      ).status,
    ).toBe(403);
    expect(readManagedAgentSecret).not.toHaveBeenCalled();
    expect(writeManagedAgentSecret).not.toHaveBeenCalled();
  });

  it('reads an absent secret as absent only when the declaration may create it', async () => {
    const answer = await send(
      'GET',
      '/configuration?name=GITHUB_TOKEN&createIfMissing=true',
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ config: null, hash: null });
    expect(readManagedAgentSecret).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'GITHUB_TOKEN',
      true,
    );
    expect(
      (await send('GET', '/configuration?name=GITHUB_TOKEN&createIfMissing=1'))
        .status,
    ).toBe(400);
  });

  it('writes only the secret its query names, and refuses without echoing the value [ASEC-R5]', async () => {
    const refused = await send('POST', '/configuration?name=OTHER', {
      name: 'GITHUB_TOKEN',
      value: VALUE,
      expectedHash: null,
      createIfMissing: true,
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(VALUE);
    expect(writeManagedAgentSecret).not.toHaveBeenCalled();

    const written = await send('POST', '/configuration?name=GITHUB_TOKEN', {
      name: 'GITHUB_TOKEN',
      value: VALUE,
      expectedHash: null,
      createIfMissing: true,
    });
    expect(written.status).toBe(200);
    expect(await written.text()).not.toContain(VALUE);
    expect(writeManagedAgentSecret).toHaveBeenCalledWith(expect.anything(), {
      name: 'GITHUB_TOKEN',
      value: VALUE,
      expectedHash: null,
      createIfMissing: true,
      organizationId: 'org-1',
      actorId: 'ada',
      actorEmail: 'ada@example.test',
    });
  });
});
