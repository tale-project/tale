// Unit tests for the K8s API-channel primitives: the per-call timeout
// middleware (the only thing standing between a wedged TCP connection and a
// forever-hung execute()) and withRetry's retryability gate.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  createServer as createHttpsServer,
  request as httpsRequest,
  type Server,
} from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoreV1Api,
  HttpMethod,
  KubeConfig,
  RequestContext,
} from '@kubernetes/client-node';

import {
  apiTimeout,
  httpStatusCode,
  makeK8sClient,
  withRetry,
} from './k8s-client.ts';

/** Await a rejection and hand back the error (typed alternative to .rejects). */
async function rejectionOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Error) return err;
    throw new Error(`rejected with a non-Error: ${String(err)}`, {
      cause: err,
    });
  }
  throw new Error('expected the promise to reject');
}

describe('apiTimeout', () => {
  test('middleware arms an AbortSignal on the request context', async () => {
    const opts = apiTimeout(5_000);
    const mw = opts.middleware?.[0];
    expect(mw).toBeDefined();
    const ctx = new RequestContext('https://example.invalid/x', HttpMethod.GET);
    expect(ctx.getSignal()).toBeUndefined();
    await mw?.pre(ctx).toPromise();
    const signal = ctx.getSignal();
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
  });

  test('the armed signal actually fires after the timeout', async () => {
    const opts = apiTimeout(10);
    const ctx = new RequestContext('https://example.invalid/x', HttpMethod.GET);
    await opts.middleware?.[0]?.pre(ctx).toPromise();
    const signal = ctx.getSignal();
    await new Promise((r) => setTimeout(r, 50));
    expect(signal?.aborted).toBe(true);
  });

  test('appends to (not replaces) any configured middleware', () => {
    expect(apiTimeout().middlewareMergeStrategy).toBe('append');
  });
});

describe('httpStatusCode', () => {
  test('reads the numeric code off ApiException-shaped errors', () => {
    expect(httpStatusCode({ code: 404 })).toBe(404);
    expect(httpStatusCode({ code: '404' })).toBeUndefined();
    expect(httpStatusCode(new Error('boom'))).toBeUndefined();
    expect(httpStatusCode(undefined)).toBeUndefined();
  });
});

// Captures options passed to KubeConfig.loadFromOptions via a spy.
describe('makeK8sClient kubeconfig shape', () => {
  // Narrow view of the fields these tests read off the captured kubeconfig.
  // (KubeConfig['loadFromOptions'] is typed `any`, so we model only what we
  // assert on rather than dragging that `any` through the suite.)
  interface CapturedOpts {
    clusters?: { server?: string; caFile?: string; skipTLSVerify?: boolean }[];
    users?: { token?: string }[];
  }
  let capturedOpts: CapturedOpts | undefined;
  let spy: { mockRestore: () => void };
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    capturedOpts = undefined;
    // Capture the original before spyOn replaces it to avoid infinite recursion.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalFn = KubeConfig.prototype.loadFromOptions;
    spy = spyOn(KubeConfig.prototype, 'loadFromOptions').mockImplementation(
      function (this: KubeConfig, opts: CapturedOpts) {
        capturedOpts = opts;
        originalFn.call(this, opts);
      },
    );
    for (const k of [
      'SANDBOX_K8S_SERVER',
      'SANDBOX_K8S_TOKEN',
      'SANDBOX_K8S_CAFILE',
    ]) {
      savedEnv[k] = process.env[k];
    }
  });

  afterEach(() => {
    spy.mockRestore();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('skipTLSVerify is never set — it is inert under Bun (node-fetch transport drops the Agent TLS options)', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com';
    process.env.SANDBOX_K8S_TOKEN = 'test-token';
    delete process.env.SANDBOX_K8S_CAFILE;
    makeK8sClient('test-ns');
    const cluster = capturedOpts?.clusters?.[0];
    expect(cluster?.skipTLSVerify).toBeUndefined();
  });

  test('caFile is set from SANDBOX_K8S_CAFILE when provided (non-Bun compat; inert under Bun)', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com';
    process.env.SANDBOX_K8S_TOKEN = 'test-token';
    process.env.SANDBOX_K8S_CAFILE = '/etc/ssl/k8s-ca.crt';
    makeK8sClient('test-ns');
    const cluster = capturedOpts?.clusters?.[0];
    expect(cluster?.caFile).toBe('/etc/ssl/k8s-ca.crt');
    expect(cluster?.skipTLSVerify).toBeUndefined();
  });

  test('caFile is absent when SANDBOX_K8S_CAFILE is unset', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com';
    process.env.SANDBOX_K8S_TOKEN = 'test-token';
    delete process.env.SANDBOX_K8S_CAFILE;
    makeK8sClient('test-ns');
    const cluster = capturedOpts?.clusters?.[0];
    expect(cluster?.caFile).toBeUndefined();
    expect(cluster?.skipTLSVerify).toBeUndefined();
  });

  test('bearer token is placed on the user entry', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com';
    process.env.SANDBOX_K8S_TOKEN = 'my-sa-token';
    delete process.env.SANDBOX_K8S_CAFILE;
    makeK8sClient('ns');
    expect(capturedOpts?.users?.[0]?.token).toBe('my-sa-token');
    expect(capturedOpts?.clusters?.[0]?.server).toBe('https://k8s.example.com');
  });
});

// End-to-end proof of the TLS NOTE in k8s-client.ts: the kubeconfig knobs
// skipTLSVerify/caFile are INERT under Bun because @kubernetes/client-node@1.4.0
// routes requests through node-fetch, whose Agent TLS options Bun's fetch shim
// drops. We stand up a self-signed HTTPS server and drive a REAL CoreV1Api
// client at it: if Bun honored the knobs the TLS handshake would succeed (we'd
// see an HTTP/parse outcome); instead it still fails with a self-signed-cert
// error, proving the knobs do nothing.
//
// The cert is generated at runtime via openssl into a temp dir (never committed
// — keeps private keys out of the repo and away from secret scanners). If
// openssl is unavailable the block skips rather than failing.
describe('kubeconfig TLS knobs are inert under Bun (end-to-end)', () => {
  let tmp: string | undefined;
  let certPath = '';
  let server: Server | undefined;
  let port = 0;
  let ready = false;

  /** True when any error in the cause chain is a TLS server-cert rejection. */
  function isTlsCertError(err: unknown): boolean {
    const str = (v: unknown): string =>
      typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    const parts: string[] = [];
    let cur: unknown = err;
    for (let i = 0; i < 6 && cur != null; i++) {
      const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
      parts.push(str(e.code), str(e.message));
      cur = e.cause;
    }
    return /self.?signed|DEPTH_ZERO|unable to (get|verify)|certificate/i.test(
      parts.join(' | '),
    );
  }

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'k8s-tls-test-'));
    certPath = join(tmp, 'cert.pem');
    const keyPath = join(tmp, 'key.pem');
    const gen = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    if (gen.status !== 0) return; // openssl missing → tests skip
    const srv = createHttpsServer(
      { cert: readFileSync(certPath), key: readFileSync(keyPath) },
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      },
    );
    await new Promise<void>((resolve) =>
      srv.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = srv.address();
    if (addr == null || typeof addr === 'string') {
      srv.close();
      return; // unexpected address shape → tests skip
    }
    server = srv;
    port = addr.port;
    ready = true;
  });

  afterAll(() => {
    server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function clientFor(clusterExtra: Record<string, unknown>): CoreV1Api {
    const kc = new KubeConfig();
    kc.loadFromOptions({
      clusters: [
        { name: 'k', server: `https://localhost:${port}`, ...clusterExtra },
      ],
      users: [{ name: 'sa', token: 'tok' }],
      contexts: [{ name: 'c', cluster: 'k', user: 'sa' }],
      currentContext: 'c',
    });
    return kc.makeApiClient(CoreV1Api);
  }

  // Sanity: the server is reachable when TLS verification is actually bypassed
  // at the transport level (top-level rejectUnauthorized on node:https, which
  // Bun DOES honor). Proves the rejections below are about the TLS knobs being
  // dropped on the library's node-fetch path, not an unreachable server.
  test('the self-signed server is reachable when TLS verification is truly off', async () => {
    if (!ready) return;
    const ok = await new Promise<boolean>((resolve) => {
      const req = httpsRequest(
        { host: 'localhost', port, path: '/', rejectUnauthorized: false },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode === 200));
        },
      );
      req.on('error', () => resolve(false));
      req.end();
    });
    expect(ok).toBe(true);
  });

  test('skipTLSVerify: true is INERT — the apiserver call still fails TLS verification', async () => {
    if (!ready) return;
    const api = clientFor({ skipTLSVerify: true });
    let caught: unknown;
    try {
      await api.listNamespace();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isTlsCertError(caught)).toBe(true);
  });

  test('caFile (the cluster CA itself) is INERT — the apiserver call still fails TLS verification', async () => {
    if (!ready) return;
    // caFile points at the server's OWN cert: under Node this would establish
    // trust; under Bun's node-fetch path it is dropped, so verification fails.
    const api = clientFor({ caFile: certPath });
    let caught: unknown;
    try {
      await api.listNamespace();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isTlsCertError(caught)).toBe(true);
  });
});

describe('withRetry', () => {
  test('throws definitive 4xx immediately (no second attempt)', async () => {
    for (const code of [400, 401, 403, 404, 409, 422]) {
      let calls = 0;
      const err = await rejectionOf(
        withRetry('test', () => {
          calls += 1;
          throw Object.assign(new Error(`http ${code}`), { code });
        }),
      );
      expect(err.message).toBe(`http ${code}`);
      expect(calls).toBe(1);
    }
  });

  test('retries code-less (network/abort) errors up to the attempt cap', async () => {
    let calls = 0;
    const err = await rejectionOf(
      withRetry('test', () => {
        calls += 1;
        throw new Error('socket hang up');
      }),
    );
    expect(err.message).toBe('socket hang up');
    expect(calls).toBe(3);
  });

  test('retries 5xx and succeeds on a later attempt', async () => {
    let calls = 0;
    const result = await withRetry('test', () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error('http 503'), { code: 503 });
      }
      return Promise.resolve('ok');
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('does not sleep after the final failed attempt', async () => {
    const start = Date.now();
    const err = await rejectionOf(
      withRetry('test', () => {
        throw new Error('always');
      }),
    );
    expect(err.message).toBe('always');
    // Backoff is 200ms + 400ms between attempts; a post-final 600ms sleep
    // would push this past ~1.2s.
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
