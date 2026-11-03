import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  importResultSchema,
  proxySchema,
  sessionRefSchema,
} from '../../../lib/api/schemas.ts';
import { MAX_PROXY_IMPORT, MAX_PROXY_LINE } from '../../../lib/proxy-limits.ts';
import {
  importResult,
  proxy,
  sessionRef,
} from '../../../tests/utils/fixtures.ts';
import { AppError } from '../../errors.ts';
import {
  expectError,
  expectJson,
  stubbedApi,
} from '../../testing/api-client.ts';
import type { Manager } from '../sessions/manager.ts';

const proxies = z.array(proxySchema);

describe('GET /api/proxies', () => {
  function listing(list = [proxy()], total = list.length) {
    const listProxies = vi.fn<Manager['listProxies']>(() => list);
    const countProxies = vi.fn<Manager['countProxies']>(() => total);
    return {
      listProxies,
      countProxies,
      ...stubbedApi({ listProxies, countProxies }),
    };
  }

  it('answers the proxies the manager lists and the size of the whole list', async () => {
    const list = [proxy({ id: 2 }), proxy({ id: 1, session: sessionRef() })];
    const { client } = listing(list, 7);
    const response = await client.get('/api/proxies');
    expect(await expectJson(response, 200, proxies)).toEqual(list);
    expect(response.headers.get('X-Total-Count')).toBe('7');
  });

  it('counts an empty list too', async () => {
    const { client } = listing([], 0);
    const response = await client.get('/api/proxies');
    expect(await expectJson(response, 200, proxies)).toEqual([]);
    expect(response.headers.get('X-Total-Count')).toBe('0');
  });

  it('asks for the whole list without parameters', async () => {
    const { client, listProxies } = listing();
    await client.get('/api/proxies');
    expect(listProxies).toHaveBeenCalledExactlyOnceWith({});
  });

  it('asks for the page the parameters name', async () => {
    const { client, listProxies } = listing();
    await client.get('/api/proxies', {
      query: { limit: 3, before: 10, minId: 2 },
    });
    expect(listProxies).toHaveBeenCalledExactlyOnceWith({
      limit: 3,
      before: 10,
      minId: 2,
    });
  });

  it.each<Record<string, string | number>>([
    { limit: 0 },
    { limit: 501 },
    { limit: 'ten' },
    { limit: '' },
    { limit: 1.5 },
    { before: 0 },
    { minId: -1 },
    { before: '9223372036854775808' },
    { before: Number.MAX_SAFE_INTEGER + 1 },
    { minId: 1.5 },
  ])('refuses the parameters %j with a 422', async (query) => {
    const { client, listProxies } = listing();
    const response = await client.get('/api/proxies', { query });
    await expectError(response, 422, 'validation_error');
    expect(listProxies).not.toHaveBeenCalled();
  });

  it('accepts the largest values there are', async () => {
    const { client, listProxies } = listing();
    const query = { limit: 500, before: Number.MAX_SAFE_INTEGER, minId: 1 };
    expect((await client.get('/api/proxies', { query })).status).toBe(200);
    expect(listProxies).toHaveBeenCalledExactlyOnceWith(query);
  });
});

describe('POST /api/proxies', () => {
  function adding(added = proxy({ id: 5 })) {
    const addProxy = vi.fn<Manager['addProxy']>(() => added);
    return { addProxy, ...stubbedApi({ addProxy }) };
  }

  it('answers 201 with the proxy, which has no password', async () => {
    const added = proxy({
      id: 5,
      username: 'user',
      hasPassword: true,
      display: 'http://user@192.0.2.1:8080',
      check: {
        status: 'checking',
        ok: null,
        exitIp: null,
        country: null,
        latencyMs: null,
        checkedAt: null,
        error: null,
      },
    });
    const { client, addProxy } = adding(added);
    const response = await client.post('/api/proxies', {
      proxy: 'user:hunter2@192.0.2.1:8080',
    });
    const body = await expectJson(response, 201, proxySchema);
    expect(body).toEqual(added);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(addProxy).toHaveBeenCalledExactlyOnceWith(
      'user:hunter2@192.0.2.1:8080',
      { defaultScheme: 'http' },
    );
  });

  it.each(['http', 'https', 'socks5'])(
    'hands over the default scheme %s',
    async (defaultScheme) => {
      const { client, addProxy } = adding();
      await client.post('/api/proxies', {
        proxy: '192.0.2.1:1080',
        defaultScheme,
      });
      expect(addProxy).toHaveBeenCalledExactlyOnceWith('192.0.2.1:1080', {
        defaultScheme,
      });
    },
  );

  it.each([
    ['no proxy', { defaultScheme: 'http' }, 'proxy: Field required'],
    [
      'a proxy that is no text',
      { proxy: 80 },
      'proxy: Invalid input: expected string, received number',
    ],
    [
      'a scheme that is none of them',
      { proxy: 'x', defaultScheme: 'ftp' },
      'defaultScheme: ',
    ],
  ])(
    'refuses %s with a 422 before the manager is asked',
    async (_name, body, message) => {
      const { client, addProxy } = adding();
      const response = await client.post('/api/proxies', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message.startsWith(message)).toBe(true);
      expect(addProxy).not.toHaveBeenCalled();
    },
  );

  it('refuses a line longer than a proxy can be with a 422 that names the field, before the manager is asked', async () => {
    const { client, addProxy } = adding();
    const response = await client.post('/api/proxies', {
      proxy: `user:hunter2@${'a'.repeat(MAX_PROXY_LINE)}`,
    });
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toBe(
      `proxy: Too big: expected at most ${MAX_PROXY_LINE} characters`,
    );
    expect(JSON.stringify(error)).not.toContain('hunter2');
    expect(addProxy).not.toHaveBeenCalled();
  });

  it('answers the 409 duplicate with the proxy that is there', async () => {
    const { client } = stubbedApi({
      addProxy: () => {
        throw new AppError(409, 'duplicate', 'This proxy already exists.', {
          existingId: 3,
        });
      },
    });
    const response = await client.post('/api/proxies', {
      proxy: '192.0.2.1:80',
    });
    const error = await expectError(response, 409, 'duplicate');
    expect(error.existingId).toBe(3);
  });

  it('answers the 422 invalid_proxy with the reason and its values', async () => {
    const { client } = stubbedApi({
      addProxy: () => {
        throw new AppError(422, 'invalid_proxy', 'Invalid proxy: bad port.', {
          reason: 'invalid_port_value',
          params: { port: 99999 },
        });
      },
    });
    const response = await client.post('/api/proxies', {
      proxy: '192.0.2.1:99999@user:hunter2',
    });
    const error = await expectError(response, 422, 'invalid_proxy');
    expect(error.reason).toBe('invalid_port_value');
    expect(error.params).toEqual({ port: 99999 });
    expect(JSON.stringify(error)).not.toContain('hunter2');
  });
});

describe('POST /api/proxies/import', () => {
  function importing(result = importResult()) {
    const importProxies = vi.fn<Manager['importProxies']>(() => result);
    return { importProxies, ...stubbedApi({ importProxies }) };
  }

  it('answers 200 with what was added, was a duplicate and could not be read', async () => {
    const result = importResult({
      added: [proxy({ id: 7 })],
      duplicates: [
        { line: 2, display: 'http://someuser@10.20.30.40:6000', existingId: 1 },
      ],
      errors: [
        {
          line: 5,
          input: '10.0.0.1:99999:***:***',
          message: 'invalid port 99999 (must be 1-65535)',
          code: 'invalid_port_value',
          params: { port: 99999 },
        },
      ],
      summary: 'Added 1, 1 duplicate, 1 error',
    });
    const { client } = importing(result);
    const response = await client.post('/api/proxies/import', { text: 'x' });
    expect(await expectJson(response, 200, importResultSchema)).toEqual(result);
  });

  it('hands over the text as it is, with the default scheme', async () => {
    const { client, importProxies } = importing();
    const text = '﻿63.246.153.230:5899:someuser:somepass\r\n# comment\r\n';
    await client.post('/api/proxies/import', { text });
    await client.post('/api/proxies/import', {
      text: '192.0.2.1:1080\n',
      defaultScheme: 'socks5',
    });
    expect(importProxies.mock.calls).toEqual([
      [text, { defaultScheme: 'http' }],
      ['192.0.2.1:1080\n', { defaultScheme: 'socks5' }],
    ]);
  });

  it('takes a list of thousands of proxies', async () => {
    const { client, importProxies } = importing();
    const text = Array.from(
      { length: 5000 },
      (_, n) => `10.${n >> 8}.${n & 255}.1:8080:user:pass`,
    ).join('\n');
    const response = await client.post('/api/proxies/import', { text });
    expect(response.status).toBe(200);
    expect(importProxies.mock.calls[0]?.[0]).toBe(text);
  });

  it('refuses a list of more than a million characters with a 422, before the manager is asked', async () => {
    const { client, importProxies } = importing();
    const response = await client.post('/api/proxies/import', {
      text: 'x'.repeat(MAX_PROXY_IMPORT + 1),
    });
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toMatch(/^text: Too big/);
    expect(importProxies).not.toHaveBeenCalled();
  });

  it('refuses a request without text', async () => {
    const { client, importProxies } = importing();
    const response = await client.post('/api/proxies/import', {});
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toBe('text: Field required');
    expect(importProxies).not.toHaveBeenCalled();
  });
});

describe('POST /api/proxies/check-all', () => {
  it('answers 202 with every proxy, which is being checked', async () => {
    const list = [proxy({ id: 2 }), proxy({ id: 1 })];
    const checkAllProxies = vi.fn<Manager['checkAllProxies']>(() => list);
    const { client } = stubbedApi({ checkAllProxies });
    const response = await client.post('/api/proxies/check-all');
    expect(await expectJson(response, 202, proxies)).toEqual(list);
    expect(checkAllProxies).toHaveBeenCalledOnce();
  });
});

describe('POST /api/proxies/:id/check', () => {
  it('answers 202 with the proxy, which is being checked', async () => {
    const checking = proxy({ id: 4 });
    const checkProxy = vi.fn<Manager['checkProxy']>(() => checking);
    const { client } = stubbedApi({ checkProxy });
    const response = await client.post('/api/proxies/4/check');
    expect(await expectJson(response, 202, proxySchema)).toEqual(checking);
    expect(checkProxy).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('passes on the 404 of a proxy that does not exist', async () => {
    const { client } = stubbedApi({
      checkProxy: () => {
        throw new AppError(404, 'proxy_not_found', 'Proxy 99 does not exist.');
      },
    });
    await expectError(
      await client.post('/api/proxies/99/check'),
      404,
      'proxy_not_found',
    );
  });
});

describe('DELETE /api/proxies/:id', () => {
  function deleting() {
    const deleteProxy = vi.fn<Manager['deleteProxy']>();
    return { deleteProxy, ...stubbedApi({ deleteProxy }) };
  }

  it('answers 204 with no body', async () => {
    const { client, deleteProxy } = deleting();
    const response = await client.delete('/api/proxies/3');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(deleteProxy).toHaveBeenCalledExactlyOnceWith(3, { force: false });
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
  ])('reads force=%s', async (force, expected) => {
    const { client, deleteProxy } = deleting();
    await client.delete('/api/proxies/3', { query: { force } });
    expect(deleteProxy).toHaveBeenCalledExactlyOnceWith(3, { force: expected });
  });

  it('refuses a force that is no flag', async () => {
    const { client, deleteProxy } = deleting();
    const response = await client.delete('/api/proxies/3', {
      query: { force: 'sure' },
    });
    await expectError(response, 422, 'validation_error');
    expect(deleteProxy).not.toHaveBeenCalled();
  });

  it.each([
    ['proxy_busy', 'A session is using this proxy right now.'],
    ['proxy_in_use', 'A session uses this proxy.'],
  ])(
    'answers the 409 %s with the session that has the proxy',
    async (code, message) => {
      const holder = sessionRef({ id: 2, name: 'a', status: 'running' });
      const { client } = stubbedApi({
        deleteProxy: () => {
          throw new AppError(409, code, message, { session: holder });
        },
      });
      const error = await expectError(
        await client.delete('/api/proxies/3', { query: { force: true } }),
        409,
        code,
      );
      expect(sessionRefSchema.parse(error.session)).toEqual(holder);
    },
  );

  it('passes on the 404 of a proxy that does not exist', async () => {
    const { client } = stubbedApi({
      deleteProxy: () => {
        throw new AppError(404, 'proxy_not_found', 'Proxy 99 does not exist.');
      },
    });
    await expectError(
      await client.delete('/api/proxies/99'),
      404,
      'proxy_not_found',
    );
  });
});

describe('the id of a proxy in the path', () => {
  const routes: Array<[string, string]> = [
    ['DELETE', ''],
    ['POST', '/check'],
  ];

  it.each(routes)(
    '%s: text that is not a whole number is a 422',
    async (method, suffix) => {
      const { client } = stubbedApi();
      // `import` and `check-all` are routes of POST /api/proxies, not ids.
      for (const id of ['abc', '1.5', 'check-all', 'import']) {
        const response = await client.call(
          method,
          `/api/proxies/${id}${suffix}`,
        );
        const error = await expectError(response, 422, 'validation_error');
        expect(error.message).toMatch(/^id: Input should be a valid integer/);
      }
    },
  );

  it.each(routes)(
    '%s: an id no row can have is a 404, without asking the manager',
    async (method, suffix) => {
      const { client } = stubbedApi();
      for (const id of ['0', '-1', '100000000000000000000']) {
        const response = await client.call(
          method,
          `/api/proxies/${id}${suffix}`,
        );
        const error = await expectError(response, 404, 'proxy_not_found');
        expect(error.message).toBe(`Proxy ${id} does not exist.`);
      }
    },
  );
});
