// @vitest-environment node

import { createHash, createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sandboxCapacity,
  sandboxLeaseAcquire,
  sandboxLeaseRelease,
  sandboxLeases,
  SpawnerStatusError,
} from './session_client.ts';

const LEASE = {
  id: 'lease-1',
  sessionId: 'pa-ada-1',
  organizationId: 'org-a',
  class: 'heavy',
  label: 'npm ci',
  predictedGrowthBytes: 2 * 1024 ** 3,
  memoryBytes: 1024 ** 3,
  acquiredAtMs: 1_000,
  expiresAtMs: 1_801_000,
};

function signatureOf(
  method: string,
  path: string,
  body: string,
  headers: Headers,
): string {
  const timestamp = headers.get('x-tale-sandbox-timestamp');
  const nonce = headers.get('x-tale-sandbox-nonce');
  return createHmac('sha256', 'lease-client-test')
    .update(
      `${method}\n${path}\n${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`,
    )
    .digest('hex');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv('SANDBOX_TOKEN', 'lease-client-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});

describe('sandboxLeaseAcquire', () => {
  it('signs the request and answers the granted lease [SBX-R28]', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ lease: LEASE }, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);

    const answer = await sandboxLeaseAcquire('pa-ada-1', {
      organizationId: 'org-a',
      label: 'npm ci',
      predictedGrowthBytes: 3 * 1024 ** 3,
      ttlMs: 600_000,
    });

    expect(answer).toEqual({ granted: true, lease: LEASE });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://sandbox.test/v1/sessions/pa-ada-1/leases');
    expect(init?.method).toBe('POST');
    const body = typeof init?.body === 'string' ? init.body : '';
    expect(JSON.parse(body)).toEqual({
      organizationId: 'org-a',
      class: 'heavy',
      label: 'npm ci',
      predictedGrowthBytes: 3 * 1024 ** 3,
      ttlMs: 600_000,
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('x-tale-sandbox-signature')).toBe(
      signatureOf('POST', '/v1/sessions/pa-ada-1/leases', body, headers),
    );
  });

  it('answers a refusal with its reason and wait, never as a throw [SBX-R29]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: 'lease_refused',
            reason: 'limit',
            retryAfterMs: 30_000,
            evidence: { leases: { active: 2, max: 2 } },
          },
          { status: 429, headers: { 'retry-after': '30' } },
        ),
      ),
    );

    await expect(
      sandboxLeaseAcquire('pa-ada-1', { organizationId: 'org-a' }),
    ).resolves.toEqual({
      granted: false,
      reason: 'limit',
      retryAfterMs: 30_000,
      evidence: { leases: { active: 2, max: 2 } },
    });
  });

  it('reads a spawner without lease routes, or one that does not know the session, as unavailable [SBX-R30]', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ error: 'not_found' }, { status: 404 }),
        ),
    );

    await expect(
      sandboxLeaseAcquire('pa-ada-1', { organizationId: 'org-a' }),
    ).resolves.toMatchObject({ granted: false, reason: 'unavailable' });
  });

  it.each([
    { status: 409, body: { error: 'session_not_live' } },
    { status: 503, body: { error: 'session_unavailable' } },
    { status: 429, body: { error: 'something_else' } },
  ])('throws on any other answer: %j', async ({ status, body }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status })),
    );

    const failure = await sandboxLeaseAcquire('pa-ada-1', {
      organizationId: 'org-a',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpawnerStatusError);
    expect((failure as SpawnerStatusError).status).toBe(status);
  });
});

describe('sandboxLeaseRelease', () => {
  it('ends the lease of the session and organization [SBX-R32]', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(
      sandboxLeaseRelease({
        organizationId: 'org-a',
        sessionId: 'pa-ada-1',
        leaseId: 'lease-1',
      }),
    ).resolves.toBe('released');
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://sandbox.test/v1/sessions/pa-ada-1/leases/lease-1?organizationId=org-a',
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('counts a lease the host no longer holds as gone, not as a failure [SBX-R32]', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ error: 'lease_not_found' }, { status: 404 }),
        ),
    );

    await expect(
      sandboxLeaseRelease({
        organizationId: 'org-a',
        sessionId: 'pa-ada-1',
        leaseId: 'lease-1',
      }),
    ).resolves.toBe('gone');
  });

  it('throws when the host cannot be asked, so a caller retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({}, { status: 502 })),
    );

    await expect(
      sandboxLeaseRelease({
        organizationId: 'org-a',
        sessionId: 'pa-ada-1',
        leaseId: 'lease-1',
      }),
    ).rejects.toBeInstanceOf(SpawnerStatusError);
  });
});

describe('sandboxLeases', () => {
  it('lists the organization’s active leases, and null from a spawner without them', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ leases: [LEASE] }))
      .mockResolvedValueOnce(
        Response.json({ error: 'not_found' }, { status: 404 }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(sandboxLeases('org-a')).resolves.toEqual([LEASE]);
    await expect(sandboxLeases('org-a')).resolves.toBeNull();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://sandbox.test/v1/leases?organizationId=org-a',
    );
  });

  it('refuses a lease of a shape it does not know', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ leases: [{ ...LEASE, class: 'light' }] }),
        ),
    );

    await expect(sandboxLeases('org-a')).rejects.toThrow();
  });
});

describe('sandboxCapacity — the host’s leases', () => {
  const snapshot = {
    status: 'available',
    observedAt: 1000,
    backend: 'docker',
    scope: 'host',
    sessions: {
      running: 3,
      starting: 0,
      limit: 16,
      organizationRunning: 1,
      organizationStarting: 0,
      organizationLimit: 16,
    },
    resources: {
      cpu: { totalCores: 4, usedCores: 1 },
      memory: { totalBytes: 16, usedBytes: 8 },
    },
    runtimeSessions: [],
  };

  it('keeps how many leases the host holds, and reads an older spawner without them [SBX-R33]', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ ...snapshot, leases: { active: 1, max: 2 } }),
        )
        .mockResolvedValueOnce(Response.json(snapshot)),
    );

    await expect(sandboxCapacity('org-a')).resolves.toMatchObject({
      leases: { active: 1, max: 2 },
    });
    await expect(sandboxCapacity('org-a')).resolves.not.toHaveProperty(
      'leases',
    );
  });
});
