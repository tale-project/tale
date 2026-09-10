import { createHash, createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxCapacity } from './session_client.ts';

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
    organizationLimit: 50,
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
