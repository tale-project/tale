// Backend selection. Chosen once at boot from `cfg.backend` (env
// SANDBOX_BACKEND, default 'docker'): the Docker Compose path or the native
// Kubernetes Pod-per-exec path.

import { DockerBackend } from './docker/docker-backend.ts';
import { KubernetesBackend } from './kubernetes/k8s-backend.ts';
import type { ExecutionBackend, SpawnerConfig } from './types.ts';

export function createBackend(cfg: SpawnerConfig): ExecutionBackend {
  switch (cfg.backend) {
    case 'kubernetes':
      return new KubernetesBackend(cfg);
    case 'docker':
    default:
      return new DockerBackend(cfg);
  }
}

export type { HealthResult } from './types.ts';
