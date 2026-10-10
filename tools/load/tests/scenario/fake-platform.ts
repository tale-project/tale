/**
 * A tiny stand-in for the platform, enough for one virtual user to live a
 * session against: Better Auth's sign-in and session probe, the org hint
 * stream, a thread lane that is always idle, and a JSON answer for every
 * other route (empty lists, `{ok: true}`). Tests override single routes.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { LoadPlan } from '../../src/plan.ts';

export interface SeenRequest {
  method: string;
  /** Path without the query. */
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: string;
}

export type Override = (
  request: SeenRequest,
  response: ServerResponse,
) => boolean;

export interface FakePlatform {
  url: string;
  requests: SeenRequest[];
  /** Event streams currently open. */
  openStreams: () => number;
  /** Push a hint to every open `/events` stream. */
  hint: (entity: string, entityId: string) => void;
  /** First match wins; return `true` when the override answered. */
  overrides: Override[];
  close: () => Promise<void>;
}

const SESSION_COOKIE = 'better-auth.session_token';

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

export async function startFakePlatform(
  options: { userId?: string; orgId?: string } = {},
): Promise<FakePlatform> {
  const userId = options.userId ?? 'user-1';
  const orgId = options.orgId ?? 'org-0';
  const requests: SeenRequest[] = [];
  const events = new Set<ServerResponse>();
  const streams = new Set<ServerResponse>();
  const overrides: Override[] = [];
  let hintId = 0;

  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake.test');
      const seen: SeenRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(seen);
      for (const override of overrides) {
        if (override(seen, res)) return;
      }
      const cookie = req.headers.cookie ?? '';
      const signedIn = cookie.includes(`${SESSION_COOKIE}=`);
      const route = `${seen.method} ${seen.path}`;
      if (route === 'POST /api/auth/sign-in/email') {
        res.setHeader(
          'set-cookie',
          `${SESSION_COOKIE}=fresh.sig; Path=/; HttpOnly`,
        );
        json(res, 200, { user: { id: userId } });
        return;
      }
      if (route === 'GET /api/auth/get-session') {
        json(
          res,
          200,
          signedIn
            ? { user: { id: userId }, session: { activeOrganizationId: orgId } }
            : null,
        );
        return;
      }
      if (!signedIn && seen.path.startsWith('/api/app/')) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      const isEvents = seen.path === '/events';
      const isLane = /^\/api\/app\/chat\/threads\/[^/]+\/stream$/.test(
        seen.path,
      );
      if (isEvents || isLane) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        res.write(isLane ? 'event: idle\ndata: \n\n' : ': open\n\n');
        const set = isEvents ? events : streams;
        set.add(res);
        res.on('close', () => set.delete(res));
        return;
      }
      if (route === 'GET /api/app/users/me') {
        json(res, 200, { user: { userId, name: 'Load User' } });
        return;
      }
      if (route === 'GET /api/app/members/me') {
        json(res, 200, { status: 'ok', role: 'member' });
        return;
      }
      if (route === 'GET /api/app/users/last-active-org') {
        json(res, 200, { organizationId: orgId });
        return;
      }
      if (route === 'GET /api/app/chat/composer/models') {
        json(res, 200, {
          models: [{ id: 'load-chat-fast', providerSlug: 'loadmock' }],
        });
        return;
      }
      json(res, 200, {
        ok: true,
        threads: [],
        tasks: [],
        projects: [],
        rows: [],
        items: [],
        members: [],
        teams: [],
        organizations: [{ organizationId: orgId, role: 'member' }],
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    overrides,
    openStreams: () => events.size + streams.size,
    hint: (entity, entityId) => {
      hintId += 1;
      for (const res of events) {
        res.write(
          `id: ${hintId}\nevent: hint\ndata: ${JSON.stringify({ entity, entityId })}\n\n`,
        );
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A one-organization plan of `users` users whose org is `orgId`. */
export function fakePlan(
  target: string,
  options: { users?: number; orgId?: string; sessionsMinted?: boolean } = {},
): LoadPlan {
  const users = options.users ?? 4;
  return {
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    target,
    runId: 'testrun1',
    users: {
      count: users,
      emailDomain: 'load.tale.invalid',
      password: 'a-long-test-password',
      sessionsMinted: options.sessionsMinted ?? true,
    },
    organizations: {
      count: 1,
      size: users,
      megaOrgSize: 0,
      list: [
        {
          index: 0,
          id: options.orgId ?? 'org-0',
          slug: 'load-testrun1-o0',
          name: 'Test Org',
          ownerIndex: 0,
          projectId: 'project-0',
          providerSlug: 'loadmock',
          modelId: 'load-chat-fast',
        },
      ],
    },
    provider: null,
  };
}
