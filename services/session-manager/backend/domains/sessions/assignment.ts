// Which proxy a session gets. The rules are the README's: exclusive (a proxy
// belongs to at most one session) and one IP per session (a proxy whose last
// known exit IP is that of a proxy another session has is not assigned either).

import type { ProxyState } from '../../db/store.ts';

/**
 * The assignable proxies, best first. A proxy is assignable when no session
 * has it (and none is being assigned it: `taken`), its last check did not
 * fail, and its last known exit IP is not that of a taken proxy. Working
 * proxies come before unchecked ones, by id (so by age) within each group.
 */
export function rankCandidates(
  proxies: readonly ProxyState[],
  taken: ReadonlySet<number>,
): ProxyState[] {
  const takenIps = new Set<string>();
  for (const proxy of proxies) {
    if (taken.has(proxy.id) && proxy.exitIp) takenIps.add(proxy.exitIp);
  }
  return proxies
    .filter(
      (proxy) =>
        !taken.has(proxy.id) &&
        proxy.ok !== false &&
        !(proxy.exitIp !== null && takenIps.has(proxy.exitIp)),
    )
    .sort(
      (a, b) => Number(a.ok !== true) - Number(b.ok !== true) || a.id - b.id,
    );
}
