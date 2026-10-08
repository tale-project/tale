// Smoke tests for the HTTP entrypoint's contracts.
//
// Importing the router does not start a listener or contact Docker/Kubernetes.
// Exercise the actual route dispatch plus HMAC and fail-closed configuration.

import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_MS,
  sign,
  verify,
} from './auth.ts';
import { DockerBackend } from './backend/docker/docker-backend.ts';
import { loadConfig } from './config.ts';
import { ControlRoutes } from './control-routes.ts';
import { ImageWarmup } from './image-warmup.ts';
import { BootAdoption } from './session/boot-adoption.ts';
import { SessionRoutes } from './session/session-routes.ts';

test('device spawners observe local resource pressure while preserving their configured slot count', async () => {
  const source = import.meta.dir;
  const script = `
    import {mock} from 'bun:test';
    const source = ${JSON.stringify(source)};
    const memory = await import(source + '/host-memory.ts');
    const disk = await import(source + '/host-disk.ts');
    let memories = 0, disks = 0;
    mock.module(source + '/host-memory.ts', () => ({...memory, HostMemoryProbe: class extends memory.HostMemoryProbe {constructor(...args) {super(...args); memories++;}}}));
    mock.module(source + '/host-disk.ts', () => ({...disk, HostDiskProbe: class extends disk.HostDiskProbe {constructor(...args) {super(...args); disks++;}}}));
    process.env.SANDBOX_TOKEN = 'device-resource-test';
    process.env.SANDBOX_DEVICE_CONFIG = '/unused-device-config';
    process.env.SANDBOX_MAX_SESSIONS = '3';
    process.env.SANDBOX_BACKEND = 'docker';
    const {router} = await import(source + '/server.ts');
    const {sign, NONCE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER} = await import(source + '/auth.ts');
    const timestamp = String(Date.now()), nonce = crypto.randomUUID();
    const response = await router(new Request('http://sandbox/v1/limits', {headers:{[SIGNATURE_HEADER]:sign('GET','/v1/limits',timestamp,'','device-resource-test',nonce),[TIMESTAMP_HEADER]:timestamp,[NONCE_HEADER]:nonce}}));
    console.log(JSON.stringify({memories,disks,limits:await response.json()}));
  `;
  const child = Bun.spawn([process.execPath, '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
  expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
    memories: 1,
    disks: 1,
    limits: { maxSessions: 3 },
  });
});

describe('session HTTP routes', () => {
  let router: typeof import('./server.ts').router;

  beforeAll(async () => {
    const previous = process.env.SANDBOX_TOKEN;
    process.env.SANDBOX_TOKEN = 'route-test-secret';
    try {
      ({ router } = await import('./server.ts'));
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_TOKEN;
      else process.env.SANDBOX_TOKEN = previous;
    }
  });

  test('retired viewer and one-shot routes return 404', async () => {
    for (const [method, path] of [
      ['GET', '/v1/sessions/sess1/screencast'],
      ['POST', '/v1/sessions/sess1/browser/restart'],
      ['POST', '/v1/sessions/sess1/browser/reset'],
      ['POST', '/v1/sessions/sess1/browser/close-pages'],
      ['POST', '/v1/execute'],
      ['POST', '/v1/cancel/exec1'],
    ]) {
      const response = await router(
        new Request(`http://sandbox${path}`, { method }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
  });

  test('image warmup queues only new local sessions while existing sessions remain addressable', async () => {
    const pending = spyOn(ImageWarmup.prototype, 'pending').mockReturnValue(
      true,
    );
    const create = spyOn(
      SessionRoutes.prototype,
      'handleCreate',
    ).mockImplementation(async () => Response.json({}));
    const get = spyOn(SessionRoutes.prototype, 'handleGet').mockImplementation(
      async () => Response.json({ session: { sessionId: 'existing' } }),
    );
    const request = (method: string, path: string, body = '') => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      return router(
        new Request(`http://sandbox${path}`, {
          method,
          headers: {
            [SIGNATURE_HEADER]: sign(
              method,
              path,
              timestamp,
              body,
              'route-test-secret',
              nonce,
            ),
            [TIMESTAMP_HEADER]: timestamp,
            [NONCE_HEADER]: nonce,
          },
          ...(body ? { body } : {}),
        }),
      );
    };
    try {
      const warming = await request('POST', '/v1/sessions', '{}');
      expect(warming.status).toBe(429);
      expect(warming.headers.get('retry-after')).toBe('5');
      expect(await warming.json()).toMatchObject({ error: 'runtime_image' });
      expect(create).not.toHaveBeenCalled();
      expect((await request('GET', '/v1/sessions/existing')).status).toBe(200);
      expect((await request('GET', '/v1/limits')).status).toBe(200);
      expect(get).toHaveBeenCalledWith('existing');
      pending.mockReturnValue(false);
      expect((await request('POST', '/v1/sessions', '{}')).status).toBe(200);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      pending.mockRestore();
      create.mockRestore();
      get.mockRestore();
    }
  });

  test('a create that failed on a missing image waits like the creates after it', async () => {
    // The backend heard the image was gone and restarted the warmup before
    // its 502 came back: that create gets the retryable wait, not a failure.
    const pending = spyOn(ImageWarmup.prototype, 'pending')
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const create = spyOn(
      SessionRoutes.prototype,
      'handleCreate',
    ).mockImplementation(async () =>
      Response.json({ error: 'create_failed' }, { status: 502 }),
    );
    const post = () => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      return router(
        new Request('http://sandbox/v1/sessions', {
          method: 'POST',
          body: '{}',
          headers: {
            [SIGNATURE_HEADER]: sign(
              'POST',
              '/v1/sessions',
              timestamp,
              '{}',
              'route-test-secret',
              nonce,
            ),
            [TIMESTAMP_HEADER]: timestamp,
            [NONCE_HEADER]: nonce,
          },
        }),
      );
    };
    try {
      const waiting = await post();
      expect(waiting.status).toBe(429);
      expect(await waiting.json()).toMatchObject({ error: 'runtime_image' });
      expect(create).toHaveBeenCalledTimes(1);
      // Any other failure stands.
      pending.mockReturnValue(false);
      expect((await post()).status).toBe(502);
    } finally {
      pending.mockRestore();
      create.mockRestore();
    }
  });

  test('health reports where the runtime image stands without failing on it', async () => {
    const health = spyOn(DockerBackend.prototype, 'health').mockResolvedValue({
      ok: true,
      detail: '27.0.0',
    });
    try {
      const response = await router(new Request('http://sandbox/health'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'ok',
        runtimeImage: { state: expect.any(String), lastError: null },
      });
    } finally {
      health.mockRestore();
    }
  });

  test('while boot adoption runs, calls that depend on it answer 503 session_unavailable, never 404', async () => {
    const adopting = spyOn(BootAdoption.prototype, 'pending').mockReturnValue(
      true,
    );
    const get = spyOn(SessionRoutes.prototype, 'handleGet').mockImplementation(
      async () => Response.json({ session: { sessionId: 'existing' } }),
    );
    const attach = spyOn(
      SessionRoutes.prototype,
      'handleExecAttach',
    ).mockImplementation(async () => new Response(''));
    // The deploy control routes answer from a stub, so a drain reached after
    // adoption does not latch this module's spawner into draining.
    const isDeployControl = (url: URL) =>
      url.pathname === '/v1/drain' || url.pathname === '/v1/drain-status';
    const control = spyOn(ControlRoutes.prototype, 'handle').mockImplementation(
      async (_req, url) =>
        isDeployControl(url) ? Response.json({ draining: true }) : null,
    );
    const request = (method: string, path: string) => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      return router(
        new Request(`http://sandbox${path}`, {
          method,
          headers: {
            [SIGNATURE_HEADER]: sign(
              method,
              path,
              timestamp,
              '',
              'route-test-secret',
              nonce,
            ),
            [TIMESTAMP_HEADER]: timestamp,
            [NONCE_HEADER]: nonce,
          },
        }),
      );
    };
    try {
      for (const [method, path] of [
        ['GET', '/v1/sessions/existing'],
        ['GET', '/v1/sessions/existing/exec/exec1/attach?sinceSeq=4'],
        ['GET', '/v1/sessions/existing/exec/exec1/checkpoint'],
        ['GET', '/v1/sessions/existing/exec/exec1'],
        ['POST', '/v1/sessions/existing/acquire'],
        ['POST', '/v1/sessions'],
        ['GET', '/v1/workspaces'],
        ['GET', '/v1/capacity?organizationId=org-a'],
        ['DELETE', '/v1/organizations/org-a'],
        ['POST', '/v1/devices/device-1/disconnect'],
        ['POST', '/v1/drain'],
        ['GET', '/v1/drain-status'],
      ] as const) {
        const answer = await request(method, path);
        expect({ method, path, status: answer.status }).toEqual({
          method,
          path,
          status: 503,
        });
        expect(answer.headers.get('retry-after')).toBe('1');
        expect(await answer.json()).toEqual({ error: 'session_unavailable' });
      }
      expect(get).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(control.mock.calls.some(([, url]) => isDeployControl(url))).toBe(
        false,
      );
      // Health reads not ready, without probing the backend, so probes keep
      // routing to whatever served before; the deployment's limits and an
      // unknown path answer as ever.
      const health = await router(new Request('http://sandbox/health'));
      expect(health.status).toBe(503);
      expect(await health.json()).toEqual({ status: 'starting' });
      expect((await request('GET', '/v1/limits')).status).toBe(200);
      expect(
        (await request('GET', '/v1/sessions/existing/screencast')).status,
      ).toBe(404);

      adopting.mockReturnValue(false);
      expect((await request('GET', '/v1/sessions/existing')).status).toBe(200);
      expect(
        (await request('GET', '/v1/sessions/existing/exec/exec1/attach'))
          .status,
      ).toBe(200);
      expect(get).toHaveBeenCalledWith('existing');
      expect((await request('POST', '/v1/drain')).status).toBe(200);
      expect((await request('GET', '/v1/drain-status')).status).toBe(200);
    } finally {
      adopting.mockRestore();
      get.mockRestore();
      attach.mockRestore();
      control.mockRestore();
    }
  });

  test('boot adoption is pending from its start to its end', () => {
    const adoption = new BootAdoption();
    expect(adoption.pending()).toBe(false);
    adoption.begin();
    expect(adoption.pending()).toBe(true);
    adoption.end();
    expect(adoption.pending()).toBe(false);
  });

  test('exec status forwards the incoming recovery cancellation signal', async () => {
    const status = spyOn(
      SessionRoutes.prototype,
      'handleExecStatus',
    ).mockImplementation(async () => Response.json({ state: 'running' }));
    const path = '/v1/sessions/sess1/exec/exec1';
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const abort = new AbortController();
    const request = new Request(`http://sandbox${path}`, {
      signal: abort.signal,
      headers: {
        [SIGNATURE_HEADER]: sign(
          'GET',
          path,
          timestamp,
          '',
          'route-test-secret',
          nonce,
        ),
        [TIMESTAMP_HEADER]: timestamp,
        [NONCE_HEADER]: nonce,
      },
    });
    try {
      expect((await router(request)).status).toBe(200);
      expect(status).toHaveBeenCalledWith('sess1', 'exec1', request.signal);
    } finally {
      status.mockRestore();
    }
  });

  test('staging forwards the incoming cancellation signal', async () => {
    const stage = spyOn(
      SessionRoutes.prototype,
      'handleFilesStage',
    ).mockImplementation(async () =>
      Response.json({ staged: [], skipped: [] }),
    );
    const path = '/v1/sessions/sess1/files/stage';
    const body = JSON.stringify({ files: [] });
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const abort = new AbortController();
    const request = new Request(`http://sandbox${path}`, {
      method: 'POST',
      body,
      signal: abort.signal,
      headers: {
        [SIGNATURE_HEADER]: sign(
          'POST',
          path,
          timestamp,
          body,
          'route-test-secret',
          nonce,
        ),
        [TIMESTAMP_HEADER]: timestamp,
        [NONCE_HEADER]: nonce,
      },
    });
    try {
      expect((await router(request)).status).toBe(200);
      expect(stage).toHaveBeenCalledWith('sess1', body, request.signal);
    } finally {
      stage.mockRestore();
    }
  });

  test('an exec cancel passes leftovers=keep on, and only that', async () => {
    const cancel = spyOn(
      SessionRoutes.prototype,
      'handleExecCancel',
    ).mockImplementation(async () => Response.json({ killed: true }));
    try {
      for (const query of ['?leftovers=keep', '', '?leftovers=all']) {
        const path = `/v1/sessions/sess1/exec/exec1/cancel${query}`;
        const timestamp = String(Date.now());
        const nonce = crypto.randomUUID();
        const response = await router(
          new Request(`http://sandbox${path}`, {
            method: 'POST',
            headers: {
              [SIGNATURE_HEADER]: sign(
                'POST',
                path,
                timestamp,
                '',
                'route-test-secret',
                nonce,
              ),
              [TIMESTAMP_HEADER]: timestamp,
              [NONCE_HEADER]: nonce,
            },
          }),
        );
        expect(response.status).toBe(200);
      }
      expect(cancel.mock.calls).toEqual([
        ['sess1', 'exec1', { keepLeftovers: true }],
        ['sess1', 'exec1', { keepLeftovers: false }],
        ['sess1', 'exec1', { keepLeftovers: false }],
      ]);
    } finally {
      cancel.mockRestore();
    }
  });

  test('a destroy passes keep_workspace=1 on, and only that', async () => {
    const destroy = spyOn(
      SessionRoutes.prototype,
      'handleDestroy',
    ).mockImplementation(async () =>
      Response.json({ stopped: true, busy: false, workspaceKept: true }),
    );
    try {
      for (const query of ['?if_idle=1&keep_workspace=1', '?if_idle=1']) {
        const path = `/v1/sessions/sess1${query}`;
        const timestamp = String(Date.now());
        const nonce = crypto.randomUUID();
        const response = await router(
          new Request(`http://sandbox${path}`, {
            method: 'DELETE',
            headers: {
              [SIGNATURE_HEADER]: sign(
                'DELETE',
                path,
                timestamp,
                '',
                'route-test-secret',
                nonce,
              ),
              [TIMESTAMP_HEADER]: timestamp,
              [NONCE_HEADER]: nonce,
            },
          }),
        );
        expect(response.status).toBe(200);
      }
      expect(destroy.mock.calls).toEqual([
        [
          'sess1',
          {
            ifIdle: true,
            ifStopped: false,
            awaitDeletion: false,
            keepWorkspace: true,
          },
        ],
        [
          'sess1',
          {
            ifIdle: true,
            ifStopped: false,
            awaitDeletion: false,
            keepWorkspace: false,
          },
        ],
      ]);
    } finally {
      destroy.mockRestore();
    }
  });

  test('checkpoint GET and PUT pass the authenticated router with a bounded body', async () => {
    const checkpoint = spyOn(
      SessionRoutes.prototype,
      'handleExecCheckpoint',
    ).mockImplementation(async () => Response.json({ checkpoint: null }));
    const path = '/v1/sessions/sess1/exec/exec1/checkpoint';
    try {
      for (const method of ['GET', 'PUT']) {
        expect(
          (await router(new Request(`http://sandbox${path}`, { method })))
            .status,
        ).toBe(401);
        const body =
          method === 'PUT'
            ? JSON.stringify({ seq: 10, state: 'x'.repeat(300_000) })
            : '';
        const timestamp = String(Date.now());
        const nonce = crypto.randomUUID();
        const response = await router(
          new Request(`http://sandbox${path}`, {
            method,
            ...(method === 'PUT' ? { body } : {}),
            headers: {
              [SIGNATURE_HEADER]: sign(
                method,
                path,
                timestamp,
                body,
                'route-test-secret',
                nonce,
              ),
              [TIMESTAMP_HEADER]: timestamp,
              [NONCE_HEADER]: nonce,
            },
          }),
        );
        expect(response.status).toBe(200);
        expect(checkpoint.mock.calls.at(-1)?.slice(1)).toEqual([
          'sess1',
          'exec1',
          body,
        ]);
      }
      expect(
        (
          await router(
            new Request(`http://sandbox${path}`, {
              method: 'PUT',
              body: 'x'.repeat(1024 * 1024 + 1),
            }),
          )
        ).status,
      ).toBe(413);
      expect(checkpoint).toHaveBeenCalledTimes(2);
    } finally {
      checkpoint.mockRestore();
    }
  });

  test('the session exec route remains authenticated', async () => {
    const response = await router(
      new Request('http://sandbox/v1/sessions/sess1/exec', {
        method: 'POST',
        body: JSON.stringify({ execId: 'exec1', command: ['true'] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test('release tickets and allocation lifecycle changes require signatures', async () => {
    for (const [method, path] of [
      ['GET', '/v1/sessions/test/release'],
      ['POST', '/v1/sessions/test/release'],
      ['POST', '/v1/sessions/test/acquire'],
    ]) {
      expect(
        (await router(new Request(`http://sandbox${path}`, { method }))).status,
      ).toBe(401);
    }
  });

  test('capacity requires authentication and binds the organization query', async () => {
    const path = '/v1/capacity?organizationId=org-a';
    expect((await router(new Request(`http://sandbox${path}`))).status).toBe(
      401,
    );
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const response = await router(
      new Request('http://sandbox/v1/capacity?organizationId=org-b', {
        headers: {
          [SIGNATURE_HEADER]: sign(
            'GET',
            path,
            timestamp,
            '',
            'route-test-secret',
            nonce,
          ),
          [TIMESTAMP_HEADER]: timestamp,
          [NONCE_HEADER]: nonce,
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  test('signed limits read the deployment config without observing the host', async () => {
    const path = '/v1/limits';
    expect((await router(new Request(`http://sandbox${path}`))).status).toBe(
      401,
    );
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const response = await router(
      new Request(`http://sandbox${path}`, {
        headers: {
          [SIGNATURE_HEADER]: sign(
            'GET',
            path,
            timestamp,
            '',
            'route-test-secret',
            nonce,
          ),
          [TIMESTAMP_HEADER]: timestamp,
          [NONCE_HEADER]: nonce,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ maxSessions: 8 });
  });

  test('capacity rejects missing or invalid organization ids before observing the host', async () => {
    for (const path of [
      '/v1/capacity',
      '/v1/capacity?organizationId=bad%2Forg',
    ]) {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const response = await router(
        new Request(`http://sandbox${path}`, {
          headers: {
            [SIGNATURE_HEADER]: sign(
              'GET',
              path,
              timestamp,
              '',
              'route-test-secret',
              nonce,
            ),
            [TIMESTAMP_HEADER]: timestamp,
            [NONCE_HEADER]: nonce,
          },
        }),
      );
      expect(response.status).toBe(400);
    }
  });
});

describe('loadConfig token policy (fail-closed)', () => {
  // The spawner holds the host docker socket and is reachable from every
  // session container on the shared sandbox network, so it must never boot
  // with HMAC verification off. An unset / blank SANDBOX_TOKEN refuses boot
  // instead of silently turning `authorize()` into a no-op (the audit finding
  // that left every compose stack without a token running the spawner open).
  const prev = process.env.SANDBOX_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_TOKEN;
    else process.env.SANDBOX_TOKEN = prev;
  });

  test('refuses to boot when SANDBOX_TOKEN is unset', () => {
    delete process.env.SANDBOX_TOKEN;
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('treats an empty-string SANDBOX_TOKEN as unset (refuses to boot)', () => {
    process.env.SANDBOX_TOKEN = '';
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('treats a whitespace-only SANDBOX_TOKEN as unset (refuses to boot)', () => {
    // Otherwise it would silently enable HMAC with a trivially weak space key.
    process.env.SANDBOX_TOKEN = '   ';
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('trims a padded token so the key matches what the clients sign with', () => {
    process.env.SANDBOX_TOKEN = '  shared-secret  ';
    expect(loadConfig().sandboxToken).toBe('shared-secret');
  });
});

describe('HMAC verify (method+path+ts+body binding)', () => {
  const token = 'shared-secret';
  const body = JSON.stringify({ execId: 'abc', command: ['true'] });
  const method = 'POST';
  const path = '/v1/sessions/sess1/exec';
  const now = 1_700_000_000_000;
  const ts = String(now);

  test('accepts a correctly-signed request', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, ts, null, token, now)).toEqual({
      ok: true,
    });
  });

  test('rejects a wrong signature', () => {
    const sig = sign(method, path, ts, body, 'other-secret');
    expect(verify(method, path, body, sig, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a tampered body', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, `${body} `, sig, ts, null, token, now)).toEqual(
      {
        ok: false,
        reason: 'bad_signature',
      },
    );
  });

  test('rejects a captured signature replayed against a different path', () => {
    // The whole point of binding the path: a leaked session exec signature
    // must not authenticate another session or operation.
    const sig = sign(method, '/v1/sessions/sess1/exec', ts, body, token);
    expect(
      verify(
        method,
        '/v1/sessions/other/exec',
        body,
        sig,
        ts,
        null,
        token,
        now,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('rejects a captured signature replayed with a different method', () => {
    const sig = sign('POST', path, ts, body, token);
    expect(verify('GET', path, body, sig, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a missing signature header', () => {
    expect(verify(method, path, body, null, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('rejects a missing timestamp header', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, null, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_timestamp',
    });
  });

  test('rejects timestamps outside the tolerance window', () => {
    const sig = sign(method, path, ts, body, token);
    const tooLate = now + TIMESTAMP_TOLERANCE_MS + 1;
    expect(verify(method, path, body, sig, ts, null, token, tooLate)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
    const tooEarly = now - TIMESTAMP_TOLERANCE_MS - 1;
    expect(verify(method, path, body, sig, ts, null, token, tooEarly)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
  });

  test('rejects a non-numeric timestamp', () => {
    const sig = sign(method, path, ts, body, token);
    expect(
      verify(method, path, body, sig, 'not-a-number', null, token, now),
    ).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  test('rejects a signature of the wrong length (timing-safe length check)', () => {
    const sig = sign(method, path, ts, body, token);
    expect(
      verify(method, path, body, sig.slice(0, -1), ts, null, token, now),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(
      verify(method, path, body, `${sig}aa`, ts, null, token, now),
    ).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('exports stable header names (wire contract)', () => {
    expect(SIGNATURE_HEADER).toBe('x-tale-sandbox-signature');
    expect(TIMESTAMP_HEADER).toBe('x-tale-sandbox-timestamp');
  });
});
