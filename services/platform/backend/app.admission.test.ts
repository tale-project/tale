import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

// A traffic switch in front of the backend replicas (the Incus runtime's)
// asks `/admission` every two seconds whether a replica takes new requests.
// It answers from the withdrawal marker alone: a database call there would cut
// every replica out of the switch at once on one slow query.

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function app(withdrawn: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-backend-admission-'));
  directories.push(directory);
  const withdrawnMarker = join(directory, 'backend-withdrawn');
  if (withdrawn) await writeFile(withdrawnMarker, '');
  const query = vi.fn().mockResolvedValue([]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- session-free test double
  const auth = {
    api: { getSession: vi.fn() },
    options: { baseURL: 'http://localhost' },
  } as unknown as Auth;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  const sql = query as unknown as Sql;
  return { application: createApp({ sql, auth, withdrawnMarker }), query };
}

describe('switch admission', () => {
  it('admits a replica the runtime has not withdrawn, without a database call', async () => {
    const { application, query } = await app(false);
    const before = query.mock.calls.length;
    const res = await application.request('/admission');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(query.mock.calls.length).toBe(before);
  });

  it('refuses a withdrawn replica, without a database call', async () => {
    const { application, query } = await app(true);
    const before = query.mock.calls.length;
    const res = await application.request('/admission');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: 'withdrawn' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(query.mock.calls.length).toBe(before);
  });

  it('leaves liveness alone: /ping stays 200 while the replica is withdrawn', async () => {
    const { application } = await app(true);
    expect((await application.request('/ping')).status).toBe(200);
  });
});
