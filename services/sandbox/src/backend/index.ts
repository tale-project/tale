// Backend selection. Chosen once at boot from `cfg.backend` (env
// SANDBOX_BACKEND, default 'docker'): the Docker Compose path or the native
// Kubernetes Pod-per-session path.

import { DockerBackend } from './docker/docker-backend.ts';
import { DockerSessionBackend } from './docker/docker-session-backend.ts';
import { KubernetesBackend } from './kubernetes/k8s-backend.ts';
import { KubernetesSessionBackend } from './kubernetes/k8s-session-backend.ts';
import type { HostBackend, SessionBackend, SpawnerConfig } from './types.ts';

export function createHostBackend(cfg: SpawnerConfig): HostBackend {
  switch (cfg.backend) {
    case 'kubernetes':
      return new KubernetesBackend(cfg);
    case 'docker':
    default:
      return new DockerBackend(cfg);
  }
}

export function createSessionBackend(cfg: SpawnerConfig): SessionBackend {
  switch (cfg.backend) {
    case 'kubernetes':
      return new KubernetesSessionBackend(cfg);
    case 'docker':
    default:
      return new DockerSessionBackend(cfg);
  }
}

export type { HealthResult } from './types.ts';
