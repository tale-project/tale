// Unit tests for the K8s API-channel primitives: the per-call timeout
// middleware (the only thing standing between a wedged TCP connection and a
// forever-hung execute()) and withRetry's retryability gate.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
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
  type LoadFromOptionsArg = Parameters<KubeConfig['loadFromOptions']>[0];
  let capturedOpts: LoadFromOptionsArg | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: ReturnType<typeof spyOn<any, any>>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    capturedOpts = undefined;
    // Capture the original before spyOn replaces it to avoid infinite recursion.
    const originalFn = KubeConfig.prototype.loadFromOptions;
    spy = spyOn(KubeConfig.prototype, 'loadFromOptions').mockImplementation(
      function (this: KubeConfig, opts: LoadFromOptionsArg) {
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

  test('skipTLSVerify is never set — it is inert under Bun (Bun 1.3.x ignores rejectUnauthorized on https.Agent)', () => {
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
