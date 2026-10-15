// @vitest-environment node

/**
 * The managed configuration door of a connector credential
 * (`/api/app/connector-credentials/configuration`): behind the developer
 * capability, as every credential write is, the credential named in the
 * query and the body alike, and a refusal that never carries a value.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  checkManagedConnectorCredential,
  readManagedConnectorCredential,
  writeManagedConnectorCredential,
  member,
} = vi.hoisted(() => ({
  checkManagedConnectorCredential: vi.fn(),
  readManagedConnectorCredential: vi.fn(),
  writeManagedConnectorCredential: vi.fn(),
  member: { role: 'admin' },
}));

vi.mock('./managed.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managed.ts')>()),
  checkManagedConnectorCredential,
  readManagedConnectorCredential,
  writeManagedConnectorCredential,
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

import { createConnectorCredentialRoutes } from './routes.ts';

const PASSWORD = 'jira-route-secret-value-0002';

function send(method: 'GET' | 'POST', route: string, body?: unknown) {
  return createConnectorCredentialRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const write = (name: string) => ({
  config: { connector: 'jira', name, authMethod: 'basic' },
  secret: { username: 'ops@example.com', password: PASSWORD },
  expectedHash: null,
  createIfMissing: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  member.role = 'admin';
  readManagedConnectorCredential.mockResolvedValue({
    config: null,
    hash: null,
  });
  writeManagedConnectorCredential.mockResolvedValue(undefined);
  checkManagedConnectorCredential.mockResolvedValue({ ok: true });
});

describe('the managed door of a connector credential', () => {
  it('reads and writes behind the developer capability alone', async () => {
    member.role = 'member';
    expect(
      (await send('GET', '/configuration?connector=jira&name=Ops')).status,
    ).toBe(403);
    expect(
      (
        await send(
          'POST',
          '/configuration?connector=jira&name=Ops',
          write('Ops'),
        )
      ).status,
    ).toBe(403);
    expect(readManagedConnectorCredential).not.toHaveBeenCalled();
    expect(writeManagedConnectorCredential).not.toHaveBeenCalled();
  });

  it('reads the credential its query names, whether it may create it or not', async () => {
    const answer = await send(
      'GET',
      '/configuration?connector=jira&name=Ops&createIfMissing=true',
    );
    expect(answer.status).toBe(200);
    expect(readManagedConnectorCredential).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'jira',
      'Ops',
      true,
    );
    expect((await send('GET', '/configuration?connector=jira')).status).toBe(
      400,
    );
  });

  it('writes the credential its query names whatever the case, and refuses another without echoing a value [CCRED-R8]', async () => {
    const refused = await send(
      'POST',
      '/configuration?connector=jira&name=Other',
      write('Ops'),
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(PASSWORD);
    expect(writeManagedConnectorCredential).not.toHaveBeenCalled();

    const written = await send(
      'POST',
      '/configuration?connector=jira&name=ops',
      write('Ops'),
    );
    expect(written.status).toBe(200);
    expect(await written.text()).not.toContain(PASSWORD);
    expect(writeManagedConnectorCredential).toHaveBeenCalledWith(
      expect.anything(),
      {
        ...write('Ops'),
        organizationId: 'org-1',
        actor: { userId: 'ada', email: 'ada@example.test' },
      },
    );
  });

  it('takes no sign-in the outside system renews', async () => {
    const answer = await send(
      'POST',
      '/configuration?connector=jira&name=Ops',
      {
        ...write('Ops'),
        config: { connector: 'jira', name: 'Ops', authMethod: 'oauth2' },
      },
    );
    expect(answer.status).toBe(400);
    expect(writeManagedConnectorCredential).not.toHaveBeenCalled();
  });

  it('checks the credential its query names, behind the same capability, and never takes a value [CCRED-R8]', async () => {
    const target = { connector: 'jira', name: 'Ops', authMethod: 'basic' };
    member.role = 'member';
    expect(
      (
        await send('POST', '/configuration/check?connector=jira&name=Ops', {
          config: target,
        })
      ).status,
    ).toBe(403);
    member.role = 'admin';
    const answer = await send(
      'POST',
      '/configuration/check?connector=jira&name=ops',
      { config: target },
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    expect(checkManagedConnectorCredential).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      target,
    );
    // A check carries no secret, and names the credential its query does.
    for (const body of [
      { config: target, secret: { password: PASSWORD } },
      { config: { ...target, name: 'Other' } },
    ]) {
      const refused = await send(
        'POST',
        '/configuration/check?connector=jira&name=Ops',
        body,
      );
      expect(refused.status).toBe(400);
      expect(await refused.text()).not.toContain(PASSWORD);
    }
    expect(checkManagedConnectorCredential).toHaveBeenCalledTimes(1);
  });
});
