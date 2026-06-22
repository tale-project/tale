// Unit tests for the K8s API-channel primitives: the per-call timeout
// middleware (the only thing standing between a wedged TCP connection and a
// forever-hung execute()) and withRetry's retryability gate.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { HttpMethod, RequestContext } from '@kubernetes/client-node';

import {
  apiTimeout,
  httpStatusCode,
  makeK8sConfig,
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

// Snapshot the env vars touched by makeK8sConfig so tests don't pollute each
// other or the runner's environment.
const K8S_ENV_KEYS = [
  'SANDBOX_K8S_SERVER',
  'SANDBOX_K8S_TOKEN',
  'SANDBOX_K8S_CAFILE',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of K8S_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of K8S_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('makeK8sConfig — explicit bearer-token path (SANDBOX_K8S_SERVER + TOKEN)', () => {
  // Empirically verified under Bun 1.3.14 (issue #1849): @kubernetes/client-node
  // uses node-fetch → https.request(), which Bun honours. skipTLSVerify and
  // caFile both take effect; neither is dead code.

  test('sets caFile when SANDBOX_K8S_CAFILE is provided', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com:6443';
    process.env.SANDBOX_K8S_TOKEN = 'test-token';
    process.env.SANDBOX_K8S_CAFILE = '/etc/k8s/ca.crt';

    const kc = makeK8sConfig();
    const cluster = kc.clusters[0]!;
    expect(cluster.caFile).toBe('/etc/k8s/ca.crt');
    expect(cluster.skipTLSVerify).toBeFalsy();
  });

  test('sets skipTLSVerify when SANDBOX_K8S_CAFILE is absent', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://k8s.example.com:6443';
    process.env.SANDBOX_K8S_TOKEN = 'test-token';

    const kc = makeK8sConfig();
    const cluster = kc.clusters[0]!;
    expect(cluster.skipTLSVerify).toBe(true);
    expect(cluster.caFile).toBeUndefined();
  });

  test('sets the server URL and SA token', () => {
    process.env.SANDBOX_K8S_SERVER = 'https://apiserver.internal:6443';
    process.env.SANDBOX_K8S_TOKEN = 'my-sa-token';

    const kc = makeK8sConfig();
    expect(kc.clusters[0]!.server).toBe('https://apiserver.internal:6443');
    expect(kc.users[0]!.token).toBe('my-sa-token');
  });
});
