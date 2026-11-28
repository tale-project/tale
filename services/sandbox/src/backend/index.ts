// Backend selection. Chosen once at boot from `cfg.backend` (env
// SANDBOX_BACKEND, default 'docker'): the Docker Compose path, the native
// Kubernetes Pod-per-session path, the Incus instance-per-session path
// (on one host, or on several behind the placement of incus-multi-backend.ts),
// or a connected device's own host with no container at all (raw).
//
// The Kubernetes backends are imported only when selected: they pull in
// @kubernetes/client-node, about 100 MiB resident and a few hundred
// milliseconds of import that every Docker spawner and connected device would
// otherwise carry for nothing. The Incus backends are imported only when
// selected too, for the same reason of not loading what a deployment does not
// run.

import { DockerBackend } from './docker/docker-backend.ts';
import { DockerSessionBackend } from './docker/docker-session-backend.ts';
import type { HostBackend, SessionBackend, SpawnerConfig } from './types.ts';

export interface Backends {
  /** The host lifecycle backend. Constructing it has no side effects. */
  host: HostBackend;
  /** Constructs the session lifecycle backend; the caller decides when. */
  createSession: () => SessionBackend;
}

export async function loadBackends(cfg: SpawnerConfig): Promise<Backends> {
  if (cfg.backend === 'kubernetes') {
    const [{ KubernetesBackend }, { KubernetesSessionBackend }] =
      await Promise.all([
        import('./kubernetes/k8s-backend.ts'),
        import('./kubernetes/k8s-session-backend.ts'),
      ]);
    return {
      host: new KubernetesBackend(cfg),
      createSession: () => new KubernetesSessionBackend(cfg),
    };
  }
  if (cfg.backend === 'incus' && cfg.incus?.endpoints !== undefined) {
    // Several hosts (SANDBOX_INCUS_ENDPOINTS): one pair of backends per host
    // behind the placement layer.
    const { getIncusEndpointSet, MultiIncusBackend, MultiIncusSessionBackend } =
      await import('./incus/incus-multi-backend.ts');
    const set = getIncusEndpointSet(cfg);
    return {
      host: new MultiIncusBackend(set),
      createSession: () => new MultiIncusSessionBackend(set),
    };
  }
  if (cfg.backend === 'incus') {
    const [{ IncusBackend }, { IncusSessionBackend }] = await Promise.all([
      import('./incus/incus-backend.ts'),
      import('./incus/incus-session-backend.ts'),
    ]);
    return {
      host: new IncusBackend(cfg),
      createSession: () => new IncusSessionBackend(cfg),
    };
  }
  if (cfg.backend === 'raw' && cfg.raw !== undefined) {
    // A connected device that runs its sessions on its own host, as plain
    // processes (docs/raw.md).
    const raw = cfg.raw;
    const [{ RawHostBackend }, { RawSessionBackend }] = await Promise.all([
      import('./raw/raw-backend.ts'),
      import('./raw/raw-session-backend.ts'),
    ]);
    let sessions: InstanceType<typeof RawSessionBackend> | null = null;
    return {
      host: new RawHostBackend(cfg, raw, { sessions: () => sessions }),
      createSession: () => {
        sessions = new RawSessionBackend(cfg, raw);
        return sessions;
      },
    };
  }
  return {
    host: new DockerBackend(cfg),
    createSession: () => new DockerSessionBackend(cfg),
  };
}

export type { HealthResult } from './types.ts';
