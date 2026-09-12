// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import type { StoreStatus } from './store-health.ts';

/**
 * `GET /health/stores` — the per-store verdict the public status page
 * projects its `database` and `object-store` rows from. It reads the same
 * cached probe the metrics gauge reads, names every store as a boolean
 * under a fixed key, and answers 503 (body included) once any store is
 * down, so a plain monitor gets the verdict from the status alone.
 */

vi.mock('./store-health.ts', () => ({
  probeStores: vi.fn(),
  resetStoreHealth: vi.fn(),
}));

const { probeStores } = await import('./store-health.ts');

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the route touches neither
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {
    api: { getSession: () => Promise.resolve(null) },
    options: { baseURL: 'http://localhost' },
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as Auth;
  return createApp({ sql, auth });
}

function statuses(up: Record<StoreStatus['name'], boolean>): StoreStatus[] {
  return (Object.keys(up) as StoreStatus['name'][]).map((name) =>
    up[name] ? { name, up: true } : { name, up: false, detail: 'unreachable' },
  );
}

afterEach(() => {
  vi.mocked(probeStores).mockReset();
});

describe('GET /health/stores', () => {
  it('answers 200 with every store up as booleans under fixed names', async () => {
    vi.mocked(probeStores).mockResolvedValue(
      statuses({ app_db: true, knowledge_db: true, object_store: true }),
    );
    const res = await app().request('http://localhost/health/stores');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      service: 'backend',
      stores: { app_db: true, knowledge_db: true, object_store: true },
    });
    expect(probeStores).toHaveBeenCalledTimes(1);
  });

  it('answers 503 once a store is down, the flags still in the body — and never the probe’s detail', async () => {
    vi.mocked(probeStores).mockResolvedValue(
      statuses({ app_db: true, knowledge_db: true, object_store: false }),
    );
    const res = await app().request('http://localhost/health/stores');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      service: 'backend',
      stores: { app_db: true, knowledge_db: true, object_store: false },
    });
    expect(JSON.stringify(body)).not.toContain('unreachable');
  });

  it('reads a store the probe did not report as down', async () => {
    vi.mocked(probeStores).mockResolvedValue(
      statuses({ app_db: true, knowledge_db: true, object_store: true }).slice(
        0,
        2,
      ),
    );
    const res = await app().request('http://localhost/health/stores');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      stores: { app_db: true, knowledge_db: true, object_store: false },
    });
  });

  it('needs no session, like /ping', async () => {
    vi.mocked(probeStores).mockResolvedValue(
      statuses({ app_db: true, knowledge_db: true, object_store: true }),
    );
    const res = await app().request('http://localhost/health/stores', {
      headers: { authorization: 'Bearer nothing' },
    });
    expect(res.status).toBe(200);
  });
});
