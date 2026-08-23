// DockerSessionBackend — persistent sessions on the Compose path.
//
// Sibling of DockerBackend (one-shot). Launches a long-lived detached
// container running runnerd as PID 1, with a host-bind workspace that
// survives the container, and resolves the spawner→runnerd endpoint by
// container DNS name on tale-sandbox-net. Cleanup.ts's one-shot sweep ignores
// these (distinct `tale.sandbox-session=1` label).

import { chown, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureBuildkitd } from '../../buildkitd.ts';
import {
  buildDockerSessionRunArgs,
  sessionDindEnabled,
} from '../../session/docker-session-args.ts';
import {
  runnerdEnvPatch,
  runnerdHealth,
} from '../../session/runnerd-client.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import {
  deriveRunnerdToken,
  sessionContainerName,
  sessionWorkspaceDirName,
} from '../../session/session-naming.ts';
import { dockerRm, runDocker } from '../../spawn-util.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  bunCacheVolumeName,
  ensureCacheVolume,
  npmCacheVolumeName,
  pipCacheVolumeName,
} from '../../volume.ts';
import type { BackendSession, SessionBackend, SessionSpec } from '../types.ts';

/** Does a `docker run` stderr report a container-name collision? */
export function isDockerNameConflict(stderr: string): boolean {
  return /already in use|conflict/i.test(stderr);
}

/**
 * Is a container in a state safe to REAP on a create-time name conflict?
 *
 * Session containers never restart, so `exited`/`dead` are terminal — a dead
 * orphan whose name can be reclaimed. Every other state (`running`, `created`,
 * `restarting`, `paused`, `removing`) is left alone: it could be a concurrent
 * winner's healthy session on another spawner replica, or one still starting,
 * and reaping it would kill a live session. An unknown/unreadable state is
 * treated as NOT reapable by the caller for the same reason.
 */
export function isReapableContainerStatus(status: string): boolean {
  const s = status.trim();
  return s === 'exited' || s === 'dead';
}

export class DockerSessionBackend implements SessionBackend {
  readonly kind = 'docker' as const;

  constructor(private readonly cfg: SpawnerConfig) {}

  /** runnerd token: derived from SANDBOX_TOKEN when signed, '' in unsigned dev
   * mode (runnerd skips the check). Matches SessionRoutes.tokenFor. */
  private tokenFor(sessionId: string): string {
    if (this.cfg.sandboxToken === null) return '';
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  private workspaceDir(sessionId: string): string {
    return join(this.cfg.hostSessionRoot, sessionWorkspaceDirName(sessionId));
  }

  /**
   * Resolve the host workspace dir for a (possibly resumed) session.
   *
   * Normally this is just `hostSessionRoot/ses-<id>`. But the sandbox tier used
   * to root sessions under a blue/green colour subdir
   * (`/var/lib/tale-sandbox/sessions/<colour>/ses-<id>`); after that concept was
   * dropped the root flattened to `/var/lib/tale-sandbox/sessions/ses-<id>`. A
   * session created by the OLD build whose container then idle-stopped would be
   * resumed against the new flat path, find nothing, and silently lose the
   * user's preserved work. So this resolver, IN ORDER:
   *
   *   1. Uses the new flat path if its dir already exists (the common case).
   *   2. Else, if the session's container still exists, reads the ACTUAL `/agent`
   *      bind-mount source straight from `docker inspect` — never re-derive a
   *      path docker already knows, and never move a live container's mount.
   *   3. Else (stopped legacy session), scans the immediate sub-directories of
   *      the new root for a legacy `<subdir>/ses-<id>` workspace and adopts it
   *      in place (no rename — that would break a concurrent resume's mount).
   *   4. Else, returns the new flat path for a genuinely fresh create.
   *
   * The legacy branches are one-time compat for live data from before the colour
   * drop; once those sessions are destroyed nothing lands on the old paths again.
   */
  private async resolveWorkspaceDir(sessionId: string): Promise<string> {
    const flat = this.workspaceDir(sessionId);
    if (await this.workspaceDirExists(flat)) return flat;

    const dirName = sessionWorkspaceDirName(sessionId);

    // 2. Adopt a running/stopped container's real mount rather than re-deriving.
    const inspected = await this.inspectWorkspaceMount(sessionId);
    if (inspected && (await this.workspaceDirExists(inspected))) {
      console.warn(
        `[sandbox.session] resuming ${sessionId} from its existing mount ${inspected} (legacy colour-rooted path)`,
      );
      return inspected;
    }

    // 3. Stopped legacy session: scan one level of colour subdirs for the dir.
    let entries;
    try {
      entries = await readdir(this.cfg.hostSessionRoot, {
        withFileTypes: true,
      });
    } catch (err) {
      // Root not created yet (fresh host) → nothing legacy to find.
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        console.warn(
          `[sandbox.session] legacy workspace scan of ${this.cfg.hostSessionRoot} failed:`,
          err,
        );
      }
      return flat;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('ses-')) continue;
      const legacy = join(this.cfg.hostSessionRoot, e.name, dirName);
      if (await this.workspaceDirExists(legacy)) {
        console.warn(
          `[sandbox.session] resuming ${sessionId} from legacy colour-rooted workspace ${legacy}`,
        );
        return legacy;
      }
    }
    return flat;
  }

  /** Read the host source of a session container's `/agent` bind mount via
   * `docker inspect`, or null when the container is absent / has no such mount.
   * Used by the legacy-compat resolver so a resume re-attaches the EXACT dir
   * docker already mounts instead of re-deriving a (possibly colour-rooted)
   * path. */
  private async inspectWorkspaceMount(
    sessionId: string,
  ): Promise<string | null> {
    const containerName = sessionContainerName(sessionId);
    const inspect = await runDocker(
      [
        'inspect',
        '--format',
        '{{range .Mounts}}{{if eq .Destination "/agent"}}{{.Source}}{{end}}{{end}}',
        containerName,
      ],
      { timeoutMs: 5_000 },
    );
    if (inspect.exitCode !== 0) return null;
    const src = inspect.stdout.trim();
    return src.length > 0 ? src : null;
  }

  async createSession(spec: SessionSpec): Promise<void> {
    const containerName = sessionContainerName(spec.sessionId);
    const workspaceHostDir = await this.resolveWorkspaceDir(spec.sessionId);
    // Agent-profile only — see sessionDindEnabled. Every DinD side-effect below
    // (inner-docker volume, shared buildkitd, cache-volume skip) keys off this,
    // not the raw cfg flag, so a `default`-profile session never gets them.
    const dind = sessionDindEnabled(this.cfg, spec.profile);
    // uid/gid for the workspace chown. The agent profile carries validated
    // numerics (config.ts userEnv); the default profile is the fixed nobody
    // (65534). Both are real integers >= 1, so the chown can never silently
    // land on root.
    const { uid, gid } =
      spec.profile === 'agent'
        ? this.cfg.session.agentProfile
        : { uid: 65534, gid: 65534 };

    // A pre-existing workspace dir means this is a RESUME of a stopped session
    // (idle reaper removed the container but kept the data). A failed create
    // here must NOT delete that dir — a transient runnerd-startup blip on
    // resume would otherwise wipe the user's preserved work. Fresh creates
    // (no dir yet) keep cleaning up the half-made empty dir.
    const preexisting = await this.workspaceDirExists(workspaceHostDir);

    // Workspace dir survives the container; chown to the container's uid so
    // the unprivileged session process can write it. Defensive backstop: never
    // chown to root/non-integer even if the validated config were bypassed.
    await mkdir(workspaceHostDir, { recursive: true });
    if (
      !(Number.isInteger(uid) && Number.isInteger(gid) && uid >= 1 && gid >= 1)
    ) {
      throw new Error(
        `[sandbox.session] refusing to chown workspace to invalid uid:gid ${uid}:${gid}`,
      );
    }
    try {
      await chown(workspaceHostDir, uid, gid);
    } catch (err) {
      console.warn(
        `[sandbox.session] chown ${workspaceHostDir} failed (continuing):`,
        err,
      );
    }

    const pip = pipCacheVolumeName(this.cfg, spec.organizationId);
    const npm = npmCacheVolumeName(this.cfg, spec.organizationId);
    const bun = bunCacheVolumeName(this.cfg, spec.organizationId);
    // Shared per-org dep caches are NOT mounted under DinD (sysbox userns
    // shifting makes a cross-session shared volume unsafe — see
    // docker-session-args.ts), so don't bother creating them either.
    if (!dind) {
      await ensureCacheVolume(pip);
      await ensureCacheVolume(npm);
      await ensureCacheVolume(bun);
    }
    // Fresh, ephemeral /var/lib/docker volume for the inner dockerd (DinD only).
    // Recreated each start so a SIGKILLed dockerd's dirty overlay2 never wedges
    // resume; reaped on stop + destroy.
    const dockerStorageVolume = dind
      ? await this.ensureFreshDindVolume(spec.sessionId)
      : undefined;

    // Shared cross-session build cache: ensure the shared buildkitd is up and
    // get the endpoint the session's remote buildx builder should target. This
    // is a pure OPTIMIZATION — a failure must never block session creation, so
    // on error we proceed with no endpoint and the session falls back to its own
    // inner builder (cold cache). Only when DinD + the flag are both on.
    let buildkitdEndpoint: string | undefined;
    if (dind && this.cfg.dockerBuildCache) {
      try {
        buildkitdEndpoint = await ensureBuildkitd(
          this.cfg,
          spec.organizationId,
        );
      } catch (err) {
        console.warn(
          `[sandbox.session] shared buildkitd unavailable for ${spec.sessionId}; ` +
            `session will use its own inner builder (cold cache):`,
          err,
        );
      }
    }

    const token = this.tokenFor(spec.sessionId);
    const argv = buildDockerSessionRunArgs(this.cfg, {
      sessionId: spec.sessionId,
      organizationId: spec.organizationId,
      profile: spec.profile,
      workspaceHostDir,
      pipCacheVolume: pip,
      npmCacheVolume: npm,
      bunCacheVolume: bun,
      runnerdToken: token,
      createdAtMs: spec.createdAtMs,
      dockerStorageVolume,
      ...(buildkitdEndpoint ? { buildkitdEndpoint } : {}),
    });
    // The seed env is NOT passed on the `docker run` argv. A `--env
    // TALE_SESSION_ENV=…` would be readable by anyone with host Docker access
    // via `docker inspect`, and the seed env can carry secrets. It is instead
    // pushed to runnerd over POST /env after readiness (below), mirroring the
    // K8s backend, which routes it through a Secret rather than a visible arg.
    let run = await runDocker(argv, { timeoutMs: 30_000 });

    // Reconcile a stale name conflict. A container with our DETERMINISTIC name
    // already exists. Within a single spawner the route serializes creates (the
    // `creating` set + a registry 409), so this is NOT an in-flight peer — it's
    // a leftover from a prior life: a container that died out-of-band (daemon
    // restart, OOM, exit 255) whose registry entry was already evicted as
    // "gone" (sessionExists keys on State.Running, so an exited container reads
    // as not-present and the platform resumes — landing right here). Such an
    // orphan would otherwise 502 every future resume forever. Reap it and retry
    // ONCE, but only when it is in a TERMINAL state — a running/created
    // container could be a concurrent winner's healthy session on another
    // replica and must never be reaped. The host workspace dir survives the
    // reap, so the retry is a true resume.
    if (run.exitCode !== 0 && isDockerNameConflict(run.stderr)) {
      const status = await this.containerStatus(containerName);
      if (status !== null && isReapableContainerStatus(status)) {
        console.warn(
          `[sandbox.session] reaping dead container ${containerName} (status=${status}) and retrying create for ${spec.sessionId}`,
        );
        await dockerRm(containerName).catch((err) =>
          console.warn('[sandbox.session] orphan reap dockerRm failed:', err),
        );
        // The dead container may still have pinned the dind volume, so the
        // earlier ensureFreshDindVolume could not actually recreate it; redo it
        // now that the container is gone so the retry mounts a genuinely fresh
        // inner store. (Volume name is deterministic, so argv stays valid.)
        if (dind) {
          await this.ensureFreshDindVolume(spec.sessionId);
        }
        run = await runDocker(argv, { timeoutMs: 30_000 });
      }
    }

    if (run.exitCode !== 0) {
      const stderr = run.stderr.trim();
      // A name conflict that survived the reconcile above (the container is
      // running/created — a likely concurrent winner — or a retry that re-lost
      // the race) is NOT ours to tear down: surface it without the destructive
      // cleanup below. adoptExisting + the route's 409-reuse path recover a
      // running peer on a later turn.
      const nameConflict = isDockerNameConflict(stderr);
      if (!nameConflict) {
        // Clean up a half-created container before surfacing the failure. On a
        // resume (preexisting dir), preserve the workspace; only a fresh create
        // deletes its own empty dir.
        await dockerRm(containerName).catch((err) =>
          console.warn('[sandbox.session] cleanup dockerRm failed:', err),
        );
        if (dind) {
          await this.removeDindVolume(spec.sessionId);
        }
        if (!preexisting) {
          await rm(workspaceHostDir, { recursive: true, force: true }).catch(
            (err) =>
              console.warn(
                '[sandbox.session] cleanup workspace rm failed:',
                err,
              ),
          );
        }
      }
      throw new Error(
        `docker run (session) failed: ${stderr || run.stdout.trim()}`,
      );
    }

    // Poll runnerd until ready; on timeout tear the container down — but a
    // resume keeps its preserved workspace (stop, not destroy).
    try {
      const baseUrl = await this.resolveEndpoint(spec.sessionId);
      await this.waitForRunnerdOrExit(
        containerName,
        { baseUrl, token },
        this.cfg.session.createHealthTimeoutMs,
      );
      // Push the seed env now that runnerd is ready and BEFORE createSession
      // returns, so no exec can start without it. Fail-closed: a failed PATCH
      // tears the container down via the catch below rather than launching a
      // session missing its (possibly secret-bearing) env.
      if (Object.keys(spec.env).length > 0) {
        const denied = await runnerdEnvPatch(
          { baseUrl, token },
          { set: spec.env },
        );
        if (denied.length > 0) {
          console.warn(
            `[sandbox.session] runnerd rejected seed env keys for ${spec.sessionId}: ${denied.join(', ')}`,
          );
        }
      }
    } catch (err) {
      if (preexisting) {
        await this.stopSession(spec.sessionId);
      } else {
        await this.destroySession(spec.sessionId);
      }
      throw err;
    }
  }

  async resolveEndpoint(sessionId: string): Promise<string> {
    // Docker DNS: the spawner shares tale-sandbox-net with the session
    // container, so the container name resolves directly. No backend lookup
    // needed (unlike K8s, where the Pod IP must be read).
    return `http://${sessionContainerName(sessionId)}:${RUNNERD_PORT}`;
  }

  /**
   * Poll runnerd's /healthz until ready, but FAIL FAST when the container has
   * already died. A boot crash (e.g. the entrypoint's workspace-skeleton mkdir
   * hitting EACCES) otherwise burns the full createHealthTimeoutMs (minutes)
   * blind-polling a container that exited in its first second, and the caller
   * only ever sees an opaque "did not become ready" — so surface the
   * container's last log lines in the error instead. A null status (daemon
   * hiccup) is "unknown", never a death verdict; only a definitively dead
   * container (exited/dead — isReapableContainerStatus) aborts the wait.
   */
  private async waitForRunnerdOrExit(
    containerName: string,
    opts: { baseUrl: string; token: string },
    deadlineMs: number,
    pollIntervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      try {
        await runnerdHealth(opts);
        return;
      } catch {
        const status = await this.containerStatus(containerName);
        if (status !== null && isReapableContainerStatus(status)) {
          const logs = await runDocker(
            ['logs', '--tail', '10', containerName],
            { timeoutMs: 5_000 },
          );
          const tail = `${logs.stdout}\n${logs.stderr}`.trim().slice(-2000);
          throw new Error(
            `session container exited before runnerd became ready ` +
              `(status=${status}); last log lines:\n${tail}`,
          );
        }
        if (Date.now() - start > deadlineMs) {
          throw new Error(
            `runnerd did not become ready within ${deadlineMs}ms`,
          );
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    }
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const containerName = sessionContainerName(sessionId);
    const inspect = await runDocker(
      ['inspect', '--format', '{{.State.Running}}', containerName],
      { timeoutMs: 5_000 },
    );
    if (inspect.exitCode === 0) return inspect.stdout.trim() === 'true';
    // Only a definitive "the object is gone" answer may return false; any
    // other inspect failure (daemon hiccup, timeout) is "unknown" and must
    // throw per the interface contract.
    if (/no such (object|container)/i.test(inspect.stderr)) return false;
    throw new Error(
      `docker inspect ${containerName} failed: ${inspect.stderr.trim() || inspect.stdout.trim()}`,
    );
  }

  /** Current `State.Status` of the named container, or null when it can't be
   * read (no such object, or a daemon hiccup). Drives the create-conflict
   * reconcile: a null/unknown status is never treated as reapable, so a daemon
   * blip can't trigger a destructive reap of a possibly-live peer. */
  private async containerStatus(containerName: string): Promise<string | null> {
    const inspect = await runDocker(
      ['inspect', '--format', '{{.State.Status}}', containerName],
      { timeoutMs: 5_000 },
    );
    if (inspect.exitCode !== 0) return null;
    return inspect.stdout.trim();
  }

  /** Does the host workspace dir already exist? Distinguishes a resume (dir
   * present) from a fresh create so a failed create never deletes preserved
   * data. */
  private async workspaceDirExists(workspaceHostDir: string): Promise<boolean> {
    try {
      await stat(workspaceHostDir);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove the container (best-effort), leaving the workspace dir untouched.
   * Shared by stopSession (keep dir) and destroySession (which then deletes
   * the dir). Returns whether the container existed. */
  private async removeContainer(sessionId: string): Promise<boolean> {
    const containerName = sessionContainerName(sessionId);
    let existed = false;
    try {
      const inspect = await runDocker(
        ['inspect', '--format', '{{.Id}}', containerName],
        { timeoutMs: 5_000 },
      );
      existed = inspect.exitCode === 0;
    } catch {
      existed = false;
    }
    await dockerRm(containerName).catch((err) => {
      console.warn(`[sandbox.session] dockerRm ${containerName} failed:`, err);
    });
    return existed;
  }

  /** Per-session inner-dockerd storage volume (DinD only), mounted at
   * /var/lib/docker. Ephemeral — recreated fresh each start, reaped on stop +
   * destroy. */
  private dindStorageVolumeName(sessionId: string): string {
    return `tale-dind-${sessionId}`;
  }

  /** Remove any existing dind storage volume, then create a clean one. Returns
   * the volume name for the argv builder. */
  private async ensureFreshDindVolume(sessionId: string): Promise<string> {
    await this.removeDindVolume(sessionId);
    const name = this.dindStorageVolumeName(sessionId);
    const res = await runDocker(
      [
        'volume',
        'create',
        '--label',
        'tale.sandbox-dind=1',
        '--label',
        `tale.session=${sessionId}`,
        name,
      ],
      { timeoutMs: 10_000 },
    );
    if (res.exitCode !== 0) {
      throw new Error(
        `docker volume create (dind) failed: ${res.stderr.trim() || res.stdout.trim()}`,
      );
    }
    return name;
  }

  private async removeDindVolume(sessionId: string): Promise<void> {
    const name = this.dindStorageVolumeName(sessionId);
    await runDocker(['volume', 'rm', '--force', name], {
      timeoutMs: 10_000,
    }).catch((err) => {
      console.warn(`[sandbox.session] dind volume rm ${name} failed:`, err);
    });
  }

  async destroySession(sessionId: string): Promise<boolean> {
    // Resolve the REAL workspace dir BEFORE removing the container — a legacy
    // colour-rooted session's dir lives under an old subdir and `docker inspect`
    // (used by resolveWorkspaceDir) only works while the container still exists.
    const workspaceHostDir = await this.resolveWorkspaceDir(sessionId);
    const existed = await this.removeContainer(sessionId);
    // CONFIRM the container is gone before deleting the workspace. A wedged
    // dockerd that ignored the rm would otherwise leave a gutted-but-running
    // container (a hybrid neither stop nor destroy defines). sessionExists
    // returns false only on a definitive "gone"; an unknown/daemon-hiccup THROWS
    // — which we let propagate so the caller retries rather than risk deleting
    // the workspace out from under a live container.
    if (await this.sessionExists(sessionId)) {
      throw new Error(
        `destroy ${sessionId}: container still present after removal — workspace left intact`,
      );
    }
    if (this.cfg.dockerInContainer) await this.removeDindVolume(sessionId);
    await rm(workspaceHostDir, {
      recursive: true,
      force: true,
    }).catch((err) => {
      console.warn(
        `[sandbox.session] rm workspace for ${sessionId} failed:`,
        err,
      );
    });
    return existed;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    // Release compute but PRESERVE the host workspace dir — a later
    // createSession with the same sessionId re-mounts it (resume). The inner
    // docker store is ephemeral, so reap it (resume rebuilds the image cache).
    const existed = await this.removeContainer(sessionId);
    if (this.cfg.dockerInContainer) await this.removeDindVolume(sessionId);
    return existed;
  }

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    // No colour filter: the sandbox tier is a single container that rolls
    // in-place, so this spawner adopts ALL existing session containers —
    // including ones started by a previous (colour-rooted) build.
    const filters = ['--filter', 'label=tale.sandbox-session=1'];
    if (organizationId) {
      filters.push('--filter', `label=tale.org=${organizationId}`);
    }
    const res = await runDocker(
      [
        'ps',
        '--all',
        ...filters,
        '--format',
        '{{.Label "tale.session"}}\t{{.Label "tale.org"}}\t{{.Label "tale.profile"}}\t{{.Label "tale.created"}}\t{{.State}}',
      ],
      { timeoutMs: 10_000 },
    );
    if (res.exitCode !== 0) return [];
    const out: BackendSession[] = [];
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [sessionId, org, profile, created, state] = trimmed.split('\t');
      if (!sessionId) continue;
      out.push({
        sessionId,
        organizationId: org ?? '',
        profile: profile === 'agent' ? 'agent' : 'default',
        createdAtMs: Number(created) || 0,
        ttlMs: this.cfg.session.maxLifetimeMs,
        idleTimeoutMs: this.cfg.session.maxIdleMs,
        state: state === 'running' ? 'ready' : 'degraded',
      });
    }
    return out;
  }

  /**
   * Heal the shared buildkitd for every org with a running session, so an
   * adopted session never builds against a daemon whose egress fence went stale
   * across a stack restart. ensureBuildkitd recreates a drifted daemon (its
   * `[dns]`/redsocks pinned to a since-moved sandbox-egress IP) and is a cheap
   * no-op when the daemon is already healthy. Gated on DinD + the build-cache
   * flag (no daemon otherwise); per-org best-effort — the cache is an
   * optimization, so a failure is logged, never thrown.
   */
  async reconcileBuildCache(orgIds: readonly string[]): Promise<void> {
    if (!(this.cfg.dockerInContainer && this.cfg.dockerBuildCache)) return;
    for (const organizationId of new Set(orgIds)) {
      try {
        await ensureBuildkitd(this.cfg, organizationId);
      } catch (err) {
        console.warn(
          `[sandbox.session] build-cache reconcile for org ${organizationId} ` +
            `failed (continuing; sessions fall back to their inner builder):`,
          err,
        );
      }
    }
  }
}
