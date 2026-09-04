// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  chargeOrgRateLimit,
  rateLimitExceededCause,
  rateLimitedPlainResponse,
  rateLimitedResponse,
  retryAfterSeconds,
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

describe('retryAfterSeconds', () => {
  it('rounds up to whole seconds and never advertises zero', () => {
    expect(retryAfterSeconds(1500)).toBe('2');
    expect(retryAfterSeconds(60_000)).toBe('60');
    expect(retryAfterSeconds(0)).toBe('1');
  });
});

describe('rateLimitedPlainResponse', () => {
  it('answers a bare 429 with Retry-After and keeps the door headers', async () => {
    const res = rateLimitedPlainResponse(
      new RateLimitExceededError('spent', 2001),
      { 'Cache-Control': 'no-store', Vary: 'Cookie' },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Rate limit exceeded');
  });
});

describe('rateLimitExceededCause', () => {
  it('finds the refusal itself, or the one a domain wrapper carries as cause', () => {
    const limited = new RateLimitExceededError('spent', 10);
    expect(rateLimitExceededCause(limited)).toBe(limited);
    expect(
      rateLimitExceededCause(new Error('wrapped', { cause: limited })),
    ).toBe(limited);
  });

  it('answers null for anything else', () => {
    expect(rateLimitExceededCause(new Error('plain'))).toBeNull();
    expect(
      rateLimitExceededCause(new Error('other cause', { cause: 'x' })),
    ).toBeNull();
    expect(rateLimitExceededCause('not an error')).toBeNull();
  });
});
