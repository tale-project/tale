import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Proxy } from '../../../lib/api/schemas.ts';
import { AppError } from '../../errors.ts';
import { callTool, jsonOf, textOf } from '../../testing/mcp-client.ts';
import { proxyFixture, stubManager } from '../../testing/mcp-stub-manager.ts';

afterEach(() => {
  vi.useRealTimers();
});

const failedCheck: Proxy['check'] = {
  status: 'failed',
  ok: false,
  exitIp: null,
  country: null,
  latencyMs: null,
  checkedAt: '2026-11-01T09:01:00Z',
  error: 'connection refused',
};

// Newest first, as the manager lists them: 4 and 2 are free, 3 failed, 1 is in use.
const pool: Proxy[] = [
  proxyFixture({ id: 4, display: 'http://192.0.2.4:8080' }),
  proxyFixture({ id: 3, display: 'http://192.0.2.3:8080', check: failedCheck }),
  proxyFixture({
    id: 2,
    display: 'http://me@192.0.2.2:8080',
    username: 'me',
    hasPassword: true,
  }),
  proxyFixture({
    id: 1,
    display: 'http://192.0.2.1:8080',
    session: { id: 1, name: '0001', status: 'running' },
  }),
];

const listedSchema = z.object({
  total: z.number(),
  matching: z.number(),
  proxies: z.array(z.object({ id: z.number(), proxy: z.string() }).loose()),
});

async function listed(proxies: Proxy[], args: Record<string, unknown> = {}) {
  const manager = stubManager({ listProxies: () => proxies });
  return listedSchema.parse(
    jsonOf(await callTool(manager, 'list_proxies', args)),
  );
}

describe('list_proxies', () => {
  it('lists the pool newest first, without a password', async () => {
    const all = await listed(pool);
    expect(all.total).toBe(4);
    expect(all.matching).toBe(4);
    expect(all.proxies.map((proxy) => proxy.proxy)).toEqual([
      'http://192.0.2.4:8080',
      'http://192.0.2.3:8080',
      'http://me@192.0.2.2:8080',
      'http://192.0.2.1:8080',
    ]);
    expect(JSON.stringify(all)).not.toContain('password');
    expect(all.proxies[3]).toMatchObject({
      id: 1,
      health: 'ok',
      exit_ip: '203.0.113.1',
      country: 'US',
      session: '0001',
    });
  });

  it('can narrow the pool to the free ones, the ones in use or the failed ones', async () => {
    const names = async (only: string) =>
      (await listed(pool, { only })).proxies.map((proxy) => proxy.id);
    expect(await names('free')).toEqual([4, 2]); // newest first
    expect(await names('in_use')).toEqual([1]);
    expect(await names('failed')).toEqual([3]);
    expect(await names('all')).toEqual([4, 3, 2, 1]);
  });

  it('does not call a proxy free when another session has its exit IP', async () => {
    const sameIp = [
      proxyFixture({
        id: 5,
        sameIpAs: { id: 1, name: '0001', status: 'running' },
      }),
      proxyFixture({ id: 6 }),
    ];
    expect(
      (await listed(sameIp, { only: 'free' })).proxies.map((p) => p.id),
    ).toEqual([6]);
  });

  it('shows at most `limit`, and says how many matched', async () => {
    const limited = await listed(pool, { limit: 1 });
    expect([limited.total, limited.matching, limited.proxies.length]).toEqual([
      4, 4, 1,
    ]);
    const free = await listed(pool, { only: 'free', limit: 1 });
    expect([free.total, free.matching, free.proxies.map((p) => p.id)]).toEqual([
      4,
      2,
      [4],
    ]);
  });

  it('shows one at least, whatever the limit', async () => {
    expect((await listed(pool, { limit: 0 })).proxies).toHaveLength(1);
    expect((await listed(pool, { limit: -5 })).proxies).toHaveLength(1);
  });

  it('shows a hundred by default', async () => {
    const many = Array.from({ length: 130 }, (_, index) =>
      proxyFixture({ id: 130 - index }),
    );
    const result = await listed(many);
    expect([result.total, result.matching, result.proxies.length]).toEqual([
      130, 130, 100,
    ]);
  });

  it('refuses a filter it does not have', async () => {
    const result = await callTool(
      stubManager({ listProxies: () => pool }),
      'list_proxies',
      { only: 'fast' },
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- only: ');
  });
});

describe('add_proxies', () => {
  const imported = {
    added: [proxyFixture({ id: 1, display: 'http://user@192.0.2.1:8080' })],
    duplicates: [
      { line: 2, display: 'http://user@192.0.2.1:8080', existingId: 1 },
    ],
    errors: [
      {
        line: 3,
        input: 'not a proxy',
        message: 'There is no port.',
        code: 'missing_port',
        params: {},
      },
    ],
    summary: 'Added 1, 1 duplicate, 1 error',
  };

  it('says which lines were added, which were there already and which are wrong', async () => {
    const importProxies = vi.fn(() => imported);
    const manager = stubManager({ importProxies });
    const text =
      '192.0.2.1:8080:user:secret-password\n192.0.2.1:8080:user:secret-password\nnot a proxy';
    const result = jsonOf(await callTool(manager, 'add_proxies', { text }));
    expect(result).toEqual({
      summary: 'Added 1, 1 duplicate, 1 error',
      added: [{ id: 1, proxy: 'http://user@192.0.2.1:8080' }],
      duplicates: [{ line: 2, proxy: 'http://user@192.0.2.1:8080' }],
      errors: [{ line: 3, input: 'not a proxy', message: 'There is no port.' }],
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(importProxies).toHaveBeenCalledExactlyOnceWith(text, {
      defaultScheme: 'http',
    });
  });

  it('gives the lines without a scheme the one it is told', async () => {
    const importProxies = vi.fn(() => imported);
    const manager = stubManager({ importProxies });
    await callTool(manager, 'add_proxies', {
      text: '192.0.2.1:1080',
      default_scheme: 'socks5',
    });
    expect(importProxies).toHaveBeenCalledWith('192.0.2.1:1080', {
      defaultScheme: 'socks5',
    });
  });

  it('knows the schemes of the app only', async () => {
    const importProxies = vi.fn();
    const result = await callTool(
      stubManager({ importProxies }),
      'add_proxies',
      { text: 'x', default_scheme: 'ftp' },
    );
    expect(result.isError).toBe(true);
    expect(importProxies).not.toHaveBeenCalled();
  });
});

describe('check_proxy', () => {
  const checking = proxyFixture({
    id: 5,
    check: { ...failedCheck, status: 'checking', ok: null, error: null },
  });

  it('starts a check, waits for it and answers with the result', async () => {
    const checkProxy = vi.fn(() => checking);
    const states = [checking, checking, proxyFixture({ id: 5 })];
    const manager = stubManager({
      checkProxy,
      proxy: () => states.shift() ?? proxyFixture({ id: 5 }),
    });
    expect(
      jsonOf(await callTool(manager, 'check_proxy', { proxy_id: 5 })),
    ).toMatchObject({
      id: 5,
      health: 'ok',
      exit_ip: '203.0.113.1',
      country: 'US',
    });
    expect(checkProxy).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('answers with the failure of a check that failed', async () => {
    const failed = proxyFixture({ id: 5, check: failedCheck });
    const manager = stubManager({
      checkProxy: () => checking,
      proxy: () => failed,
    });
    expect(
      jsonOf(await callTool(manager, 'check_proxy', { proxy_id: 5 })),
    ).toMatchObject({
      health: 'failed',
      error: 'connection refused',
    });
  });

  it('answers with the proxy as it is after 40 seconds, still being checked', async () => {
    vi.useFakeTimers();
    const manager = stubManager({
      checkProxy: () => checking,
      proxy: () => checking,
    });
    const waiting = callTool(manager, 'check_proxy', { proxy_id: 5 }, 1);
    await vi.advanceTimersByTimeAsync(39_000);
    let done = false;
    void waiting.then(() => {
      done = true;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(jsonOf(await waiting)).toMatchObject({ id: 5, health: 'checking' });
  });

  it('says so when there is no such proxy', async () => {
    const manager = stubManager({
      checkProxy() {
        throw new AppError(
          404,
          'proxy_not_found',
          'That proxy does not exist.',
        );
      },
    });
    const result = await callTool(manager, 'check_proxy', { proxy_id: 9 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('That proxy does not exist.');
  });

  it('needs the id of a proxy', async () => {
    const result = await callTool(stubManager(), 'check_proxy', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- proxy_id: ');
  });
});

describe('check_proxies', () => {
  it('starts the check of every proxy and says how many', async () => {
    const checkAllProxies = vi.fn(() => pool);
    const manager = stubManager({ checkAllProxies });
    expect(textOf(await callTool(manager, 'check_proxies'))).toBe(
      'Checking 4 proxies.',
    );
    expect(checkAllProxies).toHaveBeenCalledOnce();
  });
});

describe('delete_proxy', () => {
  it('removes the proxy and says so', async () => {
    const deleteProxy = vi.fn();
    const manager = stubManager({ deleteProxy });
    expect(
      textOf(await callTool(manager, 'delete_proxy', { proxy_id: 7 })),
    ).toBe('Deleted proxy 7.');
    expect(deleteProxy).toHaveBeenCalledExactlyOnceWith(7, { force: false });
  });

  it('can force the removal of the proxy of a stopped session', async () => {
    const deleteProxy = vi.fn();
    const manager = stubManager({ deleteProxy });
    await callTool(manager, 'delete_proxy', { proxy_id: 7, force: true });
    expect(deleteProxy).toHaveBeenCalledWith(7, { force: true });
  });

  it('says what stands in the way', async () => {
    const manager = stubManager({
      deleteProxy() {
        throw new AppError(
          409,
          'proxy_in_use',
          'Session 0001 uses proxy http://192.0.2.1:8080.',
        );
      },
    });
    const result = await callTool(manager, 'delete_proxy', { proxy_id: 1 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('uses proxy');
  });
});
