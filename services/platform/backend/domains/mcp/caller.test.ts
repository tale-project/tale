import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from '../../rest/shared.ts';
import type { ApiKeyOwner } from '../api_keys/owners.ts';
import { callerFromRest, type McpCaller } from './caller.ts';

/** The caller `callerFromRest` builds from what the REST door set. */
async function callerOf(door: {
  apiKeyId: string;
  requestId?: string;
  owner?: ApiKeyOwner;
}): Promise<McpCaller> {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-ada');
    c.set('userEmail', 'ada@example.test');
    c.set('organizationId', 'org-acme');
    c.set('orgSlug', 'acme');
    c.set('role', 'developer');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.7');
    c.set('apiKeyId', door.apiKeyId);
    c.set('apiKeyOwner', door.owner ?? null);
    if (door.requestId !== undefined) c.set('requestId', door.requestId);
    await next();
  });
  app.post('/mcp', (c) => c.json(callerFromRest(c)));
  const response = await app.request('/mcp', { method: 'POST' });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route answers exactly the caller it built
  return (await response.json()) as McpCaller;
}

describe('callerFromRest', () => {
  it('carries the organization, the person, their role and the key the door proved', async () => {
    expect(
      await callerOf({ apiKeyId: 'key-laptop', requestId: 'req-7' }),
    ).toEqual({
      organizationId: 'org-acme',
      orgSlug: 'acme',
      userId: 'user-ada',
      role: 'developer',
      credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
      requestId: 'req-7',
    });
  });

  it('names no key and no request id the door did not have', async () => {
    const caller = await callerOf({ apiKeyId: '' });
    expect(caller.credential).toEqual({ kind: 'api-key' });
    expect(caller).not.toHaveProperty('requestId');
  });

  it('says whose key it is when it is not its person’s own', async () => {
    const owner: ApiKeyOwner = {
      apiKeyId: 'key-billing',
      organizationId: 'org-acme',
      kind: 'member',
      keyUserId: 'key-user-billing',
      principalUserId: 'user-ada',
      teamId: null,
      projectId: null,
      role: null,
      name: 'Billing sync',
      createdBy: 'user-olav',
      createdAt: 1,
      revokedAt: null,
      revokedBy: null,
    };
    expect(
      (await callerOf({ apiKeyId: 'key-billing', owner })).credential,
    ).toEqual({ kind: 'api-key', apiKeyId: 'key-billing', owner: 'member' });
  });
});
