import { afterEach, describe, expect, test } from 'bun:test';

import {
  runDeploymentSmoke,
  shellScript,
  SmokeFailure,
  smokeTarget,
  type DeploymentSmokeOptions,
} from './deployment-smoke';

const SESSION = 'better-auth.session_token';
const PASSWORD = 'correct horse battery staple';

interface FakeOptions {
  basePath?: string;
  version?: string;
  /** The web tier's HTML fallback answers `/events` (a missing proxy lane). */
  eventsFallsThrough?: boolean;
  /** The backend never hints the new task. */
  silentHints?: boolean;
  projects?: { id: string; name: string }[];
  /** Readiness answers more than the read bound. */
  hugeReady?: boolean;
  /** The smoke account's role: only owners and admins delete tasks. */
  role?: 'owner' | 'member';
  /** The chat turn is still generating when cleanup runs. */
  turnStillRunning?: boolean;
  /** Sign-in sets its cookie, but the session read then finds none. */
  sessionCheckFails?: boolean;
}

interface Seen {
  method: string;
  path: string;
  origin: string | null;
  cookie: string | null;
  body: string;
}

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A deployment as the browser sees it, behind one origin. */
function fakeDeployment(options: FakeOptions = {}) {
  const base = options.basePath ?? '';
  const seen: Seen[] = [];
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const projects = [...(options.projects ?? [{ id: 'p1', name: 'Roadmap' }])];
  const tasks = new Set<string>();
  const trashed = new Set<string>();
  const archived = new Set<string>();
  let cancelled = false;
  let trashRefusals = options.turnStillRunning ? 1 : 0;
  let signedOut = false;
  const encoder = new TextEncoder();
  const json = (
    body: unknown,
    status = 200,
    headers?: Record<string, string>,
  ) => Response.json(body, { status, headers });

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? '' : await request.text();
      seen.push({
        method: request.method,
        path: url.pathname,
        origin: request.headers.get('origin'),
        cookie: request.headers.get('cookie'),
        body,
      });
      if (!url.pathname.startsWith(`${base}/`))
        return new Response('not here', { status: 404 });
      const path = url.pathname.slice(base.length);
      const signedIn = (request.headers.get('cookie') ?? '').includes(
        `${SESSION}=s1`,
      );
      const route = `${request.method} ${path}`;

      if (route === 'GET /api/health')
        return json({ status: 'ok', version: options.version ?? '1.2.3' });
      if (route === 'GET /api/health/ready')
        return options.hugeReady
          ? new Response('x'.repeat(5 * 1024 * 1024))
          : json({ ok: true, service: 'backend' });
      if (route === 'GET /assets/index-abc.js')
        return new Response('export {};', {
          headers: { 'content-type': 'text/javascript' },
        });
      if (route === 'GET /api/auth/get-session')
        return json(
          signedIn && !options.sessionCheckFails
            ? { user: { id: 'u1' }, session: { id: 'x' } }
            : null,
        );
      if (route === 'GET /events') {
        if (options.eventsFallsThrough) return shell(base);
        if (!signedIn) return json({ error: 'Unauthorized' }, 401);
        let held: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            held = controller;
            streams.add(controller);
            controller.enqueue(encoder.encode('retry: 3000\n\n'));
          },
          cancel() {
            if (held) streams.delete(held);
          },
        });
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (route === 'POST /api/auth/sign-in/email') {
        const credentials = JSON.parse(body) as { password: string };
        if (credentials.password !== PASSWORD)
          return json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401);
        return json({ redirect: false, user: { id: 'u1' } }, 200, {
          'set-cookie': `${SESSION}=s1; Path=/; HttpOnly; SameSite=Lax`,
        });
      }
      if (path.startsWith('/api/app/') && !signedIn)
        return json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' }, 401);
      if (!signedIn && route !== 'GET /') {
        if (route === 'POST /api/auth/sign-out')
          return json({ error: 'no session' }, 401);
      }
      if (route === 'GET /api/auth/organization/list')
        return json([{ id: 'org1', slug: 'acme' }]);
      if (route === 'GET /api/app/projects') return json({ projects });
      if (route === 'POST /api/app/projects') {
        const created = { id: `p${projects.length + 1}`, ...JSON.parse(body) };
        projects.push(created);
        return json({ projectId: created.id });
      }
      if (route === 'POST /api/app/tasks') {
        const id = `t${tasks.size + 1}`;
        tasks.add(id);
        if (!options.silentHints)
          setTimeout(() => {
            for (const stream of streams)
              stream.enqueue(
                encoder.encode(
                  `event: hint\ndata: ${JSON.stringify({ entity: 'task', entityId: id })}\n\n`,
                ),
              );
          }, 20);
        return json({ taskId: id });
      }
      const task = /^\/api\/app\/tasks\/([^/]+)$/.exec(path)?.[1];
      if (task !== undefined && tasks.has(task)) {
        if (request.method === 'GET') return json({ task: { id: task } });
        if ((options.role ?? 'owner') !== 'owner')
          return json({ error: 'ROLE_FORBIDDEN' }, 403);
        tasks.delete(task);
        return json({ ok: true });
      }
      const archiving = /^\/api\/app\/tasks\/([^/]+)\/archive$/.exec(path)?.[1];
      if (request.method === 'POST' && archiving !== undefined) {
        tasks.delete(archiving);
        archived.add(archiving);
        return json({ ok: true });
      }
      if (route === 'GET /api/app/chat/composer/models')
        return json({ models: [{ id: 'gpt-x', providerSlug: 'mock' }] });
      if (route === 'POST /api/app/chat/threads')
        return json({ id: 'th1' }, 201);
      if (route === 'POST /api/app/chat/threads/th1/messages')
        return json({ status: 'completed', persisted: true });
      if (route === 'GET /api/app/chat/threads/th1/messages')
        return json({
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'Reply' }] },
            { role: 'assistant', parts: [{ type: 'text', text: 'ready' }] },
          ],
        });
      if (route === 'POST /api/app/chat/threads/th1/cancel') {
        cancelled = true;
        return json({ ok: true });
      }
      if (route === 'POST /api/app/chat/threads/th1/trash') {
        // Mid-turn the trash refuses; a cancelled turn settles after one
        // more refusal.
        if (trashRefusals > 0 || (options.turnStillRunning && !cancelled)) {
          if (cancelled) trashRefusals -= 1;
          return json({ ok: false });
        }
        trashed.add('th1');
        return json({ ok: true });
      }
      if (route === 'POST /api/auth/sign-out') {
        signedOut = true;
        return json({ success: true }, 200, {
          'set-cookie': `${SESSION}=; Path=/; Max-Age=0`,
        });
      }
      if (request.method === 'GET') return shell(base);
      return json({ error: 'not found' }, 404);
    },
  });
  servers.push(server);
  return {
    url: `http://127.0.0.1:${server.port}${base}`,
    seen,
    tasks,
    trashed,
    archived,
    cancelled: () => cancelled,
    signedOut: () => signedOut,
  };
}

function shell(base: string): Response {
  return new Response(
    `<!doctype html><html><head><script type="module" crossorigin src="${base}/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function smoke(url: string, extra: Partial<DeploymentSmokeOptions> = {}) {
  return runDeploymentSmoke({
    url,
    timeoutMs: 2_000,
    turnTimeoutMs: 2_000,
    ...extra,
  });
}

const account = { email: 'smoke@example.com', password: PASSWORD };

describe('the public probe', () => {
  test('passes a healthy deployment with reads only', async () => {
    const deployment = fakeDeployment();
    const report = await smoke(deployment.url, { expectedVersion: '1.2.3' });
    expect(report.passed).toBe(true);
    expect(report.mode).toBe('public');
    expect(report.version).toBe('1.2.3');
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ['health', 'pass'],
      ['ready', 'pass'],
      ['shell', 'pass'],
      ['anonymous-session', 'pass'],
      ['events-gate', 'pass'],
      ['api-gate', 'pass'],
    ]);
    expect(deployment.seen.every((r) => r.method === 'GET')).toBe(true);
    expect(deployment.seen.every((r) => r.cookie === null)).toBe(true);
  });

  test('fails when /events falls through to the web tier', async () => {
    const deployment = fakeDeployment({ eventsFallsThrough: true });
    const report = await smoke(deployment.url);
    expect(report.passed).toBe(false);
    const gate = report.checks.find((c) => c.name === 'events-gate');
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toBe('GET /events answered 200, expected 401.');
  });

  test('fails on another served version', async () => {
    const deployment = fakeDeployment({ version: '1.2.2' });
    const report = await smoke(deployment.url, { expectedVersion: '1.2.3' });
    expect(report.passed).toBe(false);
    expect(report.checks[0]?.detail).toBe(
      'The deployment serves 1.2.2, expected 1.2.3.',
    );
  });

  test('works under a subpath', async () => {
    const deployment = fakeDeployment({ basePath: '/tale' });
    const report = await smoke(`${deployment.url}/`);
    expect(report.passed).toBe(true);
    expect(report.url).toBe(deployment.url);
    expect(deployment.seen.every((r) => r.path.startsWith('/tale/'))).toBe(
      true,
    );
  });

  test('a response past the read bound fails its check', async () => {
    const deployment = fakeDeployment({ hugeReady: true });
    const report = await smoke(deployment.url);
    expect(report.checks.find((c) => c.name === 'ready')?.detail).toBe(
      'A response exceeded the 4 MiB read bound.',
    );
    expect(report.checks.find((c) => c.name === 'shell')?.status).toBe('pass');
  });

  test('reports an unreachable deployment instead of throwing', async () => {
    const report = await smoke('http://127.0.0.1:9', { timeoutMs: 500 });
    expect(report.passed).toBe(false);
    expect(report.checks.every((c) => c.status === 'fail')).toBe(true);
  });
});

describe('the full journey', () => {
  test('signs in, sees the task hint, cleans up and signs out', async () => {
    const deployment = fakeDeployment();
    const report = await smoke(deployment.url, { credentials: account });
    expect(report.passed).toBe(true);
    expect(report.mode).toBe('full');
    expect(report.checks.map((c) => c.name)).toEqual([
      'health',
      'ready',
      'shell',
      'anonymous-session',
      'events-gate',
      'api-gate',
      'sign-in',
      'organization',
      'events',
      'project',
      'task',
      'realtime',
      'cleanup-task',
      'sign-out',
    ]);
    expect(deployment.tasks.size).toBe(0);
    expect(deployment.signedOut()).toBe(true);
    const writes = deployment.seen.filter((r) => r.method !== 'GET');
    expect(writes.every((r) => r.origin !== null)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(JSON.stringify(report)).not.toContain('smoke@example.com');
  });

  test('runs one chat turn and trashes the conversation', async () => {
    const deployment = fakeDeployment();
    const report = await smoke(deployment.url, {
      credentials: account,
      chat: true,
    });
    expect(report.passed).toBe(true);
    const chat = report.checks.find((c) => c.name === 'chat');
    expect(chat?.detail).toBe('mock/gpt-x replied');
    expect(deployment.trashed.has('th1')).toBe(true);
  });

  test('keeps one named project when the account has none', async () => {
    const deployment = fakeDeployment({ projects: [] });
    const first = await smoke(deployment.url, { credentials: account });
    expect(first.checks.find((c) => c.name === 'project')?.detail).toBe(
      'created the project "Tale deployment smoke" for later runs',
    );
    const second = await smoke(deployment.url, { credentials: account });
    expect(second.checks.find((c) => c.name === 'project')?.detail).toBe(
      'project Tale deployment smoke',
    );
    expect(
      deployment.seen.filter(
        (r) => r.method === 'POST' && r.path === '/api/app/projects',
      ),
    ).toHaveLength(1);
  });

  test('a missing hint fails the run but still deletes the task', async () => {
    const deployment = fakeDeployment({ silentHints: true });
    const report = await smoke(deployment.url, {
      credentials: account,
      timeoutMs: 300,
    });
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'realtime')?.status).toBe(
      'fail',
    );
    expect(deployment.tasks.size).toBe(0);
    expect(deployment.signedOut()).toBe(true);
  });

  test('a refused sign-in skips the journey and signs nothing out', async () => {
    const deployment = fakeDeployment();
    const report = await smoke(deployment.url, {
      credentials: { ...account, password: 'wrong' },
    });
    expect(report.passed).toBe(false);
    expect(
      report.checks.slice(6).map((c) => [c.name, c.status, c.detail]),
    ).toEqual([
      ['sign-in', 'fail', 'The smoke account was refused sign-in.'],
      ['organization', 'skip', 'Needs a signed-in session.'],
      ['events', 'skip', 'Needs a signed-in session.'],
      ['project', 'skip', 'Needs a signed-in session.'],
      ['task', 'skip', 'Needs a signed-in session.'],
      ['realtime', 'skip', 'Needs a signed-in session.'],
    ]);
    expect(deployment.seen.some((r) => r.path === '/api/auth/sign-out')).toBe(
      false,
    );
  });

  test('an unknown organization stops before any write', async () => {
    const deployment = fakeDeployment();
    const report = await smoke(deployment.url, {
      credentials: account,
      organization: 'elsewhere',
    });
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'organization')?.detail).toBe(
      'The smoke account is not a member of "elsewhere".',
    );
    expect(
      deployment.seen.some(
        (r) => r.method === 'POST' && r.path.startsWith('/api/app/'),
      ),
    ).toBe(false);
    expect(deployment.signedOut()).toBe(true);
  });
});

describe('cleanup the account is allowed', () => {
  test('a member account archives the task it may not delete', async () => {
    const deployment = fakeDeployment({ role: 'member' });
    const report = await smoke(deployment.url, { credentials: account });
    expect(report.passed).toBe(true);
    expect(report.checks.find((c) => c.name === 'cleanup-task')?.detail).toBe(
      'the smoke task is archived (the account may not delete tasks)',
    );
    expect(deployment.tasks.size).toBe(0);
    expect(deployment.archived.size).toBe(1);
  });

  test('a turn still generating is stopped, then trashed', async () => {
    const deployment = fakeDeployment({ turnStillRunning: true });
    const report = await smoke(deployment.url, {
      credentials: account,
      chat: true,
    });
    expect(
      report.checks.find((c) => c.name === 'cleanup-thread'),
    ).toMatchObject({
      status: 'pass',
      detail: 'the smoke conversation was stopped and is in the trash',
    });
    expect(deployment.cancelled()).toBe(true);
    expect(deployment.trashed.has('th1')).toBe(true);
  });

  test('a sign-in whose check failed still signs its cookie out', async () => {
    const deployment = fakeDeployment({ sessionCheckFails: true });
    const report = await smoke(deployment.url, { credentials: account });
    expect(report.checks.find((c) => c.name === 'sign-in')?.status).toBe(
      'fail',
    );
    expect(deployment.signedOut()).toBe(true);
  });
});

describe('inputs', () => {
  test('a URL must be https, or http on a loopback name', () => {
    expect(smokeTarget('https://tale.example.com/')).toEqual({
      origin: 'https://tale.example.com',
      basePath: '',
    });
    expect(smokeTarget('http://localhost:3000/tale/')).toEqual({
      origin: 'http://localhost:3000',
      basePath: '/tale',
    });
    expect(() => smokeTarget('http://tale.example.com')).toThrow(SmokeFailure);
    expect(() => smokeTarget('https://a:b@tale.example.com')).toThrow(
      'The URL must not carry credentials.',
    );
    expect(() => smokeTarget('https://tale.example.com/?x=1')).toThrow(
      'The URL must not carry a query or fragment.',
    );
    expect(() => smokeTarget('tale.example.com')).toThrow('is not a URL');
  });

  test('the shell script is the first module script', () => {
    expect(
      shellScript(
        '<script src="/legacy.js"></script><script type="module" crossorigin src="/assets/a.js"></script>',
      ),
    ).toBe('/assets/a.js');
    expect(shellScript('<script>inline()</script>')).toBeNull();
  });
});
