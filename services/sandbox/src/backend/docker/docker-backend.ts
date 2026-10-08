// DockerBackend — the Compose host lifecycle. Every sandbox run is a session
// now (see docker-session-backend.ts), so this backend no longer executes code:
// it owns only the spawner's host-level lifecycle — the cross-process host-lock
// + boot orphan sweep (init), image warm, the /health probe, graceful shutdown,
// and the periodic orphan sweep, whose legacy one-shot half runs only hourly
// (it finds nothing, since `tale.sandbox=1` one-shot containers are never
// created anymore).

import {
  acquireSpawnerLock,
  bootSweep,
  dockerSweepOrphans,
  LEGACY_SWEEP_INTERVAL_MS,
  releaseSpawnerLock,
} from '../../cleanup.ts';
import {
  ensureImage,
  runDocker,
  type RunDockerResult,
} from '../../spawn-util.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { HostBackend, HealthResult, SweepOptions } from '../types.ts';

/** What a `docker version` call says about the daemon. A call that found no
 * docker CLI slot in time never reached it: that answer is transient, so the
 * health cache does not report the daemon unhealthy for a minute over it. */
export function dockerHealth(version: RunDockerResult): HealthResult {
  if (version.exitCode === 0) {
    return { ok: true, detail: version.stdout.trim() };
  }
  const error = version.stderr.trim() || version.stdout.trim();
  return version.noSlot === true
    ? { ok: false, error, transient: true }
    : { ok: false, error };
}

export interface DockerBackendDeps {
  /** The lock + boot sweep `init` runs. */
  boot?: (cfg: SpawnerConfig) => Promise<void>;
  sweep?: typeof dockerSweepOrphans;
  now?: () => number;
}

async function bootHost(cfg: SpawnerConfig): Promise<void> {
  // Cross-process lock BEFORE bootSweep — refuses to start if another live
  // spawner shares this hostSessionRoot, so bootSweep's host-dir sweep can't
  // delete a peer's in-flight workspace.
  await acquireSpawnerLock(cfg);
  await bootSweep(cfg);
}

export class DockerBackend implements HostBackend {
  readonly kind = 'docker' as const;
  private readonly boot: (cfg: SpawnerConfig) => Promise<void>;
  private readonly sweep: typeof dockerSweepOrphans;
  private readonly now: () => number;
  /** When the periodic sweep next runs its legacy one-shot half. */
  private legacySweepDueAtMs = 0;

  constructor(
    private readonly cfg: SpawnerConfig,
    deps: DockerBackendDeps = {},
  ) {
    this.boot = deps.boot ?? bootHost;
    this.sweep = deps.sweep ?? dockerSweepOrphans;
    this.now = deps.now ?? Date.now;
  }

  async init(): Promise<void> {
    // Throwing here is fatal (server.ts exits 1). The first periodic sweep
    // runs the legacy one-shot half once more: the boot sweep's listing
    // reads a daemon that did not answer as an empty list, and one extra
    // listing per boot is cheaper than trusting it for an hour.
    await this.boot(this.cfg);
  }

  async shutdown(): Promise<void> {
    await releaseSpawnerLock(this.cfg);
  }

  async health(): Promise<HealthResult> {
    // `docker version --format` over `docker info` — smaller, API-stable
    // surface across the 20.10 ↔ 29.x CLI gap (see server.ts probe note).
    // Bounded tightly: the compose healthcheck polls this every 10 s, and a
    // wedged daemon must surface as `unhealthy` in one cycle rather than pile
    // up hung `docker version` children. A short call: it never queues
    // behind a burst of creates.
    return dockerHealth(
      await runDocker(['version', '--format', '{{.Server.Version}}'], {
        timeoutMs: 5_000,
        priority: true,
      }),
    );
  }

  async warmImage(): Promise<void> {
    await ensureImage(this.cfg.runtimeImage);
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    // A legacy pass whose `docker ps` failed is due again at the next tick.
    const legacy = this.now() >= this.legacySweepDueAtMs;
    const { removed, legacySwept } = await this.sweep(
      this.cfg,
      opts.staleBeforeMs,
      opts.isLive,
      { legacy },
    );
    if (legacySwept) {
      this.legacySweepDueAtMs = this.now() + LEGACY_SWEEP_INTERVAL_MS;
    }
    return removed;
  }
}
