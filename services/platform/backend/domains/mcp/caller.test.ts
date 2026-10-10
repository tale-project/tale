import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from '../../rest/shared.ts';
import { callerFromRest, type McpCaller } from './caller.ts';

/** The caller `callerFromRest` builds from what the REST door set. */
async function callerOf(door: {
  apiKeyId: string;
  requestId?: string;
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
});
