// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  chargeOrgRateLimit,
  rateLimitedResponse,
} from './rate-limit-response.ts';
import { RateLimitExceededError } from './rate-limit.ts';

vi.mock('./rate-limit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rate-limit.ts')>();
  return {
    ...actual,
    checkOrganizationRateLimit: vi.fn(
      async (_sql: unknown, rule: string): Promise<void> => {
        if (rule === 'external:onedrive-list') {
          throw new actual.RateLimitExceededError('spent', 1500);
        }
      },
    ),
  };
});

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double; the charge is mocked
const sql = {} as Sql;

describe('rateLimitedResponse', () => {
  it('answers 429 with the RATE_LIMITED code and a whole-second Retry-After', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      rateLimitedResponse(c, new RateLimitExceededError('spent', 1500)),
    );
    const res = await app.request('/');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.json()).toEqual({
      error: 'RATE_LIMITED',
      data: { retryAfterMs: 1500 },
    });
  });

  it('never advertises a zero-second wait', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      rateLimitedResponse(c, new RateLimitExceededError('spent', 120)),
    );
    expect((await app.request('/')).headers.get('retry-after')).toBe('1');
  });
});

describe('chargeOrgRateLimit', () => {
  it('hands back the 429 when the budget is spent and null when it is not', async () => {
    const app = new Hono();
    app.get('/spent', async (c) => {
      const limited = await chargeOrgRateLimit(
        sql,
        c,
        'external:onedrive-list',
        'org-1',
      );
      return limited ?? c.json({ ok: true });
    });
    app.get('/fresh', async (c) => {
      const limited = await chargeOrgRateLimit(
        sql,
        c,
        'external:google-drive-list',
        'org-1',
      );
      return limited ?? c.json({ ok: true });
    });
    const spent = await app.request('/spent');
    expect(spent.status).toBe(429);
    expect(spent.headers.get('retry-after')).toBe('2');
    expect((await app.request('/fresh')).status).toBe(200);
  });
});
