// The security checks in front of the real routes: the port of the old app's
// `test_security.py`. `security.test.ts` tests the checks on their own.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { proxySchema } from '../lib/api/schemas.ts';
import { expectError, expectJson } from './testing/api-client.ts';
import { addProxy, createFlow } from './testing/api-flow.ts';
import type { Flow } from './testing/api-flow.ts';

let flow: Flow;
beforeEach(() => {
  flow = createFlow();
});
afterEach(() => flow.close());

async function proxyIds() {
  const response = await flow.client.get('/api/proxies');
  return (await expectJson(response, 200, z.array(proxySchema))).map(
    (p) => p.id,
  );
}

describe('the Host header', () => {
  it.each([
    'evil.example:3004',
    '127.0.0.1:9999',
    '127.0.0.1',
    '192.168.1.10:3004',
  ])('refuses a request that addresses the app as %s', async (host) => {
    const response = await flow.client.get('/api/meta', {
      headers: { Host: host },
    });
    await expectError(response, 403, 'forbidden_host');
  });

  it.each(['127.0.0.1:3004', 'localhost:3004'])(
    'accepts a request that addresses the app as %s',
    async (host) => {
      const response = await flow.client.get('/api/meta', {
        headers: { Host: host },
      });
      expect(response.status).toBe(200);
    },
  );
});

describe('the Origin of a state change', () => {
  it.each([
    'http://evil.example',
    'http://127.0.0.1:9999',
    'null',
    'https://127.0.0.1:3004',
  ])('refuses one from %s, and changes nothing', async (origin) => {
    const response = await flow.client.post(
      '/api/proxies',
      { proxy: '192.0.2.1:8080' },
      { headers: { Origin: origin } },
    );
    await expectError(response, 403, 'forbidden_origin');
    expect(await proxyIds()).toEqual([]);
  });

  it('accepts the app’s own origin, and none', async () => {
    for (const origin of ['http://127.0.0.1:3004', undefined]) {
      const response = await flow.client.post(
        '/api/proxies/import',
        { text: '192.0.2.1:8080' },
        { headers: origin === undefined ? {} : { Origin: origin } },
      );
      expect(response.status).toBe(200);
    }
    const localhost = await flow.client.post(
      '/api/proxies/check-all',
      undefined,
      {
        headers: { Host: 'localhost:3004', Origin: 'http://localhost:3004' },
      },
    );
    expect(localhost.status).toBe(202);
  });

  it.each<[string, string | undefined]>([
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['no Content-Type', undefined],
  ])('refuses a body sent with %s', async (_name, contentType) => {
    const response = await flow.client.call('POST', '/api/proxies', {
      raw: '{"proxy": "192.0.2.1:8080"}',
      headers: contentType === undefined ? {} : { 'Content-Type': contentType },
    });
    await expectError(response, 403, 'forbidden_origin');
    expect(await proxyIds()).toEqual([]);
  });

  it('checks only the origin of a delete, which has no body', async () => {
    const proxy = await addProxy(flow.client, '192.0.2.1:8080');
    const foreign = await flow.client.delete(`/api/proxies/${proxy.id}`, {
      headers: { Origin: 'http://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect(await proxyIds()).toEqual([proxy.id]);
    expect((await flow.client.delete(`/api/proxies/${proxy.id}`)).status).toBe(
      204,
    );
  });

  it('does not check the origin of a read', async () => {
    // The browser's same-origin policy already keeps other sites from reading the answer.
    const response = await flow.client.get('/api/sessions', {
      headers: { Origin: 'http://evil.example' },
    });
    expect(response.status).toBe(200);
  });
});
