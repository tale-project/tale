import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { signSessionToken } from '../../src/client/cookies.ts';
import { createAgent } from '../../src/client/http.ts';
import { UserSession } from '../../src/client/session.ts';
import { MetricsRegistry } from '../../src/metrics/registry.ts';
import { startServer } from './test-server.ts';
import type { TestServer } from './test-server.ts';

const COOKIE = 'better-auth.session_token';
const agent = createAgent();
let server: TestServer;

/** Just enough of Better Auth's routes to exercise the session helpers. */
beforeAll(async () => {
  server = await startServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    const signedIn = request.headers.cookie?.includes(`${COOKIE}=`) === true;
    switch (`${request.method} ${request.url}`) {
      case 'POST /api/auth/sign-in/email': {
        const body = JSON.parse(request.body) as { email: string };
        if (request.headers.origin !== server.url) {
          response.statusCode = 403;
          response.end('{"message":"Invalid origin"}');
          return;
        }
        if (body.email === 'two@factor.test') {
          response.end('{"twoFactorRedirect":true}');
          return;
        }
        response.setHeader(
          'set-cookie',
          `${COOKIE}=tok.sig; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`,
        );
        response.end('{"redirect":false,"token":"tok","user":{"id":"u_1"}}');
        return;
      }
      case 'GET /api/auth/get-session':
        response.end(
          signedIn
            ? '{"session":{"activeOrganizationId":"org_9"},"user":{"id":"u_1"}}'
            : 'null',
        );
        return;
      case 'POST /api/auth/organization/set-active':
        response.end('{"id":"org_9"}');
        return;
      case 'POST /api/auth/sign-out':
        response.setHeader('set-cookie', `${COOKIE}=; Max-Age=0; Path=/`);
        response.end('{"success":true}');
        return;
      default:
        response.statusCode = 404;
        response.end('{}');
    }
  });
});

afterAll(async () => {
  await server.close();
  await agent.close();
});

function session(email: string, metrics = new MetricsRegistry()): UserSession {
  return new UserSession({
    baseUrl: server.url,
    agent,
    metrics,
    email,
    password: 'correct horse battery staple',
    forwardedFor: '10.0.0.7',
  });
}

describe('UserSession', () => {
  test('signs in, reads the session, switches org and signs out', async () => {
    const metrics = new MetricsRegistry();
    const user = session('a@load.test', metrics);
    expect(user.signedIn).toBe(false);

    const signIn = await user.signIn();
    expect(signIn).toEqual({ ok: true, status: 200, userId: 'u_1' });
    expect(user.userId).toBe('u_1');
    expect(user.signedIn).toBe(true);
    const sent = server.requests.at(-1);
    expect(sent?.headers['x-forwarded-for']).toBe('10.0.0.7');
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({
      email: 'a@load.test',
      password: 'correct horse battery staple',
    });

    const info = await user.getSession();
    expect(info).toEqual({
      ok: true,
      status: 200,
      userId: 'u_1',
      activeOrganizationId: 'org_9',
    });
    expect(server.requests.at(-1)?.headers.cookie).toBe(`${COOKIE}=tok.sig`);

    const active = await user.setActiveOrganization('org_9');
    expect(active.ok).toBe(true);
    expect(user.orgId).toBe('org_9');
    expect(JSON.parse(server.requests.at(-1)?.body ?? '{}')).toEqual({
      organizationId: 'org_9',
    });

    expect(user.streamHeaders()).toEqual({
      cookie: `${COOKIE}=tok.sig`,
      'x-forwarded-for': '10.0.0.7',
    });

    const signOut = await user.signOut();
    expect(signOut.ok).toBe(true);
    expect(user.signedIn).toBe(false);
    expect((await user.getSession()).ok).toBe(false);

    const statuses = metrics.snapshot().statuses;
    expect(statuses['POST /api/auth/sign-in/email']).toEqual({ '200': 1 });
    expect(statuses['GET /api/auth/get-session']).toEqual({ '200': 2 });
  });

  test('a second-factor challenge is not a session', async () => {
    const result = await session('two@factor.test').signIn();
    expect(result).toEqual({
      ok: false,
      status: 200,
      userId: undefined,
      twoFactorRedirect: true,
    });
  });

  test('an adopted token is sent as the signed session cookie', async () => {
    const user = session('seeded@load.test');
    user.adoptSessionToken('seededtoken', 'the-auth-secret');
    expect(user.signedIn).toBe(true);
    const info = await user.getSession();
    expect(info.ok).toBe(true);
    expect(server.requests.at(-1)?.headers.cookie).toBe(
      `${COOKIE}=${signSessionToken('seededtoken', 'the-auth-secret')}`,
    );
  });
});
