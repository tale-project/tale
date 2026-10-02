// Drive runnerd over HTTP without Docker: the retired viewing surface must be
// gone while ordinary command execution still streams stdout and exit status.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';

const workspace = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-http-`));
const token = 'runnerd-http-test-token';
const previous = {
  workspace: process.env.TALE_WORKSPACE_ROOT,
  token: process.env.TALE_RUNNERD_TOKEN,
  browser: process.env.TALE_BROWSER_CDP,
};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.TALE_WORKSPACE_ROOT = workspace;
  process.env.TALE_RUNNERD_TOKEN = token;
  // An old deployment's leftover env cannot revive the retired stack.
  process.env.TALE_BROWSER_CDP = '1';
  ({ server } = await import('./main.ts'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('no HTTP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const [name, value] of [
    ['TALE_WORKSPACE_ROOT', previous.workspace],
    ['TALE_RUNNERD_TOKEN', previous.token],
    ['TALE_BROWSER_CDP', previous.browser],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(workspace, { recursive: true, force: true });
});

const headers = { 'x-tale-runnerd-token': token };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value))
    : {};
}

async function activityPost(path: string, body: object = {}) {
  const payload =
    path === '/reclaim' ? { ...(await releaseTicket()), ...body } : body;
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const value = record(await response.json());
  return { status: response.status, value };
}

async function releaseTicket(): Promise<Record<string, unknown>> {
  return record(await (await fetch(`${baseUrl}/release`, { headers })).json());
}

describe('runnerd HTTP service', () => {
  test('rejects unauthenticated execution', async () => {
    const response = await fetch(`${baseUrl}/execs`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  test('removed browser controls and viewing tunnel return 404', async () => {
    for (const [method, path] of [
      ['GET', '/screencast'],
      ['POST', '/browser/restart'],
      ['POST', '/browser/reset'],
      ['POST', '/browser/close-pages'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
  });

  test('health describes process activity without viewer state', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers });
    expect(await response.json()).toEqual({
      ok: true,
      bootedAtMs: expect.any(Number),
      lastActivityAtMs: expect.any(Number),
      liveExecs: 0,
      activity: {
        generation: expect.any(String),
        activeOperations: 0,
        released: false,
        pinned: false,
        reclaiming: false,
      },
    });
  });

  test('exec streams a real process without a managed-browser preflight', async () => {
    const response = await fetch(`${baseUrl}/execs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        execId: 'plain-command',
        command: ['/bin/sh', '-c', 'printf runnerd-ready'],
        cwd: workspace,
        timeoutMs: 5_000,
        stdoutMaxBytes: 10_000,
        stderrMaxBytes: 10_000,
      }),
    });
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('"t":"start"');
    expect(stream).toContain(Buffer.from('runnerd-ready').toString('base64'));
    expect(stream).toContain('"exitCode":0');
    const status = await fetch(`${baseUrl}/execs/plain-command`, { headers });
    expect(await status.json()).toEqual({
      execId: 'plain-command',
      state: 'exited',
      exitCode: 0,
    });
  });

  test('a partial exec request body already protects the runtime from release and reclaim', async () => {
    const completed = Promise.withResolvers<number>();
    const upload = request(
      `${baseUrl}/execs`,
      { method: 'POST', headers: { ...headers, 'content-length': '2' } },
      (response) => {
        response.resume();
        response.on('end', () => completed.resolve(response.statusCode ?? 0));
      },
    );
    upload.on('error', completed.reject);
    upload.write('{');
    let activeOperations = 0;
    for (
      let attempt = 0;
      attempt < 50 && activeOperations === 0;
      attempt += 1
    ) {
      const health = record(
        await (await fetch(`${baseUrl}/healthz`, { headers })).json(),
      );
      activeOperations = Number(record(health.activity).activeOperations);
      if (activeOperations === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    try {
      expect(activeOperations).toBe(1);
      expect(
        (await activityPost('/release', await releaseTicket())).value,
      ).toEqual({ released: false });
      expect(
        (await activityPost('/reclaim', { claimId: 'upload' })).value,
      ).toEqual({ claimed: false });
    } finally {
      upload.end('}');
    }
    expect(await completed.promise).toBe(200);
  });

  test('staging remains protected during its upstream fetch and preserves the resulting file', async () => {
    const fetched = Promise.withResolvers<void>();
    const complete = Promise.withResolvers<void>();
    const source = Bun.serve({
      port: 0,
      async fetch() {
        fetched.resolve();
        await complete.promise;
        return new Response('preserved');
      },
    });
    try {
      const staging = activityPost('/files/stage', {
        files: [
          { path: 'pressure.txt', url: `http://127.0.0.1:${source.port}` },
        ],
      });
      await fetched.promise;
      expect(
        (await activityPost('/release', await releaseTicket())).value,
      ).toEqual({ released: false });
      expect(
        (await activityPost('/reclaim', { claimId: 'staging' })).value,
      ).toEqual({ claimed: false });
      complete.resolve();
      expect((await staging).value).toEqual({
        staged: [{ path: 'pressure.txt', bytes: 9 }],
        skipped: [],
      });
      expect(
        await (
          await fetch(`${baseUrl}/fs/read?path=pressure.txt`, { headers })
        ).text(),
      ).toBe('preserved');
    } finally {
      complete.resolve();
      await source.stop(true);
    }
  });

  test.skipIf(!existsSync('/proc/self/environ'))(
    'a cancel with leftovers=keep leaves what the exec started outside its group to the next exec',
    async () => {
      const execBody = (execId: string, shell: string) =>
        JSON.stringify({
          execId,
          shell,
          cwd: workspace,
          timeoutMs: 30_000,
          stdoutMaxBytes: 10_000,
          stderrMaxBytes: 10_000,
        });
      const turn = fetch(`${baseUrl}/execs`, {
        method: 'POST',
        headers,
        body: execBody(
          'rotated-turn',
          'setsid /bin/sleep 408 >/dev/null 2>&1 </dev/null & sleep 0.2; pgrep -n -f "^/bin/sleep 408$" > server.pid; exec sleep 30',
        ),
      }).then((response) => response.text());
      let pid = 0;
      const started = Date.now();
      while (pid <= 1 && Date.now() - started < 5_000) {
        await new Promise((r) => setTimeout(r, 20));
        pid = existsSync(`${workspace}/server.pid`)
          ? Number(readFileSync(`${workspace}/server.pid`, 'utf8').trim())
          : 0;
      }
      expect(pid).toBeGreaterThan(1);
      const cancel = await fetch(
        `${baseUrl}/execs/rotated-turn/cancel?leftovers=keep`,
        { method: 'POST', headers },
      );
      expect(await cancel.json()).toEqual({ killed: true });
      expect(await turn).toContain('"cancelled":true');
      await new Promise((r) => setTimeout(r, 300));
      expect(alive(pid)).toBe(true);
      const next = await fetch(`${baseUrl}/execs`, {
        method: 'POST',
        headers,
        body: execBody('next-turn', 'true'),
      });
      expect(await next.text()).toContain('"exitCode":0');
      const until = Date.now() + 3_000;
      while (alive(pid) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(alive(pid)).toBe(false);
    },
  );

  // KEEP LAST: the claim below freezes the one daemon this file shares —
  // by design a successful claim never expires — so every request a later
  // test would make answers 503 `reclaiming`.
  test('a released runtime is atomically frozen before a pressure stop and refuses competing work', async () => {
    const stale = await releaseTicket();
    expect((await activityPost('/acquire')).status).toBe(200);
    expect((await activityPost('/release', stale)).value).toEqual({
      released: false,
    });
    const current = await releaseTicket();
    expect((await activityPost('/release', current)).value).toEqual({
      released: true,
    });
    expect((await activityPost('/pin', { pinned: true })).status).toBe(200);
    expect(
      (await activityPost('/reclaim', { claimId: 'pressure' })).value,
    ).toEqual({ claimed: false });
    expect((await activityPost('/pin', { pinned: false })).status).toBe(200);
    expect(
      (await activityPost('/reclaim', { claimId: 'pressure' })).value,
    ).toEqual({ claimed: true });
    expect((await activityPost('/reclaim', { claimId: 'peer' })).value).toEqual(
      { claimed: true },
    );
    for (const [path, body] of [
      ['/acquire', {}],
      ['/pin', { pinned: true }],
      ['/env', { set: { NEXT: '1' } }],
      ['/files/stage', { files: [] }],
      ['/execs', { execId: 'too-late', command: ['true'] }],
    ] as const) {
      expect((await activityPost(path, body)).status).toBe(503);
    }
    expect(
      (await fetch(`${baseUrl}/fs/read?path=pressure.txt`, { headers })).status,
    ).toBe(503);
  });
});
