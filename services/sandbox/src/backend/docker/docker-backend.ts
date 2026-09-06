// DockerBackend — the Compose host lifecycle. Every sandbox run is a session
// now (see docker-session-backend.ts), so this backend no longer executes code:
// it owns only the spawner's host-level lifecycle — the cross-process host-lock
// + boot orphan sweep (init), image warm, the /health probe, graceful shutdown,
// and the periodic legacy one-shot orphan sweep (which finds nothing, since
// `tale.sandbox=1` one-shot containers are never created anymore).

import {
  acquireSpawnerLock,
  bootSweep,
  dockerSweepOrphans,
  releaseSpawnerLock,
} from '../../cleanup.ts';
import { ensureImage, runDocker } from '../../spawn-util.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { ExecutionBackend, HealthResult, SweepOptions } from '../types.ts';

export class DockerBackend implements ExecutionBackend {
  readonly kind = 'docker' as const;

  constructor(private readonly cfg: SpawnerConfig) {}

  async init(): Promise<void> {
    // Cross-process lock BEFORE bootSweep — refuses to start if another live
    // spawner shares this hostSessionRoot, so bootSweep's host-dir sweep can't
    // delete a peer's in-flight workspace (audit finding R2-B5). Throwing here
    // is fatal (server.ts exits 1).
    await acquireSpawnerLock(this.cfg);
    await bootSweep(this.cfg);
  }

  async shutdown(): Promise<void> {
    await releaseSpawnerLock(this.cfg);
  }

  async health(): Promise<HealthResult> {
    // `docker version --format` over `docker info` — smaller, API-stable
    // surface across the 20.10 ↔ 29.x CLI gap (see server.ts probe note).
    // Bounded tightly: the compose healthcheck polls this every 10 s, and a
    // wedged daemon must surface as `unhealthy` in one cycle rather than pile
    // up hung `docker version` children.
    const info = await runDocker(
      ['version', '--format', '{{.Server.Version}}'],
      { timeoutMs: 5_000 },
    );
    if (info.exitCode !== 0) {
      return { ok: false, error: info.stderr.trim() || info.stdout.trim() };
    }
    return { ok: true, detail: info.stdout.trim() };
  }

  async warmImage(): Promise<void> {
    await ensureImage(this.cfg.runtimeImage);
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    return dockerSweepOrphans(this.cfg, opts.staleBeforeMs, opts.isLive);
  }
}
