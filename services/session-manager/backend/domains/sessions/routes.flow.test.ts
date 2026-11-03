// The session routes over the real manager and the fake browser: the port of
// the session parts of the old app's `test_api.py`.

import {
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  metaSchema,
  proxyExportSchema,
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
import { Gate } from '../../testing/fake-browser.ts';

const sessions = z.array(sessionSchema);
const proxies = z.array(proxySchema);

let flow: Flow;
beforeEach(() => {
  flow = createFlow();
});
afterEach(() => flow.close());

async function meta() {
  return expectJson(await flow.client.get('/api/meta'), 200, metaSchema);
}

async function listProxies() {
  return expectJson(await flow.client.get('/api/proxies'), 200, proxies);
}

async function idsAndTotal(query: Record<string, number> = {}) {
  const response = await flow.client.get('/api/sessions', { query });
  const list = await expectJson(response, 200, sessions);
  return [list.map((s) => s.id), Number(response.headers.get('X-Total-Count'))];
}

describe('creating a session', () => {
  it('assigns a proxy and starts in the background', async () => {
    const proxy = await addProxy(flow.client, 'user:pw@192.0.2.1:8080');
    const created = await createSession(flow.client, '  Shop  ', {
      os: 'linux',
    });
    expect([created.name, created.os, created.proxy]).toEqual([
      'Shop',
      'linux',
      null,
    ]);
    expect([
      created.status,
      created.activity,
      created.error,
      created.errorCode,
    ]).toEqual(['starting', 'assigning_proxy', null, null]);
    expect(created.errorExtra).toBeNull();
    expect(created.fingerprint).toMatchObject({
      userAgent: 'FakeAgent/1',
      screen: '1920x1080',
      gpu: 'Fake GPU',
      locale: null,
      timezone: null,
    });
    expect(created.createdAt).toBeTruthy();
    expect(created.lastStartedAt).toBeNull();
    expect(created).not.toHaveProperty('startError');

    const running = await waitForStatus(flow, created.id, 'running');
    expect(running.proxy).toEqual({
      id: proxy.id,
      display: 'http://user@192.0.2.1:8080',
      exitIp: '203.0.113.1',
      country: 'US',
      checkStatus: 'ok',
    });
    expect([running.fingerprint.locale, running.fingerprint.timezone]).toEqual([
      'en-US',
      'America/New_York',
    ]);
    expect(running.lastStartedAt).toBeTruthy();
    const [browser] = flow.backend.launches;
    // The local bridge, with no credentials.
    expect(browser?.spec.proxy.server.startsWith('http://127.0.0.1:')).toBe(
      true,
    );
    expect(Object.keys(browser?.spec.proxy ?? {})).toEqual(['server']);
    expect(browser?.spec.location.ip).toBe('203.0.113.1');
    expect(browser?.spec.profileDir).toBe(
      join(flow.dataDir, 'profiles', String(created.id)),
    );
    expect((await listProxies())[0]?.session).toEqual({
      id: created.id,
      name: 'Shop',
      status: 'running',
    });
    const counts = (await meta()).counts;
    expect([counts.running, counts.freeProxies]).toEqual([1, 0]);
  });

  it('numbers a session that has no name, and picks a system when there is none', async () => {
    for (const n of [1, 2]) await addProxy(flow.client, `192.0.2.${n}:8080`);
    const first = await flow.client.post('/api/sessions', {});
    const created = await expectJson(first, 201, sessionSchema);
    expect(created.name).toBe('0001');
    expect(['windows', 'macos', 'linux']).toContain(created.os);
    expect((await createSession(flow.client, '   ')).name).toBe('0002');
    expect((await meta()).nextSessionName).toBe('0003');
  });

  it('creates nothing when it is refused', async () => {
    const noProxy = await flow.client.post('/api/sessions', {});
    await expectError(noProxy, 409, 'no_free_proxy');

    await addProxy(flow.client, '192.0.2.1:8080');
    await createSession(flow.client, 'a');
    const taken = await flow.client.post('/api/sessions', { name: 'A' });
    await expectError(taken, 409, 'name_taken');
    const allTaken = await flow.client.post('/api/sessions', { name: 'b' });
    await expectError(allTaken, 409, 'no_free_proxy');

    await addProxy(flow.client, '192.0.2.2:8080');
    const invalid = await flow.client.post('/api/sessions', {
      name: 'x'.repeat(81),
    });
    await expectError(invalid, 422, 'invalid_name');
    const withBreak = await flow.client.post('/api/sessions', {
      name: 'two\nlines',
    });
    await expectError(withBreak, 422, 'invalid_name');
    const withNul = await flow.client.post('/api/sessions', {
      name: 'nul\u0000inside',
    });
    await expectError(withNul, 422, 'invalid_name');
    const badOs = await flow.client.post('/api/sessions', {
      name: 'c',
      os: 'android',
    });
    await expectError(badOs, 422, 'validation_error');
    flow.backend.installed = false;
    expect((await meta()).browserInstalled).toBe(false);
    const notInstalled = await flow.client.post('/api/sessions', {});
    await expectError(notInstalled, 503, 'browser_not_installed');
    const list = await expectJson(
      await flow.client.get('/api/sessions'),
      200,
      sessions,
    );
    expect(list.map((s) => s.name)).toEqual(['a']);
  });
});

describe('renaming a session', () => {
  it('works in any status', async () => {
    for (const n of [1, 2]) await addProxy(flow.client, `192.0.2.${n}:8080`);
    const a = await createSession(flow.client, 'a');
    const b = await createSession(flow.client, 'b');
    await waitForStatus(flow, a.id, 'running');
    const response = await flow.client.patch(`/api/sessions/${a.id}`, {
      name: ' renamed ',
    });
    const renamed = await expectJson(response, 200, sessionSchema);
    expect([renamed.name, renamed.status]).toEqual(['renamed', 'running']);

    const taken = await flow.client.patch(`/api/sessions/${b.id}`, {
      name: 'RENAMED',
    });
    await expectError(taken, 409, 'name_taken');
    const empty = await flow.client.patch(`/api/sessions/${b.id}`, {
      name: ' ',
    });
    await expectError(empty, 422, 'invalid_name');
    const missing = await flow.client.patch('/api/sessions/99', { name: 'x' });
    await expectError(missing, 404, 'session_not_found');
  });

  it('gives the browser the name at each start', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    await flow.client.patch(`/api/sessions/${session.id}`, { name: 'b' });
    await flow.client.post(`/api/sessions/${session.id}/stop`);
    await waitForStatus(flow, session.id, 'stopped');
    await flow.client.post(`/api/sessions/${session.id}/start`);
    await waitForStatus(flow, session.id, 'running');
    expect(flow.backend.launches.map((browser) => browser.spec.name)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('starting and stopping a session', () => {
  it('refuses a session that runs, stops it, and starts it with the proxy it has', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    const running = await waitForStatus(flow, session.id, 'running');
    const again = await flow.client.post(`/api/sessions/${session.id}/start`);
    await expectError(again, 409, 'session_running');

    const stop = await flow.client.post(`/api/sessions/${session.id}/stop`);
    const stopping = await expectJson(stop, 202, sessionSchema);
    expect(['stopping', 'stopped']).toContain(stopping.status);
    await waitForStatus(flow, session.id, 'stopped');
    expect(flow.backend.launches[0]?.closed).toBe(true);

    const start = await flow.client.post(
      `/api/sessions/${session.id}/start`,
      {},
    );
    const starting = await expectJson(start, 202, sessionSchema);
    // It has its proxy.
    expect([starting.status, starting.activity]).toEqual([
      'starting',
      'launching',
    ]);
    const restarted = await waitForStatus(flow, session.id, 'running');
    expect(restarted.proxy?.id).toBe(running.proxy?.id);
  });

  it('refuses to start without a browser installed', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    await flow.client.post(`/api/sessions/${session.id}/stop`);
    await waitForStatus(flow, session.id, 'stopped');
    flow.backend.installed = false;
    const response = await flow.client.post(
      `/api/sessions/${session.id}/start`,
    );
    await expectError(response, 503, 'browser_not_installed');
  });

  it('shows why a session fails: no working proxy', async () => {
    flow.checker.setError(
      '192.0.2.1:8080',
      'the proxy rejected the credentials',
    );
    const gate = flow.checker.hold();
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a'); // while the proxy's first check runs
    gate.release();
    const failed = await waitForStatus(flow, session.id, 'error');
    expect(flow.checker.calls).toHaveLength(1); // the assignment waited for that check
    expect([failed.errorCode, failed.proxy]).toEqual([
      'no_working_proxy',
      null,
    ]);
    expect(
      failed.error?.startsWith(
        'No working proxy available (1 failed their check).',
      ),
    ).toBe(true);
    expect(failed.errorExtra).toEqual({ failed: 1 });
    const retry = await flow.client.post(`/api/sessions/${session.id}/start`);
    await expectError(retry, 409, 'no_free_proxy');
  });

  it('answers 502 when the proxy of the session is unreachable, and shows it', async () => {
    const proxy = await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    await flow.client.post(`/api/sessions/${session.id}/stop`);
    await waitForStatus(flow, session.id, 'stopped');
    flow.checker.setError(
      '192.0.2.1:8080',
      'cannot connect to the proxy ([Errno 61] Connection refused)',
    );

    const response = await flow.client.post(
      `/api/sessions/${session.id}/start`,
    );

    const refusal = await expectError(response, 502, 'proxy_unreachable');
    expect(refusal.proxyId).toBe(proxy.id);
    expect(refusal.message).toContain('Connection refused');
    expect(refusal.reason).toBe(
      'cannot connect to the proxy ([Errno 61] Connection refused)',
    );
    const after = await getSession(flow.client, session.id);
    expect([after.status, after.errorCode]).toEqual([
      'error',
      'proxy_unreachable',
    ]);
    expect(after.errorExtra).toEqual({
      proxyId: proxy.id,
      reason: 'cannot connect to the proxy ([Errno 61] Connection refused)',
    });
    expect(
      after.error?.startsWith(
        'Its proxy is not working: cannot connect to the proxy',
      ),
    ).toBe(true);
    expect([after.proxy?.id, after.proxy?.checkStatus]).toEqual([
      proxy.id,
      'failed',
    ]);
  });

  it('refuses an exit IP that a running session uses, unless forced', async () => {
    for (const n of [1, 2]) await addProxy(flow.client, `192.0.2.${n}:8080`);
    const a = await createSession(flow.client, 'a');
    const b = await createSession(flow.client, 'b');
    await waitForStatus(flow, a.id, 'running');
    await waitForStatus(flow, b.id, 'running');
    await flow.client.post(`/api/sessions/${b.id}/stop`);
    await waitForStatus(flow, b.id, 'stopped');
    for (const n of [1, 2]) {
      // e.g. two credentials for one sticky session
      flow.checker.setIp(`192.0.2.${n}:8080`, '203.0.113.9');
    }
    await flow.client.post('/api/proxies/check-all');
    await waitForChecks(flow);

    const response = await flow.client.post(`/api/sessions/${b.id}/start`, {
      force: false,
    });

    const refusal = await expectError(response, 409, 'ip_in_use');
    expect(refusal.exitIp).toBe('203.0.113.9');
    expect(refusal.sessions).toEqual([
      { id: a.id, name: 'a', status: 'running' },
    ]);
    const forced = await flow.client.post(`/api/sessions/${b.id}/start`, {
      force: true,
    });
    expect(forced.status).toBe(202);
    await waitForStatus(flow, b.id, 'running');
  });

  it('shows a browser that exits as stopped and one that cannot launch as an error', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    flow.backend.launches[0]?.crash(); // e.g. the user quit the browser
    await waitForStatus(flow, session.id, 'stopped');

    flow.backend.launchError = new Error('Browser closed unexpectedly');
    await flow.client.post(`/api/sessions/${session.id}/start`);
    const failed = await waitForStatus(flow, session.id, 'error');
    expect([failed.error, failed.errorCode]).toEqual([
      'Browser closed unexpectedly',
      null,
    ]);
  });
});

describe('rotating a session', () => {
  it('gives it another proxy, in the background', async () => {
    const first = await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    const noFree = await flow.client.post(`/api/sessions/${session.id}/rotate`);
    await expectError(noFree, 409, 'no_free_proxy');

    const second = await addProxy(flow.client, '192.0.2.2:8080');
    flow.backend.geo = {
      country: 'CH',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    };
    const response = await flow.client.post(
      `/api/sessions/${session.id}/rotate`,
    );
    const rotating = await expectJson(response, 202, sessionSchema);
    expect([rotating.status, rotating.activity]).toEqual([
      'starting',
      'assigning_proxy',
    ]);
    const rotated = await waitForStatus(flow, session.id, 'running');
    expect(rotated.proxy?.id).toBe(second.id);
    expect(rotated.fingerprint.locale).toBe('de-CH');
    expect(
      (await listProxies())
        .filter((p) => p.id === first.id)
        .map((p) => p.session),
    ).toEqual([null]);

    await flow.client.post(`/api/sessions/${session.id}/stop`);
    await waitForStatus(flow, session.id, 'stopped');
    const gate = new Gate();
    flow.backend.launchGate = gate;
    await flow.client.post(`/api/sessions/${session.id}/start`); // launching until the gate opens
    const busy = await flow.client.post(`/api/sessions/${session.id}/rotate`);
    const refusal = await expectError(busy, 409, 'session_busy');
    expect(refusal.doing).toBe('starting');
    gate.open();
    await waitForStatus(flow, session.id, 'running');
    await expectError(
      await flow.client.post('/api/sessions/99/rotate'),
      404,
      'session_not_found',
    );
  });
});

describe('deleting a session', () => {
  it('stops it and removes its profile', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await waitForStatus(flow, session.id, 'running');
    const profile = join(flow.dataDir, 'profiles', String(session.id));
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'prefs.js'), '');

    const response = await flow.client.delete(`/api/sessions/${session.id}`);

    expect(response.status).toBe(204);
    expect(flow.backend.launches[0]?.closed).toBe(true);
    expect(existsSync(profile)).toBe(false);
    const list = await expectJson(
      await flow.client.get('/api/sessions'),
      200,
      sessions,
    );
    expect(list).toEqual([]);
    await expectError(
      await flow.client.delete(`/api/sessions/${session.id}`),
      404,
      'session_not_found',
    );
    expect((await meta()).counts.freeProxies).toBe(1);
  });

  it('never follows a symlink that is its profile', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    const outside = join(flow.dataDir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    mkdirSync(join(flow.dataDir, 'profiles'), { recursive: true });
    symlinkSync(outside, join(flow.dataDir, 'profiles', String(session.id)));

    const response = await flow.client.delete(`/api/sessions/${session.id}`);

    expect(response.status).toBe(204);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
});

describe('listing sessions', () => {
  it('lists the newest first, in pages', async () => {
    for (const n of [1, 2, 3, 4]) {
      await addProxy(flow.client, `192.0.2.${n}:8080`);
    }
    const ids: number[] = [];
    for (const name of ['a', 'b', 'c']) {
      ids.push((await createSession(flow.client, name)).id);
    }
    for (const id of ids) await waitForStatus(flow, id, 'running');
    const [a = 0, b = 0, c = 0] = ids;
    expect(await idsAndTotal()).toEqual([[c, b, a], 3]);
    expect(await idsAndTotal({ limit: 2 })).toEqual([[c, b], 3]);
    expect(await idsAndTotal({ before: b, limit: 2 })).toEqual([[a], 3]);

    const d = await createSession(flow.client, 'd');
    await waitForStatus(flow, d.id, 'running');
    const response = await flow.client.get('/api/sessions', {
      query: { minId: b },
    });
    const page = await expectJson(response, 200, sessions);
    expect(page.map((s) => s.name)).toEqual(['d', 'c', 'b']);
    expect(page.map((s) => s.proxy?.exitIp)).toEqual([
      '203.0.113.4',
      '203.0.113.3',
      '203.0.113.2',
    ]);
  });

  it('checks its parameters', async () => {
    const refused: Array<Record<string, string | number>> = [
      { limit: 0 },
      { limit: 501 },
      { limit: 'ten' },
      { before: 0 },
      { minId: -1 },
      { before: Number.MAX_SAFE_INTEGER + 1 },
      { minId: 1.5 },
    ];
    for (const query of refused) {
      const response = await flow.client.get('/api/sessions', { query });
      await expectError(response, 422, 'validation_error');
    }
    const largest = { limit: 500, before: Number.MAX_SAFE_INTEGER, minId: 1 };
    const response = await flow.client.get('/api/sessions', { query: largest });
    expect(response.status).toBe(200);
  });
});

describe('one session', () => {
  it('is found by its id, and a deleted one is a 404', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    const response = await flow.client.get(`/api/sessions/${session.id}`);
    const found = await expectJson(response, 200, sessionSchema);
    expect(found.name).toBe('a');
    await expectError(
      await flow.client.get('/api/sessions/999'),
      404,
      'session_not_found',
    );
    // The export is not taken for an id.
    const exported = await flow.client.get('/api/sessions/export-proxies');
    expect([200, 409]).toContain(exported.status);
  });
});

describe('exporting the proxies of the sessions', () => {
  it('is the proxy file of the sub2api format, with the passwords', async () => {
    await addProxy(flow.client, '192.0.2.1:8080:someuser:somepass');
    await addProxy(flow.client, '192.0.2.2:8080');
    await addProxy(flow.client, '192.0.2.3:8080'); // no session has it
    const a = await createSession(flow.client, 'a');
    const b = await createSession(flow.client, 'b');
    await waitForStatus(flow, a.id, 'running');
    await waitForStatus(flow, b.id, 'running');

    const response = await flow.client.get('/api/sessions/export-proxies');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="proxy.json"',
    );
    const text = await response.text();
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(text).not.toContain('null');
    const { exported_at, ...file } = proxyExportSchema.parse(JSON.parse(text));
    expect(exported_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(file).toEqual({
      proxies: [
        {
          proxy_key: 'http|192.0.2.1|8080|someuser|somepass',
          name: 'a',
          protocol: 'http',
          host: '192.0.2.1',
          port: 8080,
          username: 'someuser',
          password: 'somepass',
          status: 'active',
          fallback_mode: 'none',
          expiry_warn_days: 7,
        },
        {
          proxy_key: 'http|192.0.2.2|8080||',
          name: 'b',
          protocol: 'http',
          host: '192.0.2.2',
          port: 8080,
          status: 'active',
          fallback_mode: 'none',
          expiry_warn_days: 7,
        },
      ],
      accounts: [],
    });
  });

  it('is a 409 when no session has a proxy', async () => {
    await addProxy(flow.client, '192.0.2.1:8080'); // in the pool, but no session has it
    const response = await flow.client.get('/api/sessions/export-proxies');
    await expectError(response, 409, 'nothing_to_export');
  });
});
