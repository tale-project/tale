import type { Proxy } from '@/lib/api/schemas';

/** `host:port`, with an IPv6 host in brackets as it is written. */
export function hostPortOf(proxy: Pick<Proxy, 'host' | 'port'>): string {
  const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
  return `${host}:${proxy.port}`;
}

/**
 * The front of the address, `scheme://` and the user name. The API has no
 * password to show: only whether there is one.
 */
export function addressPrefixOf(
  proxy: Pick<Proxy, 'scheme' | 'username'>,
): string {
  const user = proxy.username === null ? '' : `${proxy.username}@`;
  return `${proxy.scheme}://${user}`;
}

/** The whole address, `scheme://[user@]host:port`. */
export function addressOf(
  proxy: Pick<Proxy, 'scheme' | 'username' | 'host' | 'port'>,
): string {
  return `${addressPrefixOf(proxy)}${hostPortOf(proxy)}`;
}

/**
 * `host:port` of a credential-free display such as `socks5://user@host:port`.
 * A user name may hold an `@` itself, so everything up to the last one goes.
 */
export function hostPortOfDisplay(display: string): string {
  return display.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^.*@/, '');
}
