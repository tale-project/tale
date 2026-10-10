// DockerBackend — the Compose host lifecycle. Every sandbox run is a session
// now (see docker-session-backend.ts), so this backend no longer executes code:
// it owns only the spawner's host-level lifecycle — the cross-process host-lock
// + boot orphan sweep (init), the boot live-restore check, image warm, the
// /health probe, graceful shutdown, and the periodic orphan sweep, whose
// legacy one-shot half runs only hourly (it finds nothing, since
// `tale.sandbox=1` one-shot containers are never created anymore).

import {
  acquireSpawnerLock,
  bootSweep,
  dockerSweepOrphans,
  LEGACY_SWEEP_INTERVAL_MS,
  releaseSpawnerLock,
} from '../../cleanup.ts';
import { makePackageCacheSweep } from '../../package-cache-retention.ts';
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

/** The self-hosted docs section that explains Docker's live restore. */
export const LIVE_RESTORE_DOCS_URL =
  'https://docs.tale.dev/self-hosted/operate/container-architecture#keep-sessions-running-through-a-docker-restart';

/** What the daemon says about restarting under its containers: whether
 * `live-restore` is on, and whether the node is in Swarm mode, which refuses
 * it. Null when `docker info` gave no usable answer. */
export function parseLiveRestore(
  info: RunDockerResult,
): { enabled: boolean; swarm: boolean } | null {
  if (info.exitCode !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(info.stdout);
  } catch (error) {
    console.warn('[sandbox] docker info answered unreadable JSON:', error);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const enabled = 'liveRestore' in parsed ? parsed.liveRestore : undefined;
  if (typeof enabled !== 'boolean') return null;
  const swarm = 'swarm' in parsed ? parsed.swarm : undefined;
  return { enabled, swarm: swarm === 'active' || swarm === 'locked' };
}

/**
 * Without the daemon's live restore, any dockerd restart (a package upgrade,
 * a daemon.json change) stops every session container and the spawner with
 * it: running agent turns, builds and renders end mid-way. The host's daemon
 * configuration is the operator's, so the spawner only says so, once at
 * boot. Resolves with what it found (null when the daemon could not say).
 */
export async function checkLiveRestore(
  run: typeof runDocker = runDocker,
): Promise<{ enabled: boolean; swarm: boolean } | null> {
  const info = await run(
    [
      'info',
      '--format',
      '{"liveRestore":{{json .LiveRestoreEnabled}},"swarm":{{json .Swarm.LocalNodeState}}}',
    ],
    { timeoutMs: 10_000, stdoutMaxBytes: 4_096 },
  );
  const found = parseLiveRestore(info);
  if (found === null) {
    console.warn(
      `[sandbox] could not read the Docker daemon's live-restore setting (exit ${info.exitCode}): ${info.stderr.trim() || 'no output'}`,
    );
  } else if (!found.enabled) {
    console.warn(
      found.swarm
        ? `[sandbox] this Docker host is a Swarm node, which cannot use live restore: restarting its Docker daemon stops every sandbox session and the spawner. See ${LIVE_RESTORE_DOCS_URL}`
        : `[sandbox] Docker live restore is off: restarting the Docker daemon (an upgrade, a daemon.json change) stops every sandbox session and the spawner. Set "live-restore": true in /etc/docker/daemon.json and reload the daemon; see ${LIVE_RESTORE_DOCS_URL}`,
    );
  }
  return found;
}

export interface DockerBackendDeps {
  /** The lock + boot sweep `init` runs. */
  boot?: (cfg: SpawnerConfig) => Promise<void>;
  sweep?: typeof dockerSweepOrphans;
  sweepPackageCaches?: () => Promise<number>;
  now?: () => number;
}

async function bootHost(cfg: SpawnerConfig): Promise<void> {
  // Cross-process lock BEFORE bootSweep — refuses to start if another live
  // spawner shares this hostSessionRoot, so bootSweep's host-dir sweep can't
  // delete a peer's in-flight workspace.
  await acquireSpawnerLock(cfg);
  await bootSweep(cfg);
  // Beside startup, never in its way: a daemon slow to answer delays no
  // session, and the answer is only ever a warning.
  void checkLiveRestore().catch((error: unknown) => {
    console.warn('[sandbox] the live-restore check failed:', error);
  });
}

export class DockerBackend implements HostBackend {
  readonly kind = 'docker' as const;
  private readonly boot: (cfg: SpawnerConfig) => Promise<void>;
  private readonly sweep: typeof dockerSweepOrphans;
  private readonly now: () => number;
  /** When the periodic sweep next runs its legacy one-shot half. */
  private legacySweepDueAtMs = 0;

  /** Removes the package caches no organization used for their retention;
   * hourly, whatever the sweep's own interval. */
  private readonly sweepPackageCaches: () => Promise<number>;

  constructor(
    private readonly cfg: SpawnerConfig,
    deps: DockerBackendDeps = {},
  ) {
    this.boot = deps.boot ?? bootHost;
    this.sweep = deps.sweep ?? dockerSweepOrphans;
    this.now = deps.now ?? Date.now;
    this.sweepPackageCaches =
      deps.sweepPackageCaches ?? makePackageCacheSweep(cfg);
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

  /** Throws while the image stays absent, so the warmup keeps creates
   * waiting and tries again instead of reading a failed pull as done. */
  async warmImage(): Promise<void> {
    let failure = '';
    const present = await ensureImage(this.cfg.runtimeImage, {
      onFailure: (detail) => {
        failure = detail;
      },
    });
    if (!present) {
      throw new Error(
        `the runtime image ${this.cfg.runtimeImage} is not on this host and could not be pulled${failure === '' ? '' : `: ${failure}`}`,
      );
    }
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
    return removed + (await this.sweepPackageCaches());
  }
}
