// DockerBackend — the Compose execution path, unchanged behavior.
//
// This is a thin adapter: it wires the existing, audited docker modules
// (docker-args.ts argv builder, spawn-util.ts subprocess wrapper, volume.ts
// cache volumes, cleanup.ts host-session lock + orphan sweep) to the
// ExecutionBackend interface. No docker mechanics live here that didn't live
// in spawn.ts / cleanup.ts before; the argv, the two-tier timeout, the
// TERM→KILL cancel escalation, and the sweep semantics are all preserved
// verbatim so the existing unit tests remain the proof of parity.

import {
  acquireSpawnerLock,
  bootSweep,
  dockerSweepOrphans,
  releaseSpawnerLock,
} from '../../cleanup.ts';
import { buildDockerRunArgs } from '../../docker-args.ts';
import {
  dockerKill,
  dockerRm,
  ensureImage,
  runDocker,
} from '../../spawn-util.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  ensureCacheVolume,
  npmCacheVolumeName,
  pipCacheVolumeName,
} from '../../volume.ts';
import type {
  CacheStores,
  ExecutionBackend,
  HealthResult,
  LaunchSpec,
  RunningExecution,
  RunOptions,
  RunResult,
  SweepOptions,
  Workspace,
} from '../types.ts';
import { HostDirWorkspace } from './host-dir-workspace.ts';

class DockerRunningExecution implements RunningExecution {
  constructor(
    private readonly containerName: string,
    private readonly argv: string[],
    // Inner (user) wall-clock cap. The container is SIGKILLed at this; the
    // runDocker `timeoutMs` (RunOptions.outerTimeoutMs) is the +30s backstop
    // that also kills the docker CLI subprocess if the daemon wedges.
    private readonly userTimeoutMs: number,
  ) {}

  async wait(opts: RunOptions): Promise<RunResult> {
    const killTimer = setTimeout(() => {
      // Bounded so a wedged docker daemon doesn't leak the Bun subprocess
      // (audit follow-up F4). Same 5s ceiling as cancel.
      void dockerKill(this.containerName, 'KILL', { timeoutMs: 5_000 }).catch(
        (err) => {
          console.warn(
            `[sandbox] timeout-triggered dockerKill failed for ${this.containerName}:`,
            err,
          );
        },
      );
    }, this.userTimeoutMs);
    try {
      return await runDocker(this.argv, {
        timeoutMs: opts.outerTimeoutMs,
        signal: opts.signal,
        killOnTimeoutContainer: this.containerName,
        stdoutMaxBytes: opts.stdoutMaxBytes,
        stderrMaxBytes: opts.stderrMaxBytes,
        ...(opts.onStdoutChunk && { onStdoutChunk: opts.onStdoutChunk }),
        ...(opts.onStderrChunk && { onStderrChunk: opts.onStderrChunk }),
      });
    } finally {
      clearTimeout(killTimer);
    }
  }

  async remove(): Promise<void> {
    try {
      await dockerRm(this.containerName);
    } catch (err) {
      console.warn(
        `[sandbox.cleanup] dockerRm failed for ${this.containerName}:`,
        err,
      );
    }
  }
}

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
    const info = await runDocker([
      'version',
      '--format',
      '{{.Server.Version}}',
    ]);
    if (info.exitCode !== 0) {
      return { ok: false, error: info.stderr.trim() || info.stdout.trim() };
    }
    return { ok: true, detail: info.stdout.trim() };
  }

  async warmImage(): Promise<void> {
    await ensureImage(this.cfg.runtimeImage);
  }

  async createWorkspace(executionId: string): Promise<Workspace> {
    return new HostDirWorkspace(this.cfg.hostSessionRoot, executionId);
  }

  async ensureCacheStore(organizationId: string): Promise<CacheStores> {
    const pip = pipCacheVolumeName(this.cfg, organizationId);
    const npm = npmCacheVolumeName(this.cfg, organizationId);
    await ensureCacheVolume(pip);
    await ensureCacheVolume(npm);
    return { pip, npm };
  }

  async launch(
    spec: LaunchSpec,
    cache: CacheStores,
  ): Promise<RunningExecution> {
    const containerName = `tale-sbx-${spec.executionId}`;
    const argv = buildDockerRunArgs(this.cfg, {
      executionId: spec.executionId,
      organizationId: spec.organizationId,
      language: spec.language,
      timeoutMs: spec.timeoutMs,
      pipCacheVolume: cache.pip,
      npmCacheVolume: cache.npm,
      workspaceHostDir: spec.workspace.localRoot,
      startedAtMs: spec.startedAtMs,
      entryPath: spec.entryPath,
    });
    return new DockerRunningExecution(containerName, argv, spec.timeoutMs);
  }

  async cancel(executionId: string): Promise<void> {
    const containerName = `tale-sbx-${executionId}`;
    // SIGTERM first (graceful), escalate to SIGKILL on failure. timeoutMs is
    // forwarded to runDocker so a wedged daemon kills the docker CLI child too
    // (audit follow-up F4). Best-effort: docker kill on a not-yet-created
    // container just fails harmlessly.
    try {
      await dockerKill(containerName, 'TERM', { timeoutMs: 5_000 });
    } catch (err) {
      console.warn(
        `[sandbox.cancel] dockerKill timed out / failed for ${executionId}:`,
        err,
      );
      try {
        await dockerKill(containerName, 'KILL', { timeoutMs: 5_000 });
      } catch (forceErr) {
        console.error(
          `[sandbox.cancel] forced dockerKill also failed for ${executionId}:`,
          forceErr,
        );
      }
    }
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    return dockerSweepOrphans(this.cfg, opts.staleBeforeMs, opts.isLive);
  }
}
