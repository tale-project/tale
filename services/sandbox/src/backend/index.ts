// Backend selection. Chosen once at boot from `cfg.backend` (env
// SANDBOX_BACKEND, default 'docker'). The Docker Compose path is the default;
// 'kubernetes' lands in Phase 2.

import { DockerBackend } from './docker/docker-backend.ts';
import type { ExecutionBackend, SpawnerConfig } from './types.ts';

export function createBackend(cfg: SpawnerConfig): ExecutionBackend {
  switch (cfg.backend) {
    case 'kubernetes':
      throw new Error(
        "SANDBOX_BACKEND='kubernetes' is not implemented yet (Phase 2). " +
          'Set SANDBOX_BACKEND=docker (the default) for the Compose path.',
      );
    case 'docker':
    default:
      return new DockerBackend(cfg);
  }
}

export type {
  CacheStores,
  ExecutionBackend,
  HealthResult,
  LaunchSpec,
  RunningExecution,
  RunOptions,
  RunResult,
  SweepOptions,
  Workspace,
} from './types.ts';
