import { expect, test } from 'bun:test';

import { observationHttp } from './observation-http';

test.each([
  ['https://foreign.example/api/auth/sign-in/email', 'POST'],
  ['http://127.0.0.1:3005/api/auth/sign-up/email', 'POST'],
  ['http://127.0.0.1:3005/api/app/automations/example/deploy', 'POST'],
  ['http://127.0.0.1:3005/api/app/provider-credentials', 'GET'],
])('refuses unreviewed IO %s %s before fetch', async (url, method) => {
  let calls = 0;
  const http = observationHttp(new Set(['/api/auth/get-session']), async () => {
    calls++;
    return Response.json({});
  });
  await expect(
    http.request(url, { method, redirect: 'error' }),
  ).rejects.toThrow('read-only boundary');
  expect(calls).toBe(0);
});

test('reserves time for sign-out after the read budget expires', async () => {
  let time = 0;
  const calls: string[] = [];
  const http = observationHttp(
    new Set(['/api/auth/get-session']),
    async (url) => {
      calls.push(String(url));
      return Response.json({});
    },
    () => time,
  );
  time = 46_000;
  await expect(
    http.request('http://127.0.0.1:3005/api/auth/get-session', {
      redirect: 'error',
    }),
  ).rejects.toThrow('request budget');
  await http.request('http://127.0.0.1:3005/api/auth/sign-out', {
    method: 'POST',
    redirect: 'error',
  });
  expect(calls).toEqual(['http://127.0.0.1:3005/api/auth/sign-out']);
});

test('does not expose an underlying private response or transport error', async () => {
  const http = observationHttp(new Set(['/api/auth/get-session']), async () => {
    throw Error('synthetic secret');
  });
  const failure = await http
    .request('http://127.0.0.1:3005/api/auth/get-session', {
      redirect: 'error',
    })
    .catch((error: Error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain('synthetic secret');
});

test('reserves one sign-out after request and aggregate byte quotas are exhausted', async () => {
  const url = 'http://127.0.0.1:3005/api/auth/get-session';
  const calls: string[] = [];
  const http = observationHttp(
    new Set(['/api/auth/get-session']),
    async (target) => {
      calls.push(String(target));
      return Response.json({});
    },
  );
  for (let i = 0; i < 8191; i++) await http.request(url, { redirect: 'error' });
  await expect(http.request(url, { redirect: 'error' })).rejects.toThrow(
    'request budget',
  );
  await http.request('http://127.0.0.1:3005/api/auth/sign-out', {
    method: 'POST',
    redirect: 'error',
  });
  expect(calls.at(-1)).toContain('sign-out');
  const data = Buffer.alloc(32 * 1024 * 1024);
  const bytes = observationHttp(
    new Set(['/api/auth/get-session']),
    async (target) =>
      String(target).includes('sign-out')
        ? Response.json({})
        : new Response(data),
  );
  await bytes.request(url, { redirect: 'error' });
  await bytes.request(url, { redirect: 'error' });
  await expect(bytes.request(url, { redirect: 'error' })).rejects.toThrow(
    'bounded response',
  );
  expect(
    (
      await bytes.request('http://127.0.0.1:3005/api/auth/sign-out', {
        method: 'POST',
        redirect: 'error',
      })
    ).status,
  ).toBe(200);
});

test('fractional remaining time still admits the bounded final sign-out', async () => {
  let time = 0;
  const http = observationHttp(
    new Set(),
    async () => Response.json({ success: true }),
    () => time,
  );
  time = 49_000.5;
  expect(
    (
      await http.request('http://127.0.0.1:3005/api/auth/sign-out', {
        method: 'POST',
        redirect: 'error',
      })
    ).status,
  ).toBe(200);
});
