// The proxy pool as the manager sees it: adding and importing, health checks in
// the background, deleting, listing.

import { afterEach, describe, expect, it } from 'vitest';

import type { Proxy } from '../../../lib/api/schemas.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  refusalOf,
  settled,
  waitForChecks,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: Parameters<typeof createTestManager>[0]): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

const WEBSHARE_EXPORT =
  '\ufeff63.246.153.230:5899:someuser:somepass\r\n10.20.30.40:6000:someuser:somepass\r\n';

describe('adding a proxy', () => {
  it('checks it in the background and never waits for the check', async () => {
    const app = setup();
    const gate = app.checker.hold(); // checks hang until released: adding must not wait for them
    const proxy = addProxy(app.manager, 'user:hunter2@192.0.2.1:8080');
    expect(proxy.display).toBe('http://user@192.0.2.1:8080');
    expect([proxy.username, proxy.hasPassword, proxy.session]).toEqual([
      'user',
      true,
      null,
    ]);
    expect(proxy).not.toHaveProperty('password');
    expect(proxy.check).toEqual({
      status: 'checking',
      ok: null,
      exitIp: null,
      country: null,
      latencyMs: null,
      checkedAt: null,
      error: null,
    });
    expect(app.manager.meta().counts.checkingProxies).toBe(1);

    gate.release();
    await waitForChecks(app.manager);
    const [checked] = app.manager.listProxies();
    expect([checked.check.status, checked.check.exitIp]).toEqual([
      'ok',
      '203.0.113.1',
    ]);
    expect(JSON.stringify(app.manager.listProxies())).not.toContain('hunter2');
    expect(JSON.stringify(app.manager.proxy(checked.id))).not.toContain(
      'hunter2',
    );
  });

  it('uses the scheme it is given when the text has none', () => {
    const { manager } = setup();
    expect(
      addProxy(manager, '192.0.2.1:1080', { defaultScheme: 'socks5' }),
    ).toMatchObject({
      scheme: 'socks5',
      display: 'socks5://192.0.2.1:1080',
    });
    expect(
      addProxy(manager, 'https://192.0.2.2:8443', { defaultScheme: 'socks5' })
        .scheme,
    ).toBe('https');
  });

  it('refuses a proxy that already exists, naming it, and does not check it again', async () => {
    const app = setup();
    const first = addProxy(app.manager, 'http://user:hunter2@192.0.2.1:8080');
    const duplicate = await refusalOf(() =>
      app.manager.addProxy('192.0.2.1:8080:user:hunter2', {
        defaultScheme: 'socks5',
      }),
    );
    expect([duplicate.status, duplicate.code]).toEqual([409, 'duplicate']);
    expect(duplicate.extra).toEqual({ existingId: first.id });
    expect(duplicate.message).toBe(
      'This proxy already exists (socks5://user@192.0.2.1:8080).',
    );
    expect(duplicate.message).not.toContain('hunter2');
    await waitForChecks(app.manager);
    expect(app.checker.calls).toHaveLength(1);
  });

  it('refuses text that is no proxy, saying why by code and parameters, and never echoes a password', async () => {
    const app = setup();
    const invalid = await refusalOf(() =>
      app.manager.addProxy('192.0.2.1:99999@user:hunter2'),
    );
    expect([invalid.status, invalid.code]).toEqual([422, 'invalid_proxy']);
    expect(JSON.stringify(invalid.toBody())).not.toContain('hunter2');
    expect(invalid.message.startsWith('Invalid proxy: ')).toBe(true);
    expect(invalid.message.endsWith('.')).toBe(true);
    expect(typeof invalid.extra.reason).toBe('string');
    expect(invalid.extra.params).toBeTypeOf('object');
    // A code with a parameter.
    const port = await refusalOf(() =>
      app.manager.addProxy('192.0.2.1:99999:someuser:secret'),
    );
    expect(port.toBody()).toEqual({
      error: 'invalid_proxy',
      message: 'Invalid proxy: invalid port 99999 (must be 1-65535).',
      reason: 'invalid_port_value',
      params: { port: '99999' },
    });
    // Without a parameter.
    const missing = await refusalOf(() => app.manager.addProxy('192.0.2.1'));
    expect(missing.toBody()).toEqual({
      error: 'invalid_proxy',
      message: 'Invalid proxy: missing port (expected host:port).',
      reason: 'missing_port',
      params: {},
    });
    expect(
      (await refusalOf(() => app.manager.addProxy('   '))).extra.reason,
    ).toBe('empty');
    expect(app.manager.countProxies()).toBe(0);
    expect(app.checker.calls).toEqual([]);
  });
});

describe('importing proxies', () => {
  it('reports what was added, the duplicates and the lines it could not read, with masked input', async () => {
    const app = setup();
    const existing = addProxy(
      app.manager,
      '10.20.30.40:6000:someuser:somepass',
    );
    await waitForChecks(app.manager);
    const gate = app.checker.hold();
    const text = `${WEBSHARE_EXPORT}# comment\r\n\r\n10.0.0.1:99999:someuser:hunter2\r\n63.246.153.230:5899:someuser:somepass\r\n`;

    const result = app.manager.importProxies(text);
    expect(result.added.map((p) => [p.display, p.check.status])).toEqual([
      ['http://someuser@63.246.153.230:5899', 'checking'],
    ]);
    const firstId = result.added[0].id;
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
    expect(result.errors).toEqual([
      {
        line: 5,
        input: '10.0.0.1:99999:***:***',
        message: 'invalid port 99999 (must be 1-65535)',
        code: 'invalid_port_value',
        params: { port: '99999' },
      },
    ]);
    expect(result.summary).toBe('Added 1, 2 duplicates, 1 error');
    expect(JSON.stringify(result)).not.toContain('hunter2');

    gate.release();
    await waitForChecks(app.manager);
    // Each checked once.
    expect(app.checker.calls.map((proxy) => proxy.host)).toEqual([
      '10.20.30.40',
      '63.246.153.230',
    ]);

    const again = app.manager.importProxies(WEBSHARE_EXPORT);
    expect([again.added, again.summary]).toEqual([
      [],
      'Added 0, 2 duplicates, 0 errors',
    ]);
  });

  it('uses the default scheme for lines without one', () => {
    const { manager } = setup();
    const result = manager.importProxies('192.0.2.1:1080\n', {
      defaultScheme: 'socks5',
    });
    expect(result.added[0].scheme).toBe('socks5');
  });

  it('says "1 duplicate" and "2 errors" the English way', () => {
    const { manager } = setup();
    addProxy(manager, '192.0.2.1:8080');
    const result = manager.importProxies('192.0.2.1:8080\nnope\nalso nope\n');
    expect(result.summary).toBe('Added 0, 1 duplicate, 2 errors');
  });

  it('gives an empty list an empty result', () => {
    const { manager } = setup();
    expect(manager.importProxies('\n# only a comment\n')).toEqual({
      added: [],
      duplicates: [],
      errors: [],
      summary: 'Added 0, 0 duplicates, 0 errors',
    });
  });

  it('adds a long list in one go, checking only 8 at a time', async () => {
    const app = setup();
    const gate = app.checker.hold();
    const text = Array.from(
      { length: 30 },
      (_, n) => `192.0.2.${n + 1}:8080`,
    ).join('\n');
    const result = app.manager.importProxies(text);
    expect(result.added).toHaveLength(30);
    await app.checker.waitForCalls(8);
    expect(app.manager.meta().counts.checkingProxies).toBe(30);
    gate.release();
    await waitForChecks(app.manager);
    expect(app.checker.calls).toHaveLength(30);
    expect(app.checker.maxInFlight).toBe(8);
  });

  it('refuses a line that is too long without the rest of the list noticing', () => {
    const { manager } = setup();
    const result = manager.importProxies(
      `${'a'.repeat(5000)}\n192.0.2.1:8080\n`,
    );
    expect(result.added).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      line: 1,
      code: 'line_too_long',
      params: { max: 2048 },
    });
  });
});

describe('checking proxies', () => {
  it('stores a success and a failure', async () => {
    const app = setup();
    const proxy = addProxy(app.manager, '192.0.2.1:8080');
    await waitForChecks(app.manager);
    app.checker.setIp('192.0.2.1:8080', '198.51.100.7', 'CH');
    expect(app.manager.checkProxy(proxy.id).check.status).toBe('checking');
    await waitForChecks(app.manager);
    const [ok] = app.manager.listProxies();
    expect([
      ok.check.status,
      ok.check.ok,
      ok.check.exitIp,
      ok.check.country,
    ]).toEqual(['ok', true, '198.51.100.7', 'CH']);
    expect(ok.check.latencyMs).toBe(42);
    expect(ok.check.checkedAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/,
    );
    expect(ok.check.error).toBeNull();

    app.checker.setError('192.0.2.1:8080', 'cannot connect to the proxy');
    app.manager.checkProxy(proxy.id);
    await waitForChecks(app.manager);
    const [failed] = app.manager.listProxies();
    expect([failed.check.status, failed.check.ok, failed.check.error]).toEqual([
      'failed',
      false,
      'cannot connect to the proxy',
    ]);
    // From the last successful check.
    expect([failed.check.exitIp, failed.check.latencyMs]).toEqual([
      '198.51.100.7',
      null,
    ]);
    const missing = await refusalOf(() => app.manager.checkProxy(99));
    expect([missing.status, missing.code]).toEqual([404, 'proxy_not_found']);
    expect(missing.message).toBe('Proxy 99 does not exist.');
  });

  it('runs "check all" in the background and never checks a proxy twice at once', async () => {
    const app = setup();
    for (let n = 1; n <= 3; n++) addProxy(app.manager, `192.0.2.${n}:8080`);
    await waitForChecks(app.manager);
    app.checker.setError('192.0.2.2:8080', 'boom');
    const gate = app.checker.hold();
    expect(app.manager.checkProxy(1).check.status).toBe('checking');
    const all = app.manager.checkAllProxies();
    expect(all.map((proxy) => proxy.check.status)).toEqual([
      'checking',
      'checking',
      'checking',
    ]);
    gate.release();
    await waitForChecks(app.manager);
    expect(app.checker.calls).toHaveLength(3 + 3); // proxy 1 was already being checked
    expect(
      app.manager.listProxies().map((proxy) => proxy.check.status),
    ).toEqual(['ok', 'failed', 'ok']);
  });

  it('lists the newest proxies first', () => {
    const { manager } = setup();
    for (let n = 1; n <= 3; n++) addProxy(manager, `192.0.2.${n}:8080`);
    expect(manager.checkAllProxies().map((proxy) => proxy.id)).toEqual([
      3, 2, 1,
    ]);
  });
});

describe('deleting a proxy', () => {
  it('asks first when a session has it, and refuses while the session runs', async () => {
    const app = setup();
    const proxy = addProxy(app.manager, '192.0.2.1:8080');
    const spare = addProxy(app.manager, '192.0.2.2:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');

    const busy = await refusalOf(() =>
      app.manager.deleteProxy(proxy.id, { force: true }),
    );
    expect([busy.status, busy.code]).toEqual([409, 'proxy_busy']);
    expect(busy.extra.session).toEqual({
      id: session.id,
      name: 'a',
      status: 'running',
    });
    expect(busy.message).toBe(
      'Session a is using proxy http://192.0.2.1:8080 right now. Stop the session first.',
    );

    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    const inUse = await refusalOf(() => app.manager.deleteProxy(proxy.id));
    expect([inUse.status, inUse.code]).toEqual([409, 'proxy_in_use']);
    expect(inUse.extra.session).toEqual({
      id: session.id,
      name: 'a',
      status: 'stopped',
    });
    expect(inUse.message).toBe(
      'Session a uses proxy http://192.0.2.1:8080. If you delete it, the session gets another proxy on its next start.',
    );

    app.manager.deleteProxy(proxy.id, { force: true });
    expect(app.manager.session(session.id).proxy).toBeNull();
    app.manager.deleteProxy(spare.id); // free: no questions
    expect(app.manager.listProxies()).toEqual([]);
    expect((await refusalOf(() => app.manager.deleteProxy(99))).status).toBe(
      404,
    );
  });

  it('refuses a proxy that is being assigned to a session even when forced', async () => {
    const app = setup();
    const proxy = addProxy(app.manager, '192.0.2.1:8080');
    const gate = app.checker.hold();
    await createSession(app.manager, 'a');
    await app.checker.waitForCalls(1);
    const busy = await refusalOf(() =>
      app.manager.deleteProxy(proxy.id, { force: true }),
    );
    expect(busy.code).toBe('proxy_busy');
    gate.release();
  });
});

describe('listing proxies', () => {
  it('goes newest first, in pages', () => {
    const { manager } = setup();
    const ids = Array.from(
      { length: 7 },
      (_, n) => addProxy(manager, `192.0.2.${n + 1}:8080`).id,
    );
    const newestFirst = [...ids].reverse();
    const idsOf = (page?: Parameters<typeof manager.listProxies>[0]) =>
      manager.listProxies(page).map((proxy) => proxy.id);
    expect(idsOf()).toEqual(newestFirst); // no limits: everything
    expect(manager.countProxies()).toBe(7);

    // The next page starts below the smallest id loaded so far; a short page is the last one.
    expect(idsOf({ limit: 3 })).toEqual(newestFirst.slice(0, 3));
    expect(idsOf({ before: newestFirst[2], limit: 3 })).toEqual(
      newestFirst.slice(3, 6),
    );
    expect(idsOf({ before: newestFirst[5], limit: 3 })).toEqual(
      newestFirst.slice(6),
    );
    expect(idsOf({ before: ids[0], limit: 3 })).toEqual([]);
    expect(idsOf({ before: ids[6] + 100 })).toEqual(newestFirst);

    // A refresh of the loaded rows: new rows come first, deleted ones are gone, older ones are not included.
    const added = addProxy(manager, '192.0.2.8:8080').id;
    manager.deleteProxy(newestFirst[1]);
    expect(idsOf({ minId: newestFirst[2] })).toEqual([
      added,
      newestFirst[0],
      newestFirst[2],
    ]);
    expect(manager.countProxies()).toBe(7);
    expect(idsOf({ minId: added + 1 })).toEqual([]);
    expect(idsOf({ minId: ids[2], before: added, limit: 2 })).toEqual([
      newestFirst[0],
      newestFirst[2],
    ]);
  });

  it('names the session that has a proxy with the same exit IP as an unused one', async () => {
    const app = setup();
    app.checker.setIp('192.0.2.1:8080', '203.0.113.9');
    app.checker.setIp('192.0.2.2:8080', '203.0.113.9'); // e.g. two credentials for one sticky session
    const [used, twin, other] = [1, 2, 3].map(
      (n) => addProxy(app.manager, `192.0.2.${n}:8080`).id,
    );
    await waitForChecks(app.manager);
    const session = await createSession(app.manager, 'a');
    expect(
      (await waitForStatus(app.manager, session.id, 'running')).proxy?.id,
    ).toBe(used);

    const proxies = new Map<number, Proxy>(
      app.manager.listProxies().map((proxy) => [proxy.id, proxy]),
    );
    const of = (id: number): Proxy => {
      const proxy = proxies.get(id);
      if (proxy === undefined) throw new Error(`no proxy ${id}`);
      return proxy;
    };
    expect([of(used).session?.name, of(used).sameIpAs]).toEqual(['a', null]);
    expect(of(twin).session).toBeNull();
    expect(of(twin).sameIpAs).toEqual({
      id: session.id,
      name: 'a',
      status: 'running',
    });
    expect([of(other).session, of(other).sameIpAs]).toEqual([null, null]);
    // Also in a page without the used proxy.
    const [alone] = app.manager.listProxies({ minId: twin, before: twin + 1 });
    expect(alone.sameIpAs?.name).toBe('a');
  });

  it('shows who has a proxy that is being assigned', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    await waitForChecks(app.manager);
    const gate = app.checker.hold();
    const session = await createSession(app.manager, 'a');
    await app.checker.waitForCalls(1);
    expect(app.manager.listProxies()[0].session).toEqual({
      id: session.id,
      name: 'a',
      status: 'starting',
    });
    gate.release();
    await settled(app.manager, session.id);
    expect(app.manager.listProxies()[0].session?.status).toBe('running');
  });

  it('finds one proxy by id', async () => {
    const { manager } = setup();
    const added = addProxy(manager, '192.0.2.1:8080');
    expect(manager.proxy(added.id)).toMatchObject({
      id: added.id,
      host: '192.0.2.1',
    });
    const missing = await refusalOf(() => manager.proxy(99));
    expect([missing.status, missing.code]).toEqual([404, 'proxy_not_found']);
  });
});
