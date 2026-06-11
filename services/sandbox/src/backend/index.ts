// Backend selection. Chosen once at boot from `cfg.backend` (env
// SANDBOX_BACKEND, default 'docker'): the Docker Compose path or the native
// Kubernetes Pod-per-exec path.

import { DockerBackend } from './docker/docker-backend.ts';
import { DockerSessionBackend } from './docker/docker-session-backend.ts';
import { KubernetesBackend } from './kubernetes/k8s-backend.ts';
import { KubernetesSessionBackend } from './kubernetes/k8s-session-backend.ts';
import type {
  ExecutionBackend,
  SessionBackend,
  SpawnerConfig,
} from './types.ts';

export function createBackend(cfg: SpawnerConfig): ExecutionBackend {
  switch (cfg.backend) {
    case 'kubernetes':
      return new KubernetesBackend(cfg);
    case 'docker':
    default:
      return new DockerBackend(cfg);
  }
}

/**
 * Session backend (persistent sessions). Separate from createBackend so the
 * one-shot path is untouched. The K8s session backend lands in milestone C;
 * until then a kubernetes deployment that hits the session routes gets a
 * clear error rather than a silent half-feature.
 */
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
