import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { mapLimit } from '../../src/seed/concurrency.ts';
import {
  cookieHeader,
  cookiesFromSetCookie,
  parseRetryAfter,
  SeedHttp,
  SeedHttpError,
  withRetry,
} from '../../src/seed/http.ts';
import {
  generatePassword,
  meetsPasswordPolicy,
  parseSeedOptions,
  randomRunId,
  resolveRunIdentity,
  syntheticIp,
} from '../../src/seed/options.ts';

describe('options', () => {
  test('generated passwords meet the policy', () => {
    for (let i = 0; i < 500; i += 1) {
      const password = generatePassword();
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(meetsPasswordPolicy(password)).toBe(true);
    }
    expect(new Set(Array.from({ length: 50 }, generatePassword)).size).toBe(50);
  });

  test('the policy refuses weak passwords', () => {
    expect(meetsPasswordPolicy('short1!A')).toBe(false);
    expect(meetsPasswordPolicy('alllowercase1234!')).toBe(false);
    expect(meetsPasswordPolicy('NoDigitsHere!!!!')).toBe(false);
    expect(meetsPasswordPolicy('NoSpecials12345a')).toBe(false);
  });

  test('random run ids fit the plan schema', () => {
    for (let i = 0; i < 100; i += 1)
      expect(randomRunId()).toMatch(/^[a-z0-9]{8}$/);
  });

  test('defaults apply and the target loses its trailing slash', () => {
    const options = parseSeedOptions({
      target: 'http://127.0.0.1:4105/',
      users: 10,
      orgSize: 5,
    });
    expect(options.target).toBe('http://127.0.0.1:4105');
    expect(options.megaOrgSize).toBe(0);
    expect(options.emailDomain).toBe('load.tale.invalid');
    expect(options.concurrency).toBe(16);
    expect(options.batchSize).toBe(2000);
    expect(options.provider).toEqual({
      slug: 'loadmock',
      baseUrl: 'http://127.0.0.1:4199/v1',
      envName: 'TALE_PROVIDER_KEY_LOADMOCK',
      apiFormat: 'openai',
      chatModel: 'load-chat-fast',
      embeddingModel: 'load-embed',
      embeddingDimensions: 1536,
      catalogSource: 'models-endpoint',
    });
    expect(options.runId).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  test('invalid combinations are refused', () => {
    expect(() =>
      parseSeedOptions({
        target: 'http://x.test',
        users: 10,
        orgSize: 5,
        megaOrgSize: 11,
      }),
    ).toThrow(/megaOrgSize/);
    expect(() =>
      parseSeedOptions({
        target: 'http://x.test',
        users: 10,
        orgSize: 5,
        password: 'weak',
      }),
    ).toThrow(/password/);
    expect(() =>
      parseSeedOptions({
        target: 'http://x.test',
        users: 10,
        orgSize: 5,
        provider: { embeddingDimensions: 1000 },
      }),
    ).toThrow(/vector width/);
  });

  test('a resumed identity wins, and a disagreeing explicit one is an error', () => {
    const resumed = { runId: 'abcd1234', password: 'Aa1!aaaaaaaaaaaa' };
    expect(resolveRunIdentity({}, resumed)).toEqual(resumed);
    expect(() => resolveRunIdentity({ runId: 'zzzz9999' }, resumed)).toThrow();
    expect(() =>
      resolveRunIdentity({ password: 'Bb2@bbbbbbbbbbbb' }, resumed),
    ).toThrow();
    const fresh = resolveRunIdentity({ runId: 'wxyz0000' }, null);
    expect(fresh.runId).toBe('wxyz0000');
    expect(meetsPasswordPolicy(fresh.password)).toBe(true);
  });

  test('synthetic addresses fill the octets after the base', () => {
    expect(syntheticIp('10', 0x010203)).toBe('10.1.2.3');
    expect(syntheticIp('10.77', 0x0102)).toBe('10.77.1.2');
    expect(syntheticIp('10.77.5', 300)).toBe('10.77.5.44');
  });
});

describe('concurrency', () => {
  test('mapLimit keeps order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, value));
      inFlight -= 1;
      return value * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  test('mapLimit rejects with the first failure', async () => {
    const run = mapLimit([1, 2, 3], 2, (value) => {
      if (value === 2) return Promise.reject(new Error('boom'));
      return Promise.resolve(value);
    });
    let caught: unknown = null;
    try {
      await run;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });
});

describe('http helper', () => {
  let server: Server;
  let base = '';
  let throttled = 0;
  const seen: { origin?: string; cookie?: string; contentType?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({
        origin: req.headers.origin,
        cookie: req.headers.cookie,
        contentType: req.headers['content-type'],
      });
      if (req.url?.startsWith('/throttled') && throttled < 2) {
        throttled += 1;
        res.writeHead(429, {
          'retry-after': '0',
          'content-type': 'application/json',
        });
        res.end('{"error":"RATE_LIMITED"}');
        return;
      }
      if (req.url?.startsWith('/forbidden')) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"error":"FORBIDDEN"}');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': ['a=1; Path=/; HttpOnly', 'b=two%3D; Path=/'],
      });
      res.end(JSON.stringify({ url: req.url }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('writes carry Origin, cookies and JSON; reads parse JSON', async () => {
    const http = new SeedHttp({ target: base, connections: 2 });
    try {
      const res = await http.send({
        method: 'POST',
        path: '/api/x',
        query: { orgId: 'o 1' },
        cookie: 'c=3',
        json: { a: 1 },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: '/api/x?orgId=o+1' });
      expect(seen.at(-1)).toEqual({
        origin: base,
        cookie: 'c=3',
        contentType: 'application/json',
      });
      const jar = cookiesFromSetCookie(res.headers['set-cookie']);
      expect(cookieHeader(jar)).toBe('a=1; b=two%3D');
      await http.send({ method: 'GET', path: '/api/y' });
      expect(seen.at(-1)?.origin).toBeUndefined();
    } finally {
      await http.close();
    }
  });

  test('429 is retried after Retry-After; 403 is not', async () => {
    const http = new SeedHttp({ target: base, connections: 2 });
    try {
      let attempts = 0;
      const body = await withRetry(() => {
        attempts += 1;
        return http.json({ method: 'GET', path: '/throttled' });
      });
      expect(body).toEqual({ url: '/throttled' });
      expect(attempts).toBe(3);

      let forbiddenAttempts = 0;
      let caught: unknown = null;
      try {
        await withRetry(() => {
          forbiddenAttempts += 1;
          return http.json({ method: 'GET', path: '/forbidden' });
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SeedHttpError);
      expect((caught as SeedHttpError).status).toBe(403);
      expect(forbiddenAttempts).toBe(1);
    } finally {
      await http.close();
    }
  });

  test('Retry-After parses seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const inFuture = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(inFuture)).toBeGreaterThan(5000);
  });
});
