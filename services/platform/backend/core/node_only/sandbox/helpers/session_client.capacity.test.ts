import { createHash, createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxCapacity, sandboxDeploymentLimits } from './session_client.ts';

const snapshot = {
  status: 'available',
  observedAt: 1000,
  backend: 'docker',
  scope: 'host',
  sessions: {
    running: 3,
    starting: 1,
    limit: 16,
    organizationRunning: 1,
    organizationStarting: 0,
    organizationLimit: 16,
  },
  resources: {
    cpu: { totalCores: 8, usedCores: null },
    memory: { totalBytes: 1024, usedBytes: 512 },
  },
  runtimeSessions: [{ sessionId: 's1', state: 'running' }],
};

beforeEach(() => {
  vi.stubEnv('SANDBOX_TOKEN', 'capacity-client-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});

describe('sandbox deployment limit client', () => {
  it('signs a dedicated limits read and obtains fresh configuration on each request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ maxSessions: 16 }))
      .mockResolvedValueOnce(Response.json({ maxSessions: 8 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await sandboxDeploymentLimits('org-a')).toEqual({ maxSessions: 16 });
    expect(await sandboxDeploymentLimits('org-a')).toEqual({ maxSessions: 8 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const nonces = [];
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('http://sandbox.test/v1/limits');
      const headers = new Headers(init?.headers);
      const timestamp = headers.get('x-tale-sandbox-timestamp');
      const nonce = headers.get('x-tale-sandbox-nonce');
      nonces.push(nonce);
      expect(nonce).toBeTruthy();
      const signature = createHmac('sha256', 'capacity-client-test')
        .update(
          `GET\n/v1/limits\n${timestamp}\n${nonce}\n${createHash('sha256').update('').digest('hex')}`,
        )
        .digest('hex');
      expect(headers.get('x-tale-sandbox-signature')).toBe(signature);
    }
    expect(new Set(nonces).size).toBe(2);
  });

  it('reads the fresh global ceiling from older spawners using the authenticated organization', async () => {
    const legacySnapshot = {
      ...snapshot,
      sessions: { ...snapshot.sessions, organizationLimit: 50 },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(Response.json(legacySnapshot))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          ...legacySnapshot,
          sessions: { ...legacySnapshot.sessions, limit: 8 },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    expect(await sandboxDeploymentLimits('org-a')).toEqual({ maxSessions: 16 });
    expect(await sandboxDeploymentLimits('org-a')).toEqual({ maxSessions: 8 });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://sandbox.test/v1/limits',
      'http://sandbox.test/v1/capacity?organizationId=org-a',
      'http://sandbox.test/v1/limits',
      'http://sandbox.test/v1/capacity?organizationId=org-a',
    ]);
  });

  it.each([403, 503])(
    'rejects HTTP %i without trying a compatibility read',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', { status }));
      vi.stubGlobal('fetch', fetcher);
      await expect(sandboxDeploymentLimits('org-a')).rejects.toThrow(
        String(status),
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { status: 503, body: {} },
    { status: 200, body: {} },
    {
      status: 200,
      body: { ...snapshot, sessions: { ...snapshot.sessions, limit: 0 } },
    },
  ])(
    'rejects unavailable or malformed legacy capacity: %j',
    async ({ status, body }) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('{}', { status: 404 }))
        .mockResolvedValueOnce(Response.json(body, { status }));
      vi.stubGlobal('fetch', fetcher);
      await expect(sandboxDeploymentLimits('org-a')).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    {},
    { maxSessions: 0 },
    { maxSessions: -1 },
    { maxSessions: 1.5 },
    { maxSessions: '16' },
    { maxSessions: null },
  ])('rejects invalid deployment configuration: %j', async (value) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value));
    vi.stubGlobal('fetch', fetcher);
    await expect(sandboxDeploymentLimits('org-a')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sandbox capacity client', () => {
  it('signs the organization into the request and preserves unknown measurements', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal('fetch', fetcher);
    expect(await sandboxCapacity('org-a')).toEqual(snapshot);
    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe(
      'http://sandbox.test/v1/capacity?organizationId=org-a',
    );
    const headers = new Headers(call?.[1]?.headers);
    const timestamp = headers.get('x-tale-sandbox-timestamp');
    const nonce = headers.get('x-tale-sandbox-nonce');
    expect(nonce).toBeTruthy();
    const signatureFor = (org: string) =>
      createHmac('sha256', 'capacity-client-test')
        .update(
          `GET\n/v1/capacity?organizationId=${org}\n${timestamp}\n${nonce}\n${createHash('sha256').update('').digest('hex')}`,
        )
        .digest('hex');
    expect(headers.get('x-tale-sandbox-signature')).toBe(signatureFor('org-a'));
    expect(headers.get('x-tale-sandbox-signature')).not.toBe(
      signatureFor('org-b'),
    );
  });

  it('rejects failed and invalid observations rather than defaulting counts to zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', { status: 503 })),
    );
    await expect(sandboxCapacity('org-a')).rejects.toThrow('503');
    for (const value of [
      {},
      { ...snapshot, sessions: { ...snapshot.sessions, running: -1 } },
      { ...snapshot, resources: { cpu: { totalCores: 8 }, memory: {} } },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)),
      );
      await expect(sandboxCapacity('org-a')).rejects.toThrow();
    }
  });
});
