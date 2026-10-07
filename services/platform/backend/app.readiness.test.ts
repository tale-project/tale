import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function app(sql: Sql) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- session-free test double
  const auth = {
    api: { getSession: vi.fn() },
    options: { baseURL: 'http://localhost' },
  } as unknown as Auth;
  return createApp({ sql, auth });
}

describe('browser readiness', () => {
  it('bounds a hung database and shares concurrent checks without caching recovery', async () => {
    vi.useFakeTimers();
    let settle: ((rows: unknown[]) => void) | undefined;
    const query = vi.fn().mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        settle = resolve;
      }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    const application = app(query as unknown as Sql);
    const first = application.request('/api/health/ready');
    const second = application.request('/api/health/ready');
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await first).status).toBe(503);
    expect((await second).status).toBe(503);
    expect(query).toHaveBeenCalledTimes(1);
    const repeated = application.request('/api/health/ready');
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await repeated).status).toBe(503);
    expect(query).toHaveBeenCalledTimes(1);
    settle?.([{ '?column?': 1 }]);
    await vi.advanceTimersByTimeAsync(0);
    query.mockResolvedValue([{ '?column?': 1 }]);
    expect((await application.request('/api/health/ready')).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('proves a database round trip without a session and never caches the verdict', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    const res = await app(query as unknown as Sql).request('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, service: 'backend' });
    expect(query.mock.calls[0]?.[0]).toEqual(['SELECT 1']);
  });

  it('does not publish a ready verdict when the database is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi.fn().mockRejectedValue(
      Object.assign(new Error('unavailable'), {
        code: 'ECONNREFUSED',
        query: 'SELECT 1',
        parameters: [],
      }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    const res = await app(query as unknown as Sql).request('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: false, service: 'backend' });
  });
});
