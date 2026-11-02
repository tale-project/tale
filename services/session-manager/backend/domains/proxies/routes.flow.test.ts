// The proxy routes over the real manager and the fake browser: the port of the
// proxy parts of the old app's `test_api.py`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  importResultSchema,
  proxySchema,
  sessionSchema,
} from '../../../lib/api/schemas.ts';
import { expectError, expectJson } from '../../testing/api-client.ts';
import {
  addProxy,
  createFlow,
  createSession,
  getSession,
  waitForChecks,
  waitForStatus,
} from '../../testing/api-flow.ts';
import type { Flow } from '../../testing/api-flow.ts';

const proxies = z.array(proxySchema);

const WEBSHARE_EXPORT =
  '﻿63.246.153.230:5899:someuser:somepass\r\n10.20.30.40:6000:someuser:somepass\r\n';

let flow: Flow;
beforeEach(() => {
  flow = createFlow();
});
afterEach(() => flow.close());

async function listProxies(query: Record<string, number> = {}) {
  const response = await flow.client.get('/api/proxies', { query });
  const list = await expectJson(response, 200, proxies);
  return { ids: list.map((proxy) => proxy.id), list, response };
}

async function idsAndTotal(query: Record<string, number> = {}) {
  const { ids, response } = await listProxies(query);
  return [ids, Number(response.headers.get('X-Total-Count'))];
}

describe('adding a proxy', () => {
  it('checks it in the background and never returns its password', async () => {
    const gate = flow.checker.hold(); // checks hang until released: adding must not wait for them
    const proxy = await addProxy(flow.client, 'user:hunter2@192.0.2.1:8080');
    expect(proxy.display).toBe('http://user@192.0.2.1:8080');
    expect([proxy.username, proxy.hasPassword, proxy.session]).toEqual([
      'user',
      true,
      null,
    ]);
    expect(proxy).not.toHaveProperty('label');
    expect(proxy.check).toEqual({
      status: 'checking',
      ok: null,
      exitIp: null,
      country: null,
      latencyMs: null,
      checkedAt: null,
      error: null,
    });
    const meta = await flow.client.get('/api/meta');
    expect((await meta.json()).counts.checkingProxies).toBe(1);

    gate.release();
    await waitForChecks(flow);
    const response = await flow.client.get('/api/proxies');
    const [checked] = await expectJson(response, 200, proxies);
    expect([checked?.check.status, checked?.check.exitIp]).toEqual([
      'ok',
      '203.0.113.1',
    ]);
    expect(JSON.stringify(checked)).not.toContain('hunter2');
  });

  it('refuses a duplicate, an unreadable proxy and a missing one', async () => {
    const first = await addProxy(
      flow.client,
      'http://user:hunter2@192.0.2.1:8080',
    );
    const duplicate = await flow.client.post('/api/proxies', {
      proxy: '192.0.2.1:8080:user:hunter2',
      defaultScheme: 'socks5',
    });
    const refusal = await expectError(duplicate, 409, 'duplicate');
    expect(refusal.existingId).toBe(first.id);

    const invalid = await flow.client.post('/api/proxies', {
      proxy: '192.0.2.1:99999@user:hunter2',
    });
    const unreadable = await expectError(invalid, 422, 'invalid_proxy');
    expect(JSON.stringify(unreadable)).not.toContain('hunter2');
    expect(typeof unreadable.reason).toBe('string');

    const missing = await flow.client.post('/api/proxies', {
      defaultScheme: 'http',
    });
    await expectError(missing, 422, 'validation_error');

    await waitForChecks(flow);
    expect(flow.checker.calls).toHaveLength(1); // the duplicate was not checked again
  });
});

describe('importing proxies', () => {
  it('reports what was added, what was a duplicate and what could not be read, masked', async () => {
    const existing = await addProxy(
      flow.client,
      '10.20.30.40:6000:someuser:somepass',
    );
    await waitForChecks(flow);
    const gate = flow.checker.hold();
    const text = `${WEBSHARE_EXPORT}# comment\r\n\r\n10.0.0.1:99999:someuser:hunter2\r\n63.246.153.230:5899:someuser:somepass\r\n`;

    const response = await flow.client.post('/api/proxies/import', { text });
    const result = await expectJson(response, 200, importResultSchema);

    expect(result.added.map((p) => [p.display, p.check.status])).toEqual([
      ['http://someuser@63.246.153.230:5899', 'checking'],
    ]);
    const firstId = result.added[0]?.id;
    expect(result.duplicates).toEqual([
      {
        line: 2,
        display: 'http://someuser@10.20.30.40:6000',
        existingId: existing.id,
      },
      {
        line: 6,
        display: 'http://someuser@63.246.153.230:5899',
        existingId: firstId,
      },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      line: 5,
      input: '10.0.0.1:99999:***:***',
      message: 'invalid port 99999 (must be 1-65535)',
    });
    expect(result.summary).toBe('Added 1, 2 duplicates, 1 error');
    expect(JSON.stringify(result)).not.toContain('hunter2');

    gate.release();
    await waitForChecks(flow);
    // Each is checked once.
    expect(flow.checker.calls.map((call) => call.host)).toEqual([
      '10.20.30.40',
      '63.246.153.230',
    ]);

    const again = await flow.client.post('/api/proxies/import', {
      text: WEBSHARE_EXPORT,
    });
    const repeated = await expectJson(again, 200, importResultSchema);
    expect([repeated.added, repeated.summary]).toEqual([
      [],
      'Added 0, 2 duplicates, 0 errors',
    ]);
  });

  it('takes the default scheme for lines that do not name one', async () => {
    const response = await flow.client.post('/api/proxies/import', {
      text: '192.0.2.1:1080\n',
      defaultScheme: 'socks5',
    });
    const result = await expectJson(response, 200, importResultSchema);
    expect(result.added[0]?.scheme).toBe('socks5');
  });
});

describe('checking proxies', () => {
  it('stores a success and a failure', async () => {
    const proxy = await addProxy(flow.client, '192.0.2.1:8080');
    await waitForChecks(flow);
    flow.checker.setIp('192.0.2.1:8080', '198.51.100.7', 'CH');
    const started = await flow.client.post(`/api/proxies/${proxy.id}/check`);
    const checking = await expectJson(started, 202, proxySchema);
    expect(checking.check.status).toBe('checking');
    await waitForChecks(flow);
    const [stored] = (await listProxies()).list;
    expect(stored?.check).toMatchObject({
      status: 'ok',
      ok: true,
      exitIp: '198.51.100.7',
      country: 'CH',
      latencyMs: 42,
      error: null,
    });
    expect(stored?.check.checkedAt).toBeTruthy();

    flow.checker.setError('192.0.2.1:8080', 'cannot connect to the proxy');
    await flow.client.post(`/api/proxies/${proxy.id}/check`);
    await waitForChecks(flow);
    const [failed] = (await listProxies()).list;
    expect(failed?.check).toMatchObject({
      status: 'failed',
      ok: false,
      error: 'cannot connect to the proxy',
      exitIp: '198.51.100.7', // from the last successful check
      latencyMs: null,
    });
    await expectError(
      await flow.client.post('/api/proxies/99/check'),
      404,
      'proxy_not_found',
    );
  });

  it('checks all in the background, and never one twice at once', async () => {
    for (const n of [1, 2, 3]) await addProxy(flow.client, `192.0.2.${n}:8080`);
    await waitForChecks(flow);
    flow.checker.setError('192.0.2.2:8080', 'boom');
    const calls = flow.checker.calls.length;
    const gate = flow.checker.hold();
    const one = await flow.client.post('/api/proxies/1/check');
    expect(one.status).toBe(202);
    const response = await flow.client.post('/api/proxies/check-all');
    const all = await expectJson(response, 202, proxies);
    expect(all.map((proxy) => proxy.check.status)).toEqual([
      'checking',
      'checking',
      'checking',
    ]);

    gate.release();
    await waitForChecks(flow);
    // Proxy 1 was already being checked.
    expect(flow.checker.calls.length - calls).toBe(3);
    const { list } = await listProxies();
    expect(list.map((proxy) => proxy.check.status)).toEqual([
      'ok',
      'failed',
      'ok',
    ]);
  });
});

describe('deleting a proxy', () => {
  it('asks before taking one from a session, and not at all while it runs', async () => {
    const proxy = await addProxy(flow.client, '192.0.2.1:8080');
    const spare = await addProxy(flow.client, '192.0.2.2:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');

    const busy = await flow.client.delete(`/api/proxies/${proxy.id}`, {
      query: { force: true },
    });
    const running = await expectError(busy, 409, 'proxy_busy');
    expect(running.session).toEqual({
      id: session.id,
      name: 'a',
      status: 'running',
    });

    await flow.client.post(`/api/sessions/${session.id}/stop`);
    await waitForStatus(flow, session.id, 'stopped');
    const inUse = await flow.client.delete(`/api/proxies/${proxy.id}`);
    const stopped = await expectError(inUse, 409, 'proxy_in_use');
    expect(stopped.session).toEqual({
      id: session.id,
      name: 'a',
      status: 'stopped',
    });

    const forced = await flow.client.delete(`/api/proxies/${proxy.id}`, {
      query: { force: true },
    });
    expect(forced.status).toBe(204);
    expect((await getSession(flow.client, session.id)).proxy).toBeNull();
    // Free: no questions.
    expect((await flow.client.delete(`/api/proxies/${spare.id}`)).status).toBe(
      204,
    );
    expect((await listProxies()).list).toEqual([]);
    await expectError(
      await flow.client.delete('/api/proxies/99'),
      404,
      'proxy_not_found',
    );
  });
});

describe('listing proxies', () => {
  it('lists the newest first, in pages', async () => {
    const ids: number[] = [];
    for (let n = 1; n <= 7; n++) {
      ids.push((await addProxy(flow.client, `192.0.2.${n}:8080`)).id);
    }
    const newestFirst = [...ids].reverse();
    // No parameters: everything.
    expect(await idsAndTotal()).toEqual([newestFirst, 7]);

    // Pages: the next one starts below the smallest id loaded so far; a short page is the last one.
    expect(await idsAndTotal({ limit: 3 })).toEqual([
      newestFirst.slice(0, 3),
      7,
    ]);
    expect(
      await idsAndTotal({ before: newestFirst[2] ?? 0, limit: 3 }),
    ).toEqual([newestFirst.slice(3, 6), 7]);
    expect(
      await idsAndTotal({ before: newestFirst[5] ?? 0, limit: 3 }),
    ).toEqual([newestFirst.slice(6), 7]);
    expect(await idsAndTotal({ before: ids[0] ?? 0, limit: 3 })).toEqual([
      [],
      7,
    ]);
    expect(await idsAndTotal({ before: (ids.at(-1) ?? 0) + 100 })).toEqual([
      newestFirst,
      7,
    ]);

    // A refresh of the loaded rows: new rows come first, deleted ones are gone, older ones are not included.
    const added = (await addProxy(flow.client, '192.0.2.8:8080')).id;
    const deleted = await flow.client.delete(`/api/proxies/${newestFirst[1]}`);
    expect(deleted.status).toBe(204);
    expect(await idsAndTotal({ minId: newestFirst[2] ?? 0 })).toEqual([
      [added, newestFirst[0], newestFirst[2]],
      7,
    ]);
    expect(await idsAndTotal({ minId: added + 1 })).toEqual([[], 7]);
    expect(
      await idsAndTotal({ minId: ids[2] ?? 0, before: added, limit: 2 }),
    ).toEqual([[newestFirst[0], newestFirst[2]], 7]);
  });

  it('checks its parameters', async () => {
    const refused: Array<Record<string, string | number>> = [
      { limit: 0 },
      { limit: 501 },
      { limit: 'ten' },
      { before: 0 },
      { minId: -1 },
      { before: Number.MAX_SAFE_INTEGER + 1 },
      { before: '9223372036854775808' },
      { minId: 1.5 },
    ];
    for (const query of refused) {
      const response = await flow.client.get('/api/proxies', { query });
      await expectError(response, 422, 'validation_error');
    }
    const largest = {
      limit: 500,
      before: Number.MAX_SAFE_INTEGER,
      minId: 1,
    };
    const response = await flow.client.get('/api/proxies', { query: largest });
    expect(response.status).toBe(200);
  });

  it('names the session that has the exit IP of a proxy it cannot be given', async () => {
    flow.checker.setIp('192.0.2.1:8080', '203.0.113.9');
    flow.checker.setIp('192.0.2.2:8080', '203.0.113.9'); // e.g. two credentials for one sticky session
    const used = (await addProxy(flow.client, '192.0.2.1:8080')).id;
    const twin = (await addProxy(flow.client, '192.0.2.2:8080')).id;
    const other = (await addProxy(flow.client, '192.0.2.3:8080')).id;
    await waitForChecks(flow);
    const session = await createSession(flow.client, 'a');
    const running = await waitForStatus(flow, session.id, 'running');
    expect(running.proxy?.id).toBe(used);

    const byId = new Map(
      (await listProxies()).list.map((proxy) => [proxy.id, proxy]),
    );
    expect(byId.get(used)?.session?.name).toBe('a');
    expect(byId.get(used)?.sameIpAs).toBeNull();
    expect(byId.get(twin)?.session).toBeNull();
    expect(byId.get(twin)?.sameIpAs).toEqual({
      id: session.id,
      name: 'a',
      status: 'running',
    });
    expect([byId.get(other)?.session, byId.get(other)?.sameIpAs]).toEqual([
      null,
      null,
    ]);
    // Also in a page without the used proxy.
    const page = await listProxies({ minId: twin, before: twin + 1 });
    expect(page.list).toHaveLength(1);
    expect(page.list[0]?.sameIpAs?.name).toBe('a');
  });

  it('is of the shape the page reads: a session in the list is a session of the contract', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    await waitForChecks(flow);
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    const response = await flow.client.get(`/api/sessions/${session.id}`);
    await expectJson(response, 200, sessionSchema);
    const { list } = await listProxies();
    expect(list[0]?.session).toEqual({
      id: session.id,
      name: 'a',
      status: 'running',
    });
  });
});
