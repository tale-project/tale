import { expect } from '@playwright/test';

import type { Proxy, Session } from '../../../lib/api/schemas';
import type { AppApi } from './api';
import { TIMEOUT } from './env';

/**
 * How long a fake check takes where a spec has to see a proxy "Checking":
 * long enough for a slow machine to catch it, short enough to wait out.
 */
export const SLOW_CHECK_MS = 3_000;

/** The proxies whose check ended, working or not: none is "checking". */
export async function untilChecked(api: AppApi): Promise<Proxy[]> {
  let pool: Proxy[] = [];
  await expect
    .poll(
      async () => {
        pool = await api.proxies();
        return pool.every(
          (proxy) =>
            proxy.check.status === 'ok' || proxy.check.status === 'failed',
        );
      },
      {
        timeout: TIMEOUT.BACKGROUND,
        message: 'every proxy of the pool has been checked',
      },
    )
    .toBe(true);
  return pool;
}

/**
 * Puts the lines into the pool, one proxy each, and waits for their checks.
 * Answers the proxies as the pool has them then, in the order of the lines.
 */
export async function importChecked(
  api: AppApi,
  ...lines: string[]
): Promise<Proxy[]> {
  const { added } = await api.importProxies(lines.join('\n'));
  const pool = await untilChecked(api);
  return added.map((one) => {
    const proxy = pool.find((candidate) => candidate.id === one.id);
    if (proxy === undefined)
      throw new Error(`proxy ${one.id} is not in the pool`);
    return proxy;
  });
}

/**
 * A session that holds the proxy of this line: the proxy is imported, then the
 * session is added, which takes the oldest free proxy, so call it before the
 * pool has other free proxies. The session is left running or stopped.
 */
export async function sessionHolding(
  api: AppApi,
  name: string,
  line: string,
  state: 'running' | 'stopped' = 'running',
): Promise<{ session: Session; proxy: Proxy }> {
  const [proxy] = await importChecked(api, line);
  const created = await api.createSession(name);
  const running = await api.waitForStatus(created.id, 'running');
  const session =
    state === 'running' ? running : await api.stopSession(created.id);
  expect(session.proxy?.id, `${name} holds the proxy of ${line}`).toBe(
    proxy.id,
  );
  return { session, proxy };
}

/**
 * Empties the pool, a page of the API at a time. `AppApi.reset` does the same
 * at the start of every spec; a spec that makes a large pool takes it away
 * itself at its end as well, so that the next spec on the worker does not pay
 * for it.
 */
export async function removeAllProxies(api: AppApi): Promise<void> {
  for (
    let pool = await api.proxies();
    pool.length > 0;
    pool = await api.proxies()
  ) {
    for (const proxy of pool) await api.deleteProxy(proxy.id);
  }
}
