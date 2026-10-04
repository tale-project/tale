// Drive runnerd over HTTP without Docker: the retired viewing surface must be
// gone while ordinary command execution still streams stdout and exit status.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';

import { InnerDockerHealth } from './inner-docker-health.ts';

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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

async function currentActiveOperations(): Promise<number> {
  const health = record(
    await (await fetch(`${baseUrl}/healthz`, { headers })).json(),
  );
  return Number(record(health.activity).activeOperations);
}

describe('runnerd HTTP service', () => {
  test('a failed Docker capability blocks readiness and new execs without hiding live process state', async () => {
    const snapshot = spyOn(
      InnerDockerHealth.prototype,
      'snapshot',
    ).mockResolvedValue({ dockerReady: false });
    try {
      const ready = await fetch(`${baseUrl}/readyz`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ ok: false });
      const health = await fetch(`${baseUrl}/healthz`, { headers });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        dockerReady: false,
        liveExecs: 0,
      });
      const acquire = await fetch(`${baseUrl}/acquire`, {
        method: 'POST',
        headers,
      });
      expect(acquire.status).toBe(503);
      expect(await acquire.json()).toEqual({ error: 'docker_unavailable' });
      const exec = await fetch(`${baseUrl}/execs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          execId: 'docker-down',
          command: ['/bin/echo', 'must not run'],
        }),
      });
      expect(exec.status).toBe(503);
      expect(await exec.json()).toEqual({ error: 'docker_unavailable' });
      expect(await currentActiveOperations()).toBe(0);
    } finally {
      snapshot.mockRestore();
    }
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);
  });

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
        idleReclaim: true,
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

  test('disconnecting a staging caller cancels its upstream and releases activity', async () => {
    const fetched = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    const source = createServer((_req, res) => {
      res.write('partial');
      fetched.resolve();
      res.once('close', () => disconnected.resolve());
    });
    await new Promise<void>((resolve) =>
      source.listen(0, '127.0.0.1', resolve),
    );
    const address = source.address();
    if (address === null || typeof address === 'string')
      throw new Error('no port');
    const controller = new AbortController();
    writeFileSync(`${workspace}/aborted-stage.txt`, 'previous');
    const staging = fetch(`${baseUrl}/files/stage`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        files: [
          {
            path: 'aborted-stage.txt',
            url: `http://127.0.0.1:${address.port}`,
          },
        ],
      }),
    }).catch(() => null);
    try {
      await fetched.promise;
      controller.abort();
      await staging;
      await disconnected.promise;
      let active = -1;
      const deadline = Date.now() + 5_000;
      while (active !== 0 && Date.now() < deadline) {
        active = await currentActiveOperations();
        if (active !== 0)
          await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(active).toBe(0);
      expect(readFileSync(`${workspace}/aborted-stage.txt`, 'utf8')).toBe(
        'previous',
      );
      expect(
        (
          await activityPost('/files/stage', {
            files: [{ path: 'after-abort.txt', contentBase64: 'b2s=' }],
          })
        ).value,
      ).toEqual({
        staged: [{ path: 'after-abort.txt', bytes: 2 }],
        skipped: [],
      });
    } finally {
      controller.abort();
      await staging;
      await new Promise<void>((resolve, reject) => {
        source.close((error) => (error ? reject(error) : resolve()));
        source.closeAllConnections();
      });
    }
  });

  test('exec and attach share a consumer cap that releases on refusal and disconnect', async () => {
    const malformed = await fetch(`${baseUrl}/execs`, {
      method: 'POST',
      headers,
      body: '{',
    });
    expect(malformed.status).toBe(400);
    await malformed.text();
    const missing = await fetch(`${baseUrl}/execs/no-such-exec/attach`, {
      headers,
    });
    expect(missing.status).toBe(404);
    await missing.text();
    const controller = new AbortController();
    const streams: Response[] = [];
    try {
      streams.push(
        await fetch(`${baseUrl}/execs`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            execId: 'consumer-cap',
            shell: 'exec sleep 30',
            cwd: workspace,
            timeoutMs: 30_000,
            stdoutMaxBytes: 0,
            stderrMaxBytes: 0,
          }),
        }),
      );
      for (let index = 0; index < 7; index += 1) {
        const response = await fetch(`${baseUrl}/execs/consumer-cap/attach`, {
          headers,
          signal: controller.signal,
        });
        expect(response.status).toBe(200);
        streams.push(response);
      }
      for (const path of ['/execs/consumer-cap/attach', '/execs']) {
        const overflow = await fetch(`${baseUrl}${path}`, {
          headers,
          ...(path === '/execs' ? { method: 'POST', body: '{}' } : {}),
        });
        expect(overflow.status).toBe(503);
        expect(await overflow.json()).toEqual({ error: 'busy' });
      }
      await streams.pop()?.body?.cancel();
      const deadline = Date.now() + 5_000;
      while ((await currentActiveOperations()) >= 8 && Date.now() < deadline) {
        await new Promise((settle) => setTimeout(settle, 10));
      }
      const replacement = await fetch(`${baseUrl}/execs/consumer-cap/attach`, {
        headers,
        signal: controller.signal,
      });
      expect(replacement.status).toBe(200);
      streams.push(replacement);
    } finally {
      controller.abort();
      await Promise.allSettled(
        streams.map(async (response) => response.body?.cancel()),
      );
      await fetch(`${baseUrl}/execs/consumer-cap/cancel`, {
        method: 'POST',
        headers,
      });
    }
  });

  for (const mode of ['exec', 'attach'] as const) {
    test(`a stalled ${mode} consumer disconnects while its exec remains attachable`, async () => {
      const execId = `stalled-${mode}`;
      const path = mode === 'exec' ? '/execs' : `/execs/${execId}/attach`;
      let stalled: ServerResponse | undefined;
      let intake: IncomingMessage | undefined;
      const observe = (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === path) {
          stalled = res;
          intake = req;
        }
      };
      server.on('request', observe);
      const body = JSON.stringify({
        execId,
        // Release the output only after the slow consumer has received its
        // headers and paused. Keep the command live after its 32 MiB burst.
        shell: `echo $$ > ${execId}.pid; while [ ! -f ${execId}.emit ]; do sleep 0.02; done; head -c 33554432 /dev/zero; exec sleep 30`,
        cwd: workspace,
        timeoutMs: 30_000,
        stdoutMaxBytes: 0,
        stderrMaxBytes: 0,
      });
      const primaryReceived = Promise.withResolvers<void>();
      const primary = request(
        `${baseUrl}/execs`,
        { method: 'POST', headers },
        (response) => {
          response.on('error', () => {});
          if (mode === 'exec') response.pause();
          else response.resume();
          primaryReceived.resolve();
        },
      );
      primary.on('error', primaryReceived.reject);
      let attachment: ReturnType<typeof request> | undefined;
      let terminal: Promise<string> | undefined;
      try {
        primary.end(body);
        await primaryReceived.promise;
        if (mode === 'attach') {
          const received = Promise.withResolvers<void>();
          attachment = request(`${baseUrl}${path}`, { headers }, (response) => {
            response.on('error', () => {});
            response.pause();
            received.resolve();
          });
          attachment.on('error', received.reject);
          attachment.end();
          await received.promise;
        }
        expect(stalled).toBeDefined();
        // A running response must not keep the parsed upload buffered in
        // IncomingMessage listeners; detach also releases its abort hook.
        expect(intake?.listenerCount('data')).toBe(0);
        writeFileSync(`${workspace}/${execId}.emit`, 'go');
        await waitUntil(() => stalled?.destroyed === true);
        expect(intake?.listenerCount('aborted')).toBe(0);
        expect(stalled?.listenerCount('drain')).toBe(0);
        expect(
          await (await fetch(`${baseUrl}/execs/${execId}`, { headers })).json(),
        ).toMatchObject({ state: 'running' });
        expect(
          alive(Number(readFileSync(`${workspace}/${execId}.pid`, 'utf8'))),
        ).toBe(true);
        // The healthy primary in the attach case also leaves now, so no
        // disconnected consumer keeps an activity operation open.
        primary.destroy();
        const deadline = Date.now() + 5_000;
        while ((await currentActiveOperations()) > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(await currentActiveOperations()).toBe(0);
        const reattach = await fetch(`${baseUrl}/execs/${execId}/attach`, {
          headers,
        });
        expect(reattach.status).toBe(200);
        terminal = reattach.text();
        const cancel = await fetch(`${baseUrl}/execs/${execId}/cancel`, {
          method: 'POST',
          headers,
        });
        expect(await cancel.json()).toEqual({ killed: true });
        const stream = await terminal;
        expect(stream).toContain('"t":"stdout"');
        expect(stream).toContain('"t":"exit"');
        expect(stream).toContain('"timedOut":false');
        expect(stream).toContain('"cancelled":true');
      } finally {
        server.removeListener('request', observe);
        primary.destroy();
        attachment?.destroy();
        await fetch(`${baseUrl}/execs/${execId}/cancel`, {
          method: 'POST',
          headers,
        });
        await terminal;
      }
    }, 15_000);
  }

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
    for (const idleBeforeMs of [null, '0', -1, 1.5]) {
      expect(
        (
          await activityPost('/reclaim', {
            claimId: 'invalid-idle-cutoff',
            idleBeforeMs,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await activityPost('/reclaim', {
          claimId: 'stale-idle-cutoff',
          idleBeforeMs: 0,
        })
      ).value,
    ).toEqual({ claimed: false });
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
