// The package registry caches an Incus session installs through, as the
// operator names them (SANDBOX_INCUS_NPM_REGISTRY, SANDBOX_INCUS_PYPI_INDEX):
// read at boot, held to what a session can reach, and turned into what the
// instance is given. Pure.
//
// A sandbox's bridge answers only the egress proxy and the addresses its
// network ACL admits, and its resolver forwards nothing, so a cache is named by
// an IPv4 literal, as SANDBOX_EGRESS_PROXY is. Both caches answer plain HTTP on
// the node's own network and are read-only: a session only ever downloads from
// them, public packages only. Nothing here is a credential.
//
// Off unless set: a deployment that sets neither variable gets the instance it
// got before these existed.

import { isIpv4Address } from '../../network-address.ts';
import type { RegistryCaches } from '../../types.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The public registry hosts a cache replaces, per ecosystem. The egress proxy
 * is told to refuse them (SANDBOX_EGRESS_DENIED_HOSTS) so that a package
 * manager that ignores its configuration fails visibly instead of installing
 * around the cache. A test holds the documented value to this list.
 */
export const REGISTRY_HOSTS = {
  npm: ['registry.npmjs.org', 'registry.yarnpkg.com'],
  pypi: ['pypi.org', 'files.pythonhosted.org'],
} as const;

/** What the entrypoint reads to write the session's package manager files. */
export const REGISTRY_CACHE_ENV = {
  npm: 'TALE_REGISTRY_CACHE_NPM',
  pypi: 'TALE_REGISTRY_CACHE_PYPI',
} as const;

/**
 * An http URL whose host is made of digits and dots, with an optional port and
 * a path of characters that mean the same in an .npmrc, an ini file, a TOML
 * string and a shell word: no quote, space, backslash, `#`, `;`, `?` or `$`.
 * Whether the host is an IPv4 address is `isIpv4Address`'s to say, so that a
 * cache is held to the grammar every other address setting of the spawner is.
 */
const CACHE_URL_RE =
  /^http:\/\/([0-9.]+)(?::[1-9]\d{0,4})?(?:\/[A-Za-z0-9._~+/%-]*)?$/;

function cacheUrl(env: Env, name: string, example: string): string | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  const refusal = new Error(
    `Env var ${name} must be an http URL whose host is an IPv4 address, such as ${example}: a session resolves no name before it reaches a cache, and a cache answers plain HTTP on the node's own network; got: ${JSON.stringify(value)}`,
  );
  const host = CACHE_URL_RE.exec(value)?.[1];
  if (host === undefined || !isIpv4Address(host)) throw refusal;
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(refusal.message, { cause: error });
  }
  return url.href;
}

/** The caches the environment names, or undefined when it names none. */
export function readRegistryCaches(env: Env): RegistryCaches | undefined {
  const npm = cacheUrl(
    env,
    'SANDBOX_INCUS_NPM_REGISTRY',
    'http://10.200.41.8:4873/',
  );
  const pypi = cacheUrl(
    env,
    'SANDBOX_INCUS_PYPI_INDEX',
    'http://10.200.41.9:3141/root/pypi/+simple/',
  );
  if (npm === undefined && pypi === undefined) return undefined;
  return {
    ...(npm === undefined ? {} : { npm }),
    ...(pypi === undefined ? {} : { pypi }),
  };
}

/** The cache addresses, once each, as `NO_PROXY` lists a host: the proxy
 * refuses private destinations, so a session must reach a cache directly. */
export function registryCacheHosts(
  caches: RegistryCaches | undefined,
): string[] {
  const hosts = [caches?.npm, caches?.pypi].flatMap((url) =>
    url === undefined ? [] : [new URL(url).hostname],
  );
  return [...new Set(hosts)];
}

/** The instance variables that carry the caches to the entrypoint. */
export function registryCacheEnvironment(
  caches: RegistryCaches | undefined,
): Record<string, string> {
  return {
    ...(caches?.npm === undefined
      ? {}
      : { [REGISTRY_CACHE_ENV.npm]: caches.npm }),
    ...(caches?.pypi === undefined
      ? {}
      : { [REGISTRY_CACHE_ENV.pypi]: caches.pypi }),
  };
}

/** The registry hosts the egress proxy should refuse for these caches. */
export function deniedRegistryHosts(
  caches: RegistryCaches | undefined,
): string[] {
  return [
    ...(caches?.npm === undefined ? [] : REGISTRY_HOSTS.npm),
    ...(caches?.pypi === undefined ? [] : REGISTRY_HOSTS.pypi),
  ];
}

/** One boot line: what is configured, and what to tell the proxy. */
export function describeRegistryCaches(caches: RegistryCaches): string {
  const named = [
    ...(caches.npm === undefined ? [] : [`npm ${caches.npm}`]),
    ...(caches.pypi === undefined ? [] : [`pypi ${caches.pypi}`]),
  ].join(', ');
  return `sessions install through the registry caches (${named}); set SANDBOX_EGRESS_DENIED_HOSTS=${deniedRegistryHosts(caches).join(',')} on the egress proxy so that a package manager that ignores its configuration fails visibly`;
}
