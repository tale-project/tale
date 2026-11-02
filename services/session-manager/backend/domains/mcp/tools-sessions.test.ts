import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../errors.ts';
import { FakeRemote, fakeLaunchSpec } from '../../testing/fake-browser.ts';
import { callTool, jsonOf, textOf } from '../../testing/mcp-client.ts';
import { sessionFixture, stubManager } from '../../testing/mcp-stub-manager.ts';
import type { Manager } from '../sessions/manager.ts';

const remotes: FakeRemote[] = [];

function runningRemote(): FakeRemote {
  const remote = new FakeRemote(fakeLaunchSpec());
  remotes.push(remote);
  return remote;
}

afterEach(() => {
  for (const remote of remotes.splice(0)) remote.close();
  vi.useRealTimers();
});

const shop = sessionFixture({ id: 3, name: 'shop' });
const first = sessionFixture({ id: 1, name: '0001' });

function managerWith(overrides: Partial<Manager>): Manager {
  return stubManager({
    listSessions: () => [shop, first],
    session: (id) => (id === 3 ? shop : first),
    ...overrides,
  });
}

describe('list_sessions', () => {
  it('lists the sessions the way they are listed, with their place', async () => {
    const manager = managerWith({});
    const sessions = jsonOf(await callTool(manager, 'list_sessions'));
    expect(sessions).toMatchObject([
      {
        id: 3,
        name: 'shop',
        status: 'running',
        ip: '203.0.113.1',
        country: 'US',
        location: {
          ip: '203.0.113.1',
          country: 'US',
          latitude: 40.71,
          longitude: -74,
          matches_ip: true,
        },
      },
      { id: 1, name: '0001' },
    ]);
  });

  it('lists none as an empty list', async () => {
    const manager = stubManager({ listSessions: () => [] });
    expect(jsonOf(await callTool(manager, 'list_sessions'))).toEqual([]);
    expect(textOf(await callTool(manager, 'list_sessions'))).toBe('[]');
  });

  it('lists only the sessions in a state', async () => {
    const stopped = sessionFixture({ id: 2, name: 'idle', status: 'stopped' });
    const manager = stubManager({ listSessions: () => [shop, stopped, first] });
    const names = async (args: Record<string, unknown>) =>
      z
        .array(z.object({ name: z.string() }).loose())
        .parse(jsonOf(await callTool(manager, 'list_sessions', args)))
        .map((s) => s.name);
    expect(await names({ status: 'running' })).toEqual(['shop', '0001']);
    expect(await names({ status: 'stopped' })).toEqual(['idle']);
    expect(await names({ status: 'error' })).toEqual([]);
    expect(await names({ status: null })).toEqual(['shop', 'idle', '0001']);
  });

  it('refuses a state there is not', async () => {
    const result = await callTool(managerWith({}), 'list_sessions', {
      status: 'sleeping',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- status: ');
  });
});

describe('get_session', () => {
  it('has the fingerprint and the dates too', async () => {
    const detail = jsonOf(
      await callTool(managerWith({}), 'get_session', { session: '0001' }),
    );
    expect(detail).toMatchObject({
      name: '0001',
      fingerprint: { user_agent: 'FakeAgent/1', platform: 'Win32' },
      created_at: '2026-11-01T10:00:00Z',
      last_started_at: '2026-11-01T10:05:00Z',
    });
  });

  it('finds the session by name in any case, or by id', async () => {
    const manager = managerWith({});
    for (const ref of ['SHOP', 'shop', 3, '3']) {
      expect(
        jsonOf(await callTool(manager, 'get_session', { session: ref })),
        String(ref),
      ).toMatchObject({ id: 3 });
    }
  });

  it('takes a number for an id and a text for a name, even when a session is named like an id', async () => {
    // Session 1 is named "2" and session 2 is named "1".
    const swapped = [
      sessionFixture({ id: 1, name: '2' }),
      sessionFixture({ id: 2, name: '1' }),
    ];
    const manager = stubManager({
      listSessions: () => swapped,
      session: (id) => swapped.find((s) => s.id === id) ?? swapped[0],
    });
    expect(
      jsonOf(await callTool(manager, 'get_session', { session: 1 })),
    ).toMatchObject({ id: 1, name: '2' });
    expect(
      jsonOf(await callTool(manager, 'get_session', { session: '1' })),
    ).toMatchObject({ id: 2, name: '1' });
  });

  it('deletes the session of the id a number names, never the one that is named like it', async () => {
    const deleteSession = vi.fn(() => Promise.resolve());
    const manager = stubManager({
      listSessions: () => [
        sessionFixture({ id: 1, name: '2' }),
        sessionFixture({ id: 2, name: '1' }),
      ],
      deleteSession,
    });
    await callTool(manager, 'delete_session', { session: 1 });
    expect(deleteSession.mock.calls).toEqual([[1]]);
  });

  it('says which sessions there are when there is no such one', async () => {
    const result = await callTool(managerWith({}), 'get_session', {
      session: 'nope',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'There is no session “nope”. The sessions are: shop, 0001.',
    );
  });
});

describe('create_session', () => {
  it('creates the session and answers once it runs, with its tabs', async () => {
    const remote = runningRemote();
    const created = sessionFixture({ id: 1, name: '0001', status: 'starting' });
    const createSession = vi.fn(() => Promise.resolve(created));
    const states = [
      sessionFixture({ status: 'starting', activity: 'assigning_proxy' }),
      sessionFixture({ status: 'starting', activity: 'launching' }),
      sessionFixture({ status: 'running' }),
    ];
    const manager = stubManager({
      createSession,
      session: () => states.shift() ?? sessionFixture(),
      remote: () => remote,
    });
    const result = jsonOf(await callTool(manager, 'create_session'));
    expect(result).toMatchObject({ name: '0001', status: 'running', tabs: 1 });
    expect(createSession).toHaveBeenCalledExactlyOnceWith({
      name: null,
      os: 'random',
    });
  });

  it('takes a name and a system', async () => {
    const createSession = vi.fn(() =>
      Promise.resolve(sessionFixture({ name: 'shop' })),
    );
    const manager = stubManager({
      createSession,
      session: () => sessionFixture({ name: 'shop', status: 'error' }),
    });
    await callTool(manager, 'create_session', { name: 'shop', os: 'macos' });
    expect(createSession).toHaveBeenCalledWith({ name: 'shop', os: 'macos' });
  });

  it('answers with the failure when the start failed', async () => {
    const manager = stubManager({
      createSession: () =>
        Promise.resolve(sessionFixture({ status: 'starting' })),
      session: () =>
        sessionFixture({
          status: 'error',
          error: 'No working proxy available.',
          proxy: null,
          location: null,
        }),
    });
    const result = jsonOf(await callTool(manager, 'create_session'));
    expect(result).toMatchObject({
      status: 'error',
      error: 'No working proxy available.',
    });
    expect(result).not.toHaveProperty('tabs');
  });

  it('says why when there is nothing to create it with', async () => {
    const manager = stubManager({
      createSession() {
        return Promise.reject(
          new AppError(
            409,
            'no_free_proxy',
            'There is no free proxy. Add proxies first.',
          ),
        );
      },
    });
    const result = await callTool(manager, 'create_session');
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain('no free proxy');
  });

  it('knows only the systems of the app', async () => {
    const result = await callTool(stubManager(), 'create_session', {
      os: 'beos',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- os: ');
  });
});

describe('start_session, restart_session and rotate_session_ip', () => {
  it('start the session they were asked for and answer once it runs again', async () => {
    const remote = runningRemote();
    const startSession = vi.fn(() => Promise.resolve(shop));
    const restartSession = vi.fn(() => Promise.resolve(shop));
    const rotateSession = vi.fn(() => Promise.resolve(shop));
    const manager = managerWith({
      startSession,
      restartSession,
      rotateSession,
      remote: () => remote,
    });
    for (const name of [
      'start_session',
      'restart_session',
      'rotate_session_ip',
    ]) {
      expect(
        jsonOf(await callTool(manager, name, { session: 'shop' })),
        name,
      ).toMatchObject({ id: 3, status: 'running', tabs: 1 });
    }
    expect(startSession).toHaveBeenCalledExactlyOnceWith(3, { force: false });
    expect(restartSession).toHaveBeenCalledExactlyOnceWith(3);
    expect(rotateSession).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('start can be forced', async () => {
    const startSession = vi.fn(() => Promise.resolve(first));
    const manager = managerWith({
      startSession,
      remote: () => runningRemote(),
    });
    await callTool(manager, 'start_session', { session: 1, force: true });
    expect(startSession).toHaveBeenCalledWith(1, { force: true });
  });

  it('say what the manager refuses with', async () => {
    const manager = managerWith({
      startSession: () =>
        Promise.reject(
          new AppError(
            409,
            'ip_in_use',
            'Another running session has the same exit IP.',
          ),
        ),
      restartSession: () =>
        Promise.reject(
          new AppError(
            409,
            'session_not_running',
            'That session is not running.',
          ),
        ),
    });
    expect(
      textOf(await callTool(manager, 'start_session', { session: 'shop' })),
    ).toBe('Another running session has the same exit IP.');
    const restart = await callTool(manager, 'restart_session', {
      session: 'shop',
    });
    expect(restart.isError).toBe(true);
    expect(textOf(restart)).toContain('not running');
  });

  it('need a session that exists', async () => {
    const startSession = vi.fn();
    const manager = managerWith({ startSession });
    const result = await callTool(manager, 'start_session', {
      session: 'nope',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('There is no session “nope”');
    expect(startSession).not.toHaveBeenCalled();
  });
});

describe('stop_session', () => {
  it('stops the session and answers once it has stopped', async () => {
    const stopSession = vi.fn(() =>
      Promise.resolve(
        sessionFixture({ id: 3, name: 'shop', status: 'stopping' }),
      ),
    );
    const states = [
      sessionFixture({ id: 3, name: 'shop', status: 'stopping' }),
      sessionFixture({ id: 3, name: 'shop', status: 'stopped' }),
    ];
    const manager = managerWith({
      stopSession,
      session: () => states.shift() ?? sessionFixture({ status: 'stopped' }),
    });
    const result = jsonOf(
      await callTool(manager, 'stop_session', { session: 'shop' }),
    );
    expect(result).toMatchObject({ name: 'shop', status: 'stopped' });
    expect(stopSession).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('answers with how far it got when it takes more than 30 seconds', async () => {
    vi.useFakeTimers();
    const stuck = sessionFixture({ id: 3, name: 'shop', status: 'stopping' });
    const manager = managerWith({
      stopSession: () => Promise.resolve(stuck),
      session: () => stuck,
    });
    const waiting = callTool(manager, 'stop_session', { session: 'shop' }, 1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(jsonOf(await waiting)).toMatchObject({ status: 'stopping' });
  });
});

describe('check_session_ip', () => {
  it('says whether the place still fits the IP', async () => {
    const moved = sessionFixture({
      id: 3,
      name: 'shop',
      proxy: {
        id: 1,
        display: 'http://192.0.2.1:8080',
        exitIp: '203.0.113.50',
        country: 'US',
        checkStatus: 'ok',
      },
      location: {
        ip: '203.0.113.1',
        country: 'US',
        timezone: 'America/New_York',
        latitude: 40.71,
        longitude: -74,
        inSync: false,
      },
    });
    const checkSessionIp = vi.fn(() => Promise.resolve(moved));
    const manager = managerWith({ checkSessionIp });
    const checked = jsonOf(
      await callTool(manager, 'check_session_ip', { session: 'shop' }),
    );
    expect(checked).toMatchObject({
      ip: '203.0.113.50',
      location: { ip: '203.0.113.1', matches_ip: false },
    });
    expect(checkSessionIp).toHaveBeenCalledExactlyOnceWith(3);
  });
});

describe('rename_session', () => {
  it('renames the session, in any state', async () => {
    const renameSession = vi.fn((_id: number, name: string) =>
      sessionFixture({ id: 3, name }),
    );
    const manager = managerWith({ renameSession });
    const renamed = jsonOf(
      await callTool(manager, 'rename_session', {
        session: 'shop',
        name: 'work',
      }),
    );
    expect(renamed).toMatchObject({ id: 3, name: 'work' });
    expect(renameSession).toHaveBeenCalledExactlyOnceWith(3, 'work');
  });

  it('needs the new name', async () => {
    const result = await callTool(managerWith({}), 'rename_session', {
      session: 'shop',
    });
    expect(result.isError).toBe(true);
  });
});

describe('delete_session', () => {
  it('deletes the session and says so', async () => {
    const deleteSession = vi.fn(() => Promise.resolve());
    const manager = managerWith({ deleteSession });
    expect(
      textOf(await callTool(manager, 'delete_session', { session: 'shop' })),
    ).toBe('Deleted session shop.');
    expect(
      textOf(await callTool(manager, 'delete_session', { session: 1 })),
    ).toBe('Deleted session 1.');
    expect(deleteSession.mock.calls).toEqual([[3], [1]]);
  });

  it('deletes nothing for a session that does not exist', async () => {
    const deleteSession = vi.fn();
    const result = await callTool(
      managerWith({ deleteSession }),
      'delete_session',
      {
        session: 'nope',
      },
    );
    expect(result.isError).toBe(true);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});

describe('export_proxies', () => {
  it('is the proxy file, passwords included', async () => {
    const file = {
      exported_at: '2026-11-01T12:00:00Z',
      proxies: [
        {
          proxy_key: 'http|192.0.2.1|8080|me|pw',
          name: '0001',
          protocol: 'http',
          host: '192.0.2.1',
          port: 8080,
          username: 'me',
          password: 'pw',
          status: 'active' as const,
          fallback_mode: 'none' as const,
          expiry_warn_days: 7 as const,
        },
      ],
      accounts: [],
    };
    const manager = stubManager({ exportProxies: () => file });
    expect(jsonOf(await callTool(manager, 'export_proxies'))).toEqual(file);
  });

  it('says when there is nothing to export', async () => {
    const manager = stubManager({
      exportProxies() {
        throw new AppError(
          409,
          'nothing_to_export',
          'There is nothing to export.',
        );
      },
    });
    const result = await callTool(manager, 'export_proxies');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('nothing to export');
  });
});
