// The Incus client's wire contract: how a call is shaped, how an answer is
// read, how long anything may take, and — against a real TLS server — what
// the pinned mutual-TLS connection accepts and refuses.

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createServer, type Server } from 'node:net';

import { withOperationBudget } from '../../operation-budget.ts';
import { IncusApiError, incusStatus } from './incus-api.ts';
import {
  IncusClient,
  isIncusImageMissing,
  type IncusFetch,
  type IncusRequestInit,
  type IncusTlsMaterial,
} from './incus-client.ts';
import {
  makeTestCertificates,
  type TestCertificates,
} from './test-certificates.ts';

const TLS: IncusTlsMaterial = { ca: 'ca', cert: 'cert', key: 'key' };

interface Seen {
  url: URL;
  init: IncusRequestInit;
}

type Answer = Response | Error | ((seen: Seen) => Response | Promise<Response>);

/** A client whose answers are scripted in order; `seen` records the calls. */
function scripted(answers: Answer[], options: { timeoutMs?: number } = {}) {
  const seen: Seen[] = [];
  const queue = [...answers];
  const fetchStub: IncusFetch = async (url, init) => {
    const entry = { url: new URL(url), init };
    seen.push(entry);
    const next = queue.shift();
    if (next === undefined)
      throw new Error(`unscripted call: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(entry) : next;
  };
  const client = new IncusClient({
    endpoint: 'https://incus.test:8443',
    project: 'sandbox-pr',
    tls: TLS,
    fetch: fetchStub,
    sleep: async () => undefined,
    ...(options.timeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.timeoutMs }),
  });
  return { client, seen };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sync(metadata: unknown, headers: Record<string, string> = {}) {
  return json(
    { type: 'sync', status: 'Success', status_code: 200, metadata },
    200,
    headers,
  );
}

function failure(status: number, message: string) {
  return json(
    { type: 'error', error: message, error_code: status, metadata: {} },
    status,
  );
}

function operation(id: string, statusCode: number, err = '') {
  return {
    id,
    status:
      statusCode === 200
        ? 'Success'
        : statusCode === 103
          ? 'Running'
          : 'Failure',
    status_code: statusCode,
    err,
    may_cancel: false,
    metadata: null,
  };
}

function started(id = 'op-1') {
  return json(
    {
      type: 'async',
      status: 'Operation created',
      status_code: 100,
      operation: `/1.0/operations/${id}`,
      metadata: operation(id, 103),
    },
    202,
  );
}

const instance = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  status: 'Running',
  status_code: 103,
  ephemeral: true,
  config: { 'user.tale.session': 's1' },
  devices: {},
  profiles: ['sandbox'],
  created_at: '2026-10-11T12:00:00Z',
  ...extra,
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

describe('how a call is shaped', () => {
  test('every project-scoped call names the project, and the path is escaped', async () => {
    const { client, seen } = scripted([
      sync(instance('a b')),
      sync([instance('x')]),
      sync({ name: 'sandbox', config: {}, devices: {} }),
    ]);
    await client.getInstance('a b');
    await client.listInstances();
    await client.getProfile('sandbox');
    expect(
      seen.map((s) => [s.init.method, s.url.pathname, s.url.search]),
    ).toEqual([
      ['GET', '/1.0/instances/a%20b', '?project=sandbox-pr'],
      ['GET', '/1.0/instances', '?project=sandbox-pr&recursion=1'],
      ['GET', '/1.0/profiles/sandbox', '?project=sandbox-pr'],
    ]);
  });

  test('the pinned material rides on every request', async () => {
    const { client, seen } = scripted([
      sync({ api_extensions: [], auth: 'trusted' }),
    ]);
    await client.getServer();
    expect(seen[0]?.init.tls).toBe(TLS);
    expect(seen[0]?.url.origin).toBe('https://incus.test:8443');
  });

  test('a write carries its JSON, a patch its ETag precondition', async () => {
    const { client, seen } = scripted([sync(null)]);
    await client.patchInstance(
      'tale-sbx-ses-1',
      { config: { 'user.tale.pinned': 'true' } },
      { ifMatch: '"abc"' },
    );
    const call = seen[0];
    expect(call?.init.method).toBe('PATCH');
    expect(call?.init.headers['if-match']).toBe('"abc"');
    expect(call?.init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(call?.init.body))).toEqual({
      config: { 'user.tale.pinned': 'true' },
    });
  });

  test('a file push names its type, mode and owner', async () => {
    const { client, seen } = scripted([sync(null)]);
    await client.pushFile('tale-sbx-pool-1', '/run/tale/claim.env', 'x=1\n', {
      mode: '0600',
      uid: 0,
      gid: 0,
    });
    const call = seen[0];
    expect(call?.url.searchParams.get('path')).toBe('/run/tale/claim.env');
    expect(call?.init.headers).toMatchObject({
      'x-incus-type': 'file',
      'x-incus-write': 'overwrite',
      'x-incus-mode': '0600',
      'x-incus-uid': '0',
      'x-incus-gid': '0',
      'content-type': 'application/octet-stream',
    });
    const body = call?.init.body;
    expect(body instanceof Uint8Array).toBe(true);
    expect(
      body instanceof Uint8Array ? new TextDecoder().decode(body) : body,
    ).toBe('x=1\n');
  });

  test('the console log is cut to its tail', async () => {
    const { client } = scripted([new Response('0123456789')]);
    expect(await client.getConsoleLog('i', 4)).toBe('6789');
  });
});

describe('how an answer is read', () => {
  test('a missing object is undefined, not an error', async () => {
    const { client } = scripted([
      failure(404, 'Instance not found'),
      failure(404, 'Instance not found'),
      failure(404, 'Storage volume not found'),
      failure(404, 'Alias not found'),
    ]);
    expect(await client.getInstance('gone')).toBeUndefined();
    expect(await client.getInstanceFull('gone')).toBeUndefined();
    expect(await client.getVolume('tank', 'gone')).toBeUndefined();
    expect(await client.getImageAlias('gone')).toBeUndefined();
  });

  test('a failure carries its status and Incus’s own words', async () => {
    const { client } = scripted([
      failure(403, 'User does not have permission'),
    ]);
    const error = await rejection(client.getProfile('sandbox'));
    expect(error).toBeInstanceOf(IncusApiError);
    expect(incusStatus(error)).toBe(403);
    expect(error.message).toContain('User does not have permission');
    expect(error.message).toContain('/1.0/profiles/sandbox');
  });

  test('a gateway page is a failure with the status alone', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { client } = scripted([
        new Response('<html>nope</html>', { status: 401 }),
      ]);
      const error = await rejection(client.getServer());
      expect(incusStatus(error)).toBe(401);
      expect(error.message).toBe('Incus GET /1.0 answered 401');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('an answer that is not an envelope is refused', async () => {
    const { client } = scripted([new Response('not json', { status: 200 })]);
    const error = await rejection(client.getServer());
    expect(incusStatus(error)).toBe(502);
    expect(error.message).toContain('not JSON');
  });

  test('an object missing a field the backend needs is named', async () => {
    const { client } = scripted([sync({ status: 'Running' })]);
    const error = await rejection(client.getInstance('x'));
    expect(error.message).toContain('malformed instance');
  });

  test('the instance state keeps each interface’s addresses', async () => {
    const { client } = scripted([
      sync(
        {
          ...instance('x'),
          state: {
            status: 'Running',
            status_code: 103,
            network: {
              lo: {
                addresses: [
                  { family: 'inet', address: '127.0.0.1', scope: 'local' },
                ],
              },
              eth0: {
                addresses: [
                  {
                    family: 'inet',
                    address: '10.9.0.7',
                    scope: 'global',
                    netmask: '24',
                  },
                ],
              },
            },
          },
        },
        { etag: '"tag"' },
      ),
    ]);
    const full = await client.getInstanceFull('x');
    expect(full?.etag).toBe('"tag"');
    expect(full?.state?.network.eth0?.[0]?.address).toBe('10.9.0.7');
  });

  test('a stopped instance has no state', async () => {
    const { client } = scripted([
      sync({
        ...instance('x', { status: 'Stopped', status_code: 102 }),
        state: null,
      }),
    ]);
    expect((await client.getInstanceFull('x'))?.state).toBeUndefined();
  });

  test('an answer past the cap is refused, declared or streamed', async () => {
    const declared = new IncusClient({
      endpoint: 'https://incus.test:8443',
      project: 'p',
      tls: TLS,
      maxResponseBytes: 100,
      fetch: async () =>
        new Response('x'.repeat(10), { headers: { 'content-length': '5000' } }),
    });
    expect(incusStatus(await rejection(declared.getServer()))).toBe(413);
    const streamed = new IncusClient({
      endpoint: 'https://incus.test:8443',
      project: 'p',
      tls: TLS,
      maxResponseBytes: 100,
      sleep: async () => undefined,
      fetch: async () => new Response('y'.repeat(500)),
    });
    const error = await rejection(streamed.getServer());
    expect(error.message).toContain('100-byte cap');
  });

  test('image-missing is recognised by Incus’s words, not by a bare 404', () => {
    expect(isIncusImageMissing(new IncusApiError('Image not found', 404))).toBe(
      true,
    );
    expect(
      isIncusImageMissing(new IncusApiError('Alias "x" not found', 404)),
    ).toBe(true);
    expect(
      isIncusImageMissing(new IncusApiError('Profile not found', 404)),
    ).toBe(false);
    expect(isIncusImageMissing(new Error('image not found'))).toBe(false);
  });
});

describe('background operations', () => {
  test('a create waits for its operation, polling until it ends', async () => {
    const waits: string[] = [];
    const { client, seen } = scripted([
      started(),
      ({ url }) => {
        waits.push(url.search);
        return sync(operation('op-1', 103));
      },
      ({ url }) => {
        waits.push(url.search);
        return sync(operation('op-1', 200));
      },
    ]);
    await client.createInstance(
      {
        name: 'n',
        ephemeral: true,
        profiles: ['sandbox'],
        config: {},
        devices: {},
        source: { type: 'image', alias: 'runtime' },
        start: true,
      },
      60_000,
    );
    expect(seen.map((s) => s.url.pathname)).toEqual([
      '/1.0/instances',
      '/1.0/operations/op-1/wait',
      '/1.0/operations/op-1/wait',
    ]);
    expect(waits).toHaveLength(2);
    expect(new URLSearchParams(waits[0]).get('timeout')).toBe('30');
  });

  test('a failed operation throws its own message', async () => {
    const { client } = scripted([
      started(),
      sync(operation('op-1', 400, 'Failed creating instance record: boom')),
    ]);
    const error = await rejection(
      client.changeInstanceState('n', 'start', { waitMs: 5_000 }),
    );
    expect(error.message).toBe('Failed creating instance record: boom');
    expect(incusStatus(error)).toBe(500);
  });

  test('a cancelled operation is its own status', async () => {
    const { client } = scripted([started(), sync(operation('op-1', 401))]);
    const error = await rejection(client.deleteInstance('n', 5_000));
    expect(incusStatus(error)).toBe(499);
  });

  test('an operation that outlives its budget is a timeout', async () => {
    const { client, seen } = scripted([
      started(),
      async () => {
        await Bun.sleep(40);
        return sync(operation('op-1', 103));
      },
    ]);
    const error = await rejection(
      client.changeInstanceState('n', 'stop', { waitMs: 20, force: true }),
    );
    expect(incusStatus(error)).toBe(504);
    expect(seen).toHaveLength(2);
  });

  test('a synchronous answer to a volume call needs no waiting', async () => {
    const { client, seen } = scripted([sync(null), sync(null)]);
    await client.createVolume('tank', {
      name: 'v',
      type: 'custom',
      content_type: 'filesystem',
      config: { size: '10GiB' },
    });
    expect(await client.deleteVolume('tank', 'v')).toBe(true);
    expect(seen.map((s) => `${s.init.method} ${s.url.pathname}`)).toEqual([
      'POST /1.0/storage-pools/tank/volumes/custom',
      'DELETE /1.0/storage-pools/tank/volumes/custom/v',
    ]);
  });

  test('deleting what is already gone answers false', async () => {
    const { client } = scripted([
      failure(404, 'Instance not found'),
      failure(404, 'Storage volume not found'),
    ]);
    expect(await client.deleteInstance('gone', 5_000)).toBe(false);
    expect(await client.deleteVolume('tank', 'gone')).toBe(false);
  });

  test('an image pull names the registry and the alias to give it', async () => {
    const { client, seen } = scripted([
      started(),
      sync(operation('op-1', 200)),
    ]);
    await client.pullOciImage(
      {
        server: 'https://ghcr.io',
        alias: 'tale-project/tale/tale-sandbox-runtime:1.2.3',
      },
      'tale-sandbox-runtime',
      60_000,
    );
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      aliases: [{ name: 'tale-sandbox-runtime' }],
      source: {
        type: 'image',
        mode: 'pull',
        protocol: 'oci',
        server: 'https://ghcr.io',
        alias: 'tale-project/tale/tale-sandbox-runtime:1.2.3',
      },
    });
  });
});

describe('retries and cancellation', () => {
  test('a read survives a dropped connection and a gateway error', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { client, seen } = scripted([
        new Error('ECONNRESET'),
        new Response('bad gateway', { status: 502 }),
        sync({ api_extensions: ['instance_oci'], auth: 'trusted' }),
      ]);
      expect((await client.getServer()).apiExtensions).toEqual([
        'instance_oci',
      ]);
      expect(seen).toHaveLength(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('a read gives up after three attempts with the last failure', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { client, seen } = scripted([
        new Error('one'),
        new Error('two'),
        new Error('three'),
      ]);
      expect((await rejection(client.getServer())).message).toBe('three');
      expect(seen).toHaveLength(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('a definitive answer is not asked again', async () => {
    const { client, seen } = scripted([failure(403, 'forbidden')]);
    await rejection(client.getServer());
    expect(seen).toHaveLength(1);
  });

  test('a write is never repeated behind the caller’s back', async () => {
    const { client, seen } = scripted([new Error('ECONNRESET')]);
    await rejection(client.patchInstance('n', { config: { a: 'b' } }));
    expect(seen).toHaveLength(1);
  });

  test('the ambient operation budget cancels an in-flight call', async () => {
    const client = new IncusClient({
      endpoint: 'https://incus.test:8443',
      project: 'p',
      tls: TLS,
      sleep: async () => undefined,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(init.signal.reason),
            {
              once: true,
            },
          );
        }),
    });
    const controller = new AbortController();
    const outcome = rejection(
      withOperationBudget(10_000, () => client.getServer(), controller.signal),
    );
    controller.abort(new Error('caller cancelled'));
    expect((await outcome).message).toBe('caller cancelled');
  });

  test('a request that never answers ends at its own timeout', async () => {
    const client = new IncusClient({
      endpoint: 'https://incus.test:8443',
      project: 'p',
      tls: TLS,
      requestTimeoutMs: 50,
      sleep: async () => undefined,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(init.signal.reason),
            {
              once: true,
            },
          );
        }),
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await rejection(client.patchInstance('n', {}));
      expect(error.name).toBe('TimeoutError');
    } finally {
      warn.mockRestore();
    }
  });
});

// The connection itself: a real TLS server that wants a client certificate.
describe('the pinned mutual-TLS connection', () => {
  let certs: TestCertificates | null = null;
  const servers: Array<{ stop(force?: boolean): void }> = [];
  const silent: Server[] = [];

  beforeAll(() => {
    certs = makeTestCertificates();
  });

  afterAll(() => {
    for (const server of servers) server.stop(true);
    for (const server of silent) server.close();
    certs?.dispose();
  });

  function serve(
    shape: 'server' | 'otherServer' | 'incusDefault',
    trusted: 'client' | 'otherClient',
  ): number {
    if (certs === null) throw new Error('no certificates');
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      tls: {
        cert: certs[shape].cert,
        key: certs[shape].key,
        ca: certs[trusted].cert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      fetch: (req) =>
        new Response(
          JSON.stringify({
            type: 'sync',
            status: 'Success',
            status_code: 200,
            metadata: {
              api_extensions: ['instance_oci'],
              auth: 'trusted',
              environment: { server_name: 'node', server_version: '7.5.1' },
              path: new URL(req.url).pathname,
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    servers.push(server);
    return server.port ?? 0;
  }

  function clientFor(
    port: number,
    anchor: 'server' | 'otherServer' | 'incusDefault',
    identity: 'client' | 'otherClient',
    requestTimeoutMs = 5_000,
  ): IncusClient {
    if (certs === null) throw new Error('no certificates');
    return new IncusClient({
      endpoint: `https://127.0.0.1:${port}`,
      project: 'sandbox-pr',
      tls: {
        ca: certs[anchor].cert,
        cert: certs[identity].cert,
        key: certs[identity].key,
      },
      requestTimeoutMs,
      sleep: async () => undefined,
    });
  }

  test('a pinnable server certificate and the trusted client certificate talk', async () => {
    if (certs === null) return;
    const port = serve('server', 'client');
    const info = await clientFor(port, 'server', 'client').getServer();
    expect(info.auth).toBe('trusted');
    expect(info.serverVersion).toBe('7.5.1');
  });

  test('a server that does not know the client certificate refuses the handshake', async () => {
    if (certs === null) return;
    const port = serve('server', 'client');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await rejection(clientFor(port, 'server', 'otherClient').getServer());
    } finally {
      warn.mockRestore();
    }
  });

  test('a server presenting another certificate than the pinned one is refused', async () => {
    if (certs === null) return;
    const port = serve('server', 'client');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await rejection(
        clientFor(port, 'otherServer', 'client').getServer(),
      );
      expect(error.message).toMatch(
        /self signed|unable to verify|certificate/i,
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('Incus’s default certificate shape cannot be pinned, and is refused rather than waved through', async () => {
    if (certs === null) return;
    const port = serve('incusDefault', 'client');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await rejection(
        clientFor(port, 'incusDefault', 'client').getServer(),
      );
      expect(error.message).toMatch(/unable to verify the first certificate/i);
    } finally {
      warn.mockRestore();
    }
  });

  test('a server that accepts the connection and says nothing ends at the timeout', async () => {
    if (certs === null) return;
    const hole = createServer(() => undefined);
    silent.push(hole);
    await new Promise<void>((resolve) =>
      hole.listen(0, '127.0.0.1', () => resolve()),
    );
    const address = hole.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await rejection(
        clientFor(port, 'server', 'client', 300).getServer(),
      );
      expect(error.name).toBe('TimeoutError');
    } finally {
      warn.mockRestore();
    }
  });
});
