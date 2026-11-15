// The per-host views of a spawner config that names several Incus hosts
// (SANDBOX_INCUS_ENDPOINTS): one spawner config per entry, in which the flat
// Incus settings, the egress proxy and the session cap are that host's. Each
// host backend, session backend and warm pool is made from its own view, so
// everything that reads `cfg.incus` (the boot checks, the session spec, the
// pool's room) reads one host and nothing else. A config of one host
// (SANDBOX_INCUS_ENDPOINT) is its own only view.
//
// Plain code: the capacity reader and the backend loader both call it, and
// it loads nothing that talks to a node.

import type { IncusEndpointConfig, SpawnerConfig } from '../../types.ts';

const views = new WeakMap<SpawnerConfig, readonly SpawnerConfig[]>();

/** The config as seen by one host of it. */
export function endpointView(
  cfg: SpawnerConfig,
  entry: IncusEndpointConfig,
): SpawnerConfig {
  const incus = cfg.incus;
  if (incus === undefined) {
    throw new Error('the Incus backend needs SANDBOX_BACKEND=incus');
  }
  const { endpoints: _all, ...shared } = incus;
  return {
    ...cfg,
    egressProxy: entry.egressProxy,
    session: { ...cfg.session, maxSessions: entry.maxSessions },
    incus: {
      ...shared,
      endpointName: entry.name,
      endpoint: entry.endpoint,
      clientCertFile: entry.clientCertFile,
      clientKeyFile: entry.clientKeyFile,
      serverCertFile: entry.serverCertFile,
      project: entry.project,
      profile: entry.profile,
      network: entry.network,
      storagePool: entry.storagePool,
      image: entry.image,
      poolSize: entry.poolSize,
      dns: entry.dns,
    },
  };
}

/** One config per Incus host, in the order they were declared; the same
 * objects on every call, so the runtime each one keys is made once. */
export function incusEndpointConfigs(
  cfg: SpawnerConfig,
): readonly SpawnerConfig[] {
  let found = views.get(cfg);
  if (found === undefined) {
    const entries = cfg.incus?.endpoints;
    found =
      entries === undefined
        ? [cfg]
        : entries.map((entry) => endpointView(cfg, entry));
    views.set(cfg, found);
  }
  return found;
}

/** The name an endpoint goes by in logs: its declared name, or its origin. */
export function endpointLabel(cfg: SpawnerConfig): string {
  return cfg.incus?.endpointName ?? cfg.incus?.endpoint ?? 'incus';
}
