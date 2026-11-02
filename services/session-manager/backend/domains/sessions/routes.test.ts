import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  proxyExportSchema,
  sessionRefSchema,
  sessionSchema,
} from '../../../lib/api/schemas.ts';
import {
  proxyExport,
  session,
  sessionRef,
} from '../../../tests/utils/fixtures.ts';
import { AppError } from '../../errors.ts';
import {
  expectError,
  expectJson,
  stubbedApi,
} from '../../testing/api-client.ts';
import type { Manager } from './manager.ts';

const sessions = z.array(sessionSchema);

const runningOn = (id: number) =>
  session({
    id,
    name: `s${id}`,
    status: 'running',
    proxy: {
      id,
      display: `http://192.0.2.${id}:8080`,
      exitIp: `203.0.113.${id}`,
      country: 'US',
      checkStatus: 'ok',
    },
  });

describe('GET /api/sessions', () => {
  function listing(list = [session()], total = list.length) {
    const listSessions = vi.fn<Manager['listSessions']>(() => list);
    const countSessions = vi.fn<Manager['countSessions']>(() => total);
    return {
      listSessions,
      countSessions,
      ...stubbedApi({ listSessions, countSessions }),
    };
  }

  it('answers the sessions newest first and the size of the whole list', async () => {
    const list = [runningOn(3), runningOn(2), session({ id: 1 })];
    const { client } = listing(list, 9);
    const response = await client.get('/api/sessions');
    expect(await expectJson(response, 200, sessions)).toEqual(list);
    expect(response.headers.get('X-Total-Count')).toBe('9');
  });

  it('asks for the whole list without parameters and for the page with them', async () => {
    const { client, listSessions } = listing();
    await client.get('/api/sessions');
    await client.get('/api/sessions', {
      query: { limit: 2, before: 9, minId: 3 },
    });
    expect(listSessions.mock.calls).toEqual([
      [{}],
      [{ limit: 2, before: 9, minId: 3 }],
    ]);
  });

  it.each<Record<string, string | number>>([
    { limit: 0 },
    { limit: 501 },
    { limit: 'ten' },
    { before: 0 },
    { minId: -1 },
    { before: '9223372036854775808' },
    { minId: 1.5 },
  ])('refuses the parameters %j with a 422', async (query) => {
    const { client, listSessions } = listing();
    const response = await client.get('/api/sessions', { query });
    await expectError(response, 422, 'validation_error');
    expect(listSessions).not.toHaveBeenCalled();
  });
});

describe('GET /api/sessions/export-proxies', () => {
  const file = proxyExport({
    exported_at: '2026-11-01T12:59:23Z',
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
  });

  it('answers the proxy file as a download that is not cached', async () => {
    const { client } = stubbedApi({ exportProxies: () => file });
    const response = await client.get('/api/sessions/export-proxies');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="proxy.json"',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is the file of the manager, in snake_case, with the passwords', async () => {
    const { client } = stubbedApi({ exportProxies: () => file });
    const response = await client.get('/api/sessions/export-proxies');
    const parsed = await expectJson(response, 200, proxyExportSchema);
    expect(parsed).toEqual(file);
    expect(parsed.proxies[0]?.password).toBe('somepass');
  });

  it('is indented by two spaces and has no key for what a proxy does not have', async () => {
    const { client } = stubbedApi({ exportProxies: () => file });
    const text = await (
      await client.get('/api/sessions/export-proxies')
    ).text();
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(text.split('\n')[1]).toBe(
      '  "exported_at": "2026-11-01T12:59:23Z",',
    );
    expect(text).not.toContain('null');
    expect(text).toContain(
      '"proxy_key": "http|192.0.2.2|8080||",\n      "name": "b",\n      "protocol": "http",\n      "host": "192.0.2.2",\n      "port": 8080,\n      "status": "active"',
    );
  });

  it('is not taken for the id of a session', async () => {
    const sessionOf = vi.fn<Manager['session']>();
    const { client } = stubbedApi({
      exportProxies: () => file,
      session: sessionOf,
    });
    expect((await client.get('/api/sessions/export-proxies')).status).toBe(200);
    expect(sessionOf).not.toHaveBeenCalled();
  });

  it('answers the 409 nothing_to_export as an error, not as a file', async () => {
    const { client } = stubbedApi({
      exportProxies: () => {
        throw new AppError(
          409,
          'nothing_to_export',
          'No session has a proxy yet, so there is nothing to export.',
        );
      },
    });
    const response = await client.get('/api/sessions/export-proxies');
    await expectError(response, 409, 'nothing_to_export');
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('GET /api/sessions/:id', () => {
  it('answers the session', async () => {
    const found = runningOn(4);
    const sessionOf = vi.fn<Manager['session']>(() => found);
    const { client } = stubbedApi({ session: sessionOf });
    const response = await client.get('/api/sessions/4');
    expect(await expectJson(response, 200, sessionSchema)).toEqual(found);
    expect(sessionOf).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('answers 404 session_not_found for a session that was deleted', async () => {
    const { client } = stubbedApi({
      session: () => {
        throw new AppError(
          404,
          'session_not_found',
          'Session 999 does not exist.',
        );
      },
    });
    await expectError(
      await client.get('/api/sessions/999'),
      404,
      'session_not_found',
    );
  });
});

describe('POST /api/sessions', () => {
  function creating(
    created = session({ id: 2, name: 'Shop', status: 'starting' }),
  ) {
    const createSession = vi.fn<Manager['createSession']>(() =>
      Promise.resolve(created),
    );
    return { createSession, ...stubbedApi({ createSession }) };
  }

  it('answers 201 with the session, which is starting', async () => {
    const created = session({
      id: 2,
      name: 'Shop',
      os: 'linux',
      status: 'starting',
      activity: 'assigning_proxy',
    });
    const { client } = creating(created);
    const response = await client.post('/api/sessions', {
      name: '  Shop  ',
      os: 'linux',
    });
    expect(await expectJson(response, 201, sessionSchema)).toEqual(created);
  });

  it('hands over the name as it was typed and the system chosen', async () => {
    const { client, createSession } = creating();
    await client.post('/api/sessions', { name: '  Shop  ', os: 'linux' });
    expect(createSession).toHaveBeenCalledExactlyOnceWith({
      name: '  Shop  ',
      os: 'linux',
    });
  });

  it('lets the system be random and the name be the next free number', async () => {
    const { client, createSession } = creating();
    await client.post('/api/sessions', {});
    await client.post('/api/sessions', { name: null });
    await client.post('/api/sessions', { name: '   ' });
    expect(createSession.mock.calls).toEqual([
      [{ name: undefined, os: 'random' }],
      [{ name: null, os: 'random' }],
      [{ name: '   ', os: 'random' }],
    ]);
  });

  it.each([
    ['a system that does not exist', { name: 'c', os: 'android' }, 'os'],
    ['a name that is no text', { name: 5 }, 'name'],
    ['a system that is no text', { os: 3 }, 'os'],
  ])(
    'refuses %s with a 422 before the manager is asked',
    async (_name, body, field) => {
      const { client, createSession } = creating();
      const response = await client.post('/api/sessions', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message).toMatch(new RegExp(`^${field}: `));
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('refuses a name of a million characters with a 422 before the manager is asked, and leaves 81 to it', async () => {
    const { client, createSession } = creating();
    const absurd = await client.post('/api/sessions', {
      name: 'x'.repeat(1_000_000),
    });
    const error = await expectError(absurd, 422, 'validation_error');
    expect(error.message).toMatch(/^name: Too big/);
    expect(createSession).not.toHaveBeenCalled();
    // The rule of the server (and its code, invalid_name) is the manager's.
    await client.post('/api/sessions', { name: 'x'.repeat(81) });
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('wants a JSON body, even an empty object', async () => {
    const { client, createSession } = creating();
    await expectError(
      await client.post('/api/sessions'),
      422,
      'validation_error',
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'no_free_proxy'],
    [409, 'name_taken'],
    [409, 'fingerprint_exhausted'],
    [422, 'invalid_name'],
    [503, 'browser_installing'],
    [503, 'browser_not_installed'],
  ])('passes on the manager’s %d %s', async (status, code) => {
    const { client } = stubbedApi({
      createSession: () =>
        Promise.reject(new AppError(status, code, 'A sentence.')),
    });
    await expectError(await client.post('/api/sessions', {}), status, code);
  });
});

describe('PATCH /api/sessions/:id', () => {
  function renaming(renamed = session({ id: 3, name: 'renamed' })) {
    const renameSession = vi.fn<Manager['renameSession']>(() => renamed);
    return { renameSession, ...stubbedApi({ renameSession }) };
  }

  it('answers the renamed session', async () => {
    const renamed = runningOn(3);
    const { client, renameSession } = renaming(renamed);
    const response = await client.patch('/api/sessions/3', {
      name: ' renamed ',
    });
    expect(await expectJson(response, 200, sessionSchema)).toEqual(renamed);
    expect(renameSession).toHaveBeenCalledExactlyOnceWith(3, ' renamed ');
  });

  it('refuses a name of a million characters with a 422 before the manager is asked', async () => {
    const { client, renameSession } = renaming();
    const response = await client.patch('/api/sessions/3', {
      name: 'x'.repeat(1_000_000),
    });
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toMatch(/^name: Too big/);
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('refuses a request without a name or with one that is no text', async () => {
    const { client, renameSession } = renaming();
    for (const body of [{}, { name: 5 }, { name: null }]) {
      const response = await client.patch('/api/sessions/3', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message).toMatch(/^name: /);
    }
    expect(renameSession).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'name_taken'],
    [422, 'invalid_name'],
    [404, 'session_not_found'],
  ])('passes on the manager’s %d %s', async (status, code) => {
    const { client } = stubbedApi({
      renameSession: () => {
        throw new AppError(status, code, 'A sentence.');
      },
    });
    await expectError(
      await client.patch('/api/sessions/3', { name: 'x' }),
      status,
      code,
    );
  });
});

describe('POST /api/sessions/:id/start', () => {
  function starting(
    started = session({ id: 5, status: 'starting', activity: 'launching' }),
  ) {
    const startSession = vi.fn<Manager['startSession']>(() =>
      Promise.resolve(started),
    );
    return { startSession, ...stubbedApi({ startSession }) };
  }

  it('answers 202 with the session, which is starting', async () => {
    const started = session({
      id: 5,
      status: 'starting',
      activity: 'launching',
    });
    const { client } = starting(started);
    const response = await client.post('/api/sessions/5/start', {
      force: false,
    });
    expect(await expectJson(response, 202, sessionSchema)).toEqual(started);
  });

  it.each<{ sent: string; body: unknown; force: boolean }>([
    { sent: 'no body', body: undefined, force: false },
    { sent: 'an empty object', body: {}, force: false },
    { sent: 'force: false', body: { force: false }, force: false },
    { sent: 'force: true', body: { force: true }, force: true },
  ])('starts with $sent, which is force $force', async ({ body, force }) => {
    const { client, startSession } = starting();
    const response = await client.post('/api/sessions/5/start', body);
    expect(response.status).toBe(202);
    expect(startSession).toHaveBeenCalledExactlyOnceWith(5, { force });
  });

  it('reads a body of null or blanks as no body', async () => {
    const { client, startSession } = starting();
    for (const raw of ['null', '   \n']) {
      const response = await client.call('POST', '/api/sessions/5/start', {
        raw,
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(202);
    }
    expect(startSession.mock.calls).toEqual([
      [5, { force: false }],
      [5, { force: false }],
    ]);
  });

  it('refuses a force that is no flag and a body that is no JSON', async () => {
    const { client, startSession } = starting();
    const flag = await client.post('/api/sessions/5/start', { force: 'yes' });
    const error = await expectError(flag, 422, 'validation_error');
    expect(error.message).toMatch(/^force: /);
    const broken = await client.call('POST', '/api/sessions/5/start', {
      raw: '{"force": tr',
      headers: { 'Content-Type': 'application/json' },
    });
    await expectError(broken, 422, 'validation_error');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('answers the 409 ip_in_use with the exit IP and the sessions that use it', async () => {
    const using = [sessionRef({ id: 1, name: 'a', status: 'running' })];
    const { client } = stubbedApi({
      startSession: () =>
        Promise.reject(
          new AppError(409, 'ip_in_use', 'Exit IP 203.0.113.9 is in use.', {
            exitIp: '203.0.113.9',
            sessions: using,
          }),
        ),
    });
    const error = await expectError(
      await client.post('/api/sessions/2/start', { force: false }),
      409,
      'ip_in_use',
    );
    expect(error.exitIp).toBe('203.0.113.9');
    expect(z.array(sessionRefSchema).parse(error.sessions)).toEqual(using);
  });

  it('answers the 502 proxy_unreachable with the proxy and the cause', async () => {
    const { client } = stubbedApi({
      startSession: () =>
        Promise.reject(
          new AppError(502, 'proxy_unreachable', 'The proxy is not working.', {
            proxyId: 7,
            reason: 'cannot connect to the proxy',
          }),
        ),
    });
    const error = await expectError(
      await client.post('/api/sessions/2/start'),
      502,
      'proxy_unreachable',
    );
    expect(error.proxyId).toBe(7);
    expect(error.reason).toBe('cannot connect to the proxy');
  });

  it('answers a 409 session_busy with what the session is doing', async () => {
    const { client } = stubbedApi({
      startSession: () =>
        Promise.reject(
          new AppError(409, 'session_busy', 'Session a is stopping.', {
            doing: 'stopping',
          }),
        ),
    });
    const error = await expectError(
      await client.post('/api/sessions/2/start'),
      409,
      'session_busy',
    );
    expect(error.doing).toBe('stopping');
  });

  it.each([
    [409, 'session_running'],
    [409, 'session_busy'],
    [409, 'no_free_proxy'],
    [503, 'browser_not_installed'],
    [404, 'session_not_found'],
  ])('passes on the manager’s %d %s', async (status, code) => {
    const { client } = stubbedApi({
      startSession: () =>
        Promise.reject(new AppError(status, code, 'A sentence.')),
    });
    await expectError(await client.post('/api/sessions/2/start'), status, code);
  });
});

interface SessionAction {
  action: string;
  method: 'stopSession' | 'restartSession' | 'rotateSession' | 'checkSessionIp';
  status: number;
  refusals: Array<[number, string]>;
}

const SESSION_ACTIONS: SessionAction[] = [
  {
    action: 'stop',
    method: 'stopSession',
    status: 202,
    refusals: [[404, 'session_not_found']],
  },
  {
    action: 'restart',
    method: 'restartSession',
    status: 202,
    refusals: [
      [409, 'session_not_running'],
      [409, 'no_proxy'],
      [502, 'proxy_unreachable'],
    ],
  },
  {
    action: 'rotate',
    method: 'rotateSession',
    status: 202,
    refusals: [
      [409, 'no_free_proxy'],
      [409, 'session_busy'],
    ],
  },
  {
    action: 'check-ip',
    method: 'checkSessionIp',
    status: 200,
    refusals: [
      [409, 'no_proxy'],
      [502, 'proxy_unreachable'],
    ],
  },
];

for (const { action, method, status, refusals } of SESSION_ACTIONS) {
  describe(`POST /api/sessions/:id/${action}`, () => {
    const path = `/api/sessions/6/${action}`;

    it(`answers ${status} with the session as it is then`, async () => {
      const current = runningOn(6);
      const call = vi.fn<Manager[typeof method]>(() =>
        Promise.resolve(current),
      );
      const { client } = stubbedApi({ [method]: call });
      const response = await client.post(path);
      expect(await expectJson(response, status, sessionSchema)).toEqual(
        current,
      );
      expect(call).toHaveBeenCalledExactlyOnceWith(6);
    });

    it.each(refusals)(
      'passes on the manager’s %d %s',
      async (refusalStatus, code) => {
        const { client } = stubbedApi({
          [method]: () =>
            Promise.reject(new AppError(refusalStatus, code, 'A sentence.')),
        });
        await expectError(await client.post(path), refusalStatus, code);
      },
    );
  });
}

describe('DELETE /api/sessions/:id', () => {
  it('answers 204 with no body', async () => {
    const deleteSession = vi.fn<Manager['deleteSession']>(() =>
      Promise.resolve(),
    );
    const { client } = stubbedApi({ deleteSession });
    const response = await client.delete('/api/sessions/8');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('passes on the 404 of a session that does not exist', async () => {
    const { client } = stubbedApi({
      deleteSession: () =>
        Promise.reject(
          new AppError(404, 'session_not_found', 'Session 8 does not exist.'),
        ),
    });
    await expectError(
      await client.delete('/api/sessions/8'),
      404,
      'session_not_found',
    );
  });
});

describe('the id of a session in the path', () => {
  const routes: Array<[string, string]> = [
    ['GET', ''],
    ['PATCH', ''],
    ['DELETE', ''],
    ['POST', '/start'],
    ['POST', '/stop'],
    ['POST', '/restart'],
    ['POST', '/check-ip'],
    ['POST', '/rotate'],
  ];

  it.each(routes)(
    '%s /api/sessions/:id%s: text that is not a whole number is a 422',
    async (method, suffix) => {
      const { client } = stubbedApi();
      for (const id of ['abc', '1.5', '1e3', 'null']) {
        const response = await client.call(
          method,
          `/api/sessions/${id}${suffix}`,
          {
            body: method === 'PATCH' ? { name: 'x' } : undefined,
          },
        );
        const error = await expectError(response, 422, 'validation_error');
        expect(error.message).toBe(
          'id: Input should be a valid integer, unable to parse string as an integer',
        );
      }
    },
  );

  it.each(routes)(
    '%s /api/sessions/:id%s: an id no row can have is a 404 without asking the manager',
    async (method, suffix) => {
      const { client } = stubbedApi();
      for (const id of [
        '0',
        '-1',
        '9007199254740992',
        '100000000000000000000',
      ]) {
        const response = await client.call(
          method,
          `/api/sessions/${id}${suffix}`,
          {
            body: method === 'PATCH' ? { name: 'x' } : undefined,
          },
        );
        const error = await expectError(response, 404, 'session_not_found');
        expect(error.message).toBe(`Session ${id} does not exist.`);
      }
    },
  );
});
