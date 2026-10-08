// DockerSessionBackend — persistent sessions on the Compose path.
//
// Sibling of DockerBackend (one-shot). Launches a long-lived detached
// container running runnerd as PID 1, with a host-bind workspace that
// survives the container, and resolves the spawner→runnerd endpoint by
// container DNS name on tale-sandbox-net. Cleanup.ts's one-shot sweep ignores
// these (distinct `tale.sandbox-session=1` label).

import { randomUUID } from 'node:crypto';
import {
  chown,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  listBuildkitOrganizations,
  retireLegacyBuildkitd,
} from '../../buildkit-resources.ts';
import {
  ensureBuildkitd,
  removeOrganizationBuildkit,
  retainBuildkitd,
  sweepIdleBuildkitd,
} from '../../buildkitd.ts';
import {
  operationSignal,
  outsideOperationBudget,
  withOperationBudget,
  waitWithinOperation,
} from '../../operation-budget.ts';
import {
  attachBuildkitNetwork,
  readBuildkitNetworkPlan,
  type BuildkitNetworkPlan,
} from '../../session/buildkit-network-guard.ts';
import { buildDockerSessionRunArgs } from '../../session/docker-session-args.ts';
import {
  runnerdEnvPatch,
  runnerdHealth,
} from '../../session/runnerd-client.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import {
  belongsToInstance,
  deriveRunnerdToken,
  isSessionWorkspaceDirName,
  SESSION_INSTANCE_LABEL,
  sessionContainerName,
  sessionInstanceFilter,
  sessionWorkspaceDirName,
} from '../../session/session-naming.ts';
import {
  isAgentSessionProfile,
  sessionDindEnabled,
} from '../../session/session-profile.ts';
import {
  listSessionWorkspaceDirs,
  listWorkspaceDirs,
} from '../../session/workspace-inventory.ts';
import {
  workspaceTrash,
  type WorkspaceTrash,
} from '../../session/workspace-trash.ts';
import {
  dockerRm,
  dockerRmSucceeded,
  isDockerMissingImage,
  isDockerNoSuchObject,
  runDocker,
} from '../../spawn-util.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  bunCacheVolumeName,
  ensureCacheVolume,
  listCacheVolumeOrganizations,
  npmCacheVolumeName,
  pipCacheVolumeName,
  removeCacheVolumes,
} from '../../volume.ts';
import { ORG_ID_ALPHABET_RE } from '../../wire.ts';
import {
  SessionIncarnationChangedError,
  type BackendSession,
  type BackendWorkspace,
  type BuildCacheUpkeep,
  type CreateSessionResult,
  type OrganizationTeardownResult,
  type SessionBackend,
  type SessionSpec,
  type WorkspaceDeletion,
} from '../types.ts';

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

/** States a session container is left in when its start never finished: a
 * spawner killed between the daemon's create and start leaves `created`, and
 * a timed-out run whose cleanup also timed out can leave any of these. The
 * spawner never pauses a session and gives it no restart policy, so none of
 * them is a session at work. */
const STUCK_CONTAINER_STATES: ReadonlySet<string> = new Set([
  'created',
  'paused',
  'restarting',
]);

/** Past a create's whole budget, how long its container may still sit in a
 * {@link STUCK_CONTAINER_STATES} state before it counts as abandoned. */
const STUCK_CONTAINER_SLACK_MS = 60_000;

export class DockerSessionBackend implements SessionBackend {
  readonly kind = 'docker' as const;

  /** @param trash Where a destroyed workspace goes to be deleted in the
   * background; the host session root's own unless a test hands in one. */
  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly trash: WorkspaceTrash = workspaceTrash(
      cfg.hostSessionRoot,
    ),
  ) {}

  private runtimeImageMissing: ((detail: string) => void) | null = null;

  onRuntimeImageMissing(listener: (detail: string) => void): void {
    this.runtimeImageMissing = listener;
  }

  /** runnerd token: derived from SANDBOX_TOKEN (always set — loadConfig fails
   * closed without it). Matches SessionRoutes.tokenFor. */
  private tokenFor(sessionId: string): string {
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
   * With `flatRootShortcut` (a create, a placement check), a root without a
   * colour subdir skips them: a fresh create then costs no `docker inspect` and
   * no scan of the root. A destroy always asks the container: a session that
   * outlived a move of the session root (`SANDBOX_HOST_SESSION_ROOT`, a
   * device's state directory) is still mounted from the old one, and its data
   * must not stay behind.
   */
  private async resolveWorkspaceDir(
    sessionId: string,
    { flatRootShortcut = false }: { flatRootShortcut?: boolean } = {},
  ): Promise<string> {
    const flat = this.workspaceDir(sessionId);
    if (await this.workspaceDirExists(flat)) return flat;
    if (flatRootShortcut && !(await this.hasLegacyRoots())) return flat;

    const dirName = sessionWorkspaceDirName(sessionId);

    // 2. Adopt a running/stopped container's real mount rather than re-deriving.
    const inspected = await this.inspectWorkspaceMount(sessionId);
    if (inspected && (await this.workspaceDirExists(inspected))) {
      console.warn(
        `[sandbox.session] using ${sessionId}'s existing mount ${inspected} (a colour-rooted or moved session root)`,
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
      if (!e.isDirectory() || isSessionWorkspaceDirName(e.name)) continue;
      // Spawner bookkeeping (`.pins/`, `.owners/`) and the trash of destroyed
      // workspaces (`.trash/`) are not colour roots.
      if (e.name.startsWith('.')) continue;
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

  /** Whether the session root holds a colour subdirectory from before the
   * root was flattened. Read once: nothing creates one any more. A root that
   * cannot be read keeps the lookups, and is read again next time. */
  private legacyRoots: Promise<boolean> | null = null;

  private hasLegacyRoots(): Promise<boolean> {
    this.legacyRoots ??= readdir(this.cfg.hostSessionRoot, {
      withFileTypes: true,
    }).then(
      (entries) =>
        entries.some(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith('.') &&
            e.name !== 'lost+found' &&
            !isSessionWorkspaceDirName(e.name),
        ),
      (err: unknown) => {
        // Root not created yet (fresh host): nothing legacy to find.
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return false;
        }
        console.warn(
          `[sandbox.session] cannot read ${this.cfg.hostSessionRoot} for legacy workspaces:`,
          err,
        );
        this.legacyRoots = null;
        return true;
      },
    );
    return this.legacyRoots;
  }

  /** Read the host source of a session container's `/agent` bind mount via
   * `docker inspect`, or null when the container is absent / has no such mount.
   * Used by the legacy-compat resolver so a resume re-attaches the EXACT dir
   * docker already mounts instead of re-deriving a (possibly colour-rooted)
   * path. */
  private async inspectWorkspaceMount(
    sessionId: string,
    requireComplete = false,
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
    if (inspect.exitCode !== 0) {
      if (requireComplete && !isDockerNoSuchObject(inspect.stderr)) {
        throw new Error(
          `cannot read session ${sessionId}'s workspace mount: ${inspect.stderr.trim() || 'docker inspect failed'}`,
        );
      }
      return null;
    }
    const src = inspect.stdout.trim();
    return src.length > 0 ? src : null;
  }

  async createSession(spec: SessionSpec): Promise<CreateSessionResult> {
    const createAttemptId = randomUUID();
    const release =
      sessionDindEnabled(this.cfg, spec.profile, spec.docker) &&
      this.cfg.dockerBuildCache
        ? retainBuildkitd(spec.organizationId)
        : undefined;
    try {
      return await withOperationBudget(
        this.cfg.session.createHealthTimeoutMs,
        async (signal) => {
          try {
            const created = await this.createSessionUnlocked(
              spec,
              signal,
              createAttemptId,
            );
            signal.throwIfAborted();
            return created;
          } catch (error) {
            if (signal.aborted) {
              // The daemon may have accepted a run whose reply was cancelled.
              // Only this random attempt label authorizes cleanup; data remains.
              await this.cleanupCreateAttempt(spec.sessionId, createAttemptId);
            }
            throw error;
          }
        },
        spec.signal,
      );
    } finally {
      release?.();
    }
  }

  private async createSessionUnlocked(
    spec: SessionSpec,
    signal: AbortSignal,
    createAttemptId: string,
  ): Promise<CreateSessionResult> {
    const containerName = sessionContainerName(spec.sessionId);
    // A new session starts UNPINNED whatever a prior incarnation under this
    // deterministic id recorded: the platform row is the truth and re-pushes
    // its pin; a stale marker would exempt a container the platform believes
    // is reapable. Cleared before anything else so a failed create leaves none.
    await this.clearPinMarker(spec.sessionId);
    const workspaceHostDir = await this.resolveWorkspaceDir(spec.sessionId, {
      flatRootShortcut: true,
    });
    // Agent-profile only — see sessionDindEnabled. Every DinD side-effect below
    // (inner-docker volume, shared buildkitd, cache-volume skip) keys off this,
    // not the raw cfg flag, so a `default`-profile session never gets them.
    const dind = sessionDindEnabled(this.cfg, spec.profile, spec.docker);
    // uid/gid for the workspace chown. The agent profile carries validated
    // numerics (config.ts userEnv); the default profile is the fixed nobody
    // (65534). Both are real integers >= 1, so the chown can never silently
    // land on root.
    const { uid, gid } = isAgentSessionProfile(spec.profile)
      ? this.cfg.session.agentProfile
      : { uid: 65534, gid: 65534 };

    // A pre-existing workspace dir means this is a RESUME of a stopped session
    // (idle reaper removed the container but kept the data). A failed create
    // here must NOT delete that dir — a transient runnerd-startup blip on
    // resume would otherwise wipe the user's preserved work. Even an empty
    // fresh directory may already be mounted by a concurrent creator.
    const preexisting = await this.workspaceDirExists(workspaceHostDir);

    // Workspace dir survives the container; chown to the container's uid so
    // the unprivileged session process can write it. Defensive backstop: never
    // chown to root/non-integer even if the validated config were bypassed.
    await mkdir(workspaceHostDir, { recursive: true });
    await this.writeOwnerMarker(spec.sessionId, spec.organizationId);
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
    // Shared dependency caches are not mounted under DinD. Wait for every
    // setup call to settle, including after the first failure. Failed setup
    // keeps deterministic workspace/volume state that a peer may already use.
    if (!dind) {
      const caches = await Promise.allSettled(
        [pip, npm, bun].map((name) => ensureCacheVolume(name)),
      );
      const failed = caches.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    // A fresh inner store avoids resuming a SIGKILLed dockerd's dirty overlay.
    const dockerStorageVolume = dind
      ? await this.ensureFreshDindVolume(spec.sessionId)
      : undefined;

    // Per-organization build cache: ensure its private buildkitd is up and
    // get the endpoint the session's remote buildx builder should target. This
    // is a pure OPTIMIZATION — a failure must never block session creation, so
    // on error we proceed with no endpoint and the session falls back to its own
    // inner builder (cold cache). Only when DinD + the flag are both on.
    let buildkitdEndpoint: string | undefined;
    let buildkitNetworkPlan: BuildkitNetworkPlan | undefined;
    if (dind && this.cfg.dockerBuildCache) {
      try {
        const ready = await withOperationBudget(
          Math.min(
            this.cfg.buildkitdProvisionTimeoutMs ?? 5_000,
            this.cfg.session.createHealthTimeoutMs / 4,
          ),
          () =>
            waitWithinOperation(
              (async () => ({
                endpoint: await ensureBuildkitd(this.cfg, spec.organizationId),
                plan: await readBuildkitNetworkPlan(spec.organizationId),
              }))(),
            ),
        );
        buildkitNetworkPlan = ready.plan;
        buildkitdEndpoint = ready.endpoint;
      } catch (err) {
        console.warn(
          `[sandbox.session] shared buildkitd unavailable for ${spec.sessionId}; ` +
            `session will use its own inner builder (cold cache):`,
          err,
        );
      }
    }

    signal.throwIfAborted();
    const token = this.tokenFor(spec.sessionId);
    const argv = buildDockerSessionRunArgs(this.cfg, {
      sessionId: spec.sessionId,
      organizationId: spec.organizationId,
      profile: spec.profile,
      docker: spec.docker,
      createAttemptId,
      workspaceHostDir,
      pipCacheVolume: pip,
      npmCacheVolume: npm,
      bunCacheVolume: bun,
      runnerdToken: token,
      createdAtMs: spec.createdAtMs,
      dockerStorageVolume,
      ...(buildkitdEndpoint ? { buildkitdEndpoint } : {}),
      ...(buildkitNetworkPlan
        ? { buildkitNetworkSubnets: buildkitNetworkPlan.subnets }
        : {}),
    });
    // The seed env is NOT passed on the `docker run` argv. A `--env
    // TALE_SESSION_ENV=…` would be readable by anyone with host Docker access
    // via `docker inspect`, and the seed env can carry secrets. It is instead
    // pushed to runnerd over POST /env after readiness (below), mirroring the
    // K8s backend, which routes it through a Secret rather than a visible arg.
    const launch = async () => {
      try {
        operationSignal()?.throwIfAborted();
        return await runDocker(argv, {
          timeoutMs: 30_000,
        });
      } catch (error) {
        // A transport rejection does not prove the daemon refused the run.
        // Remove only this attempt if it launched before the reply was lost.
        await this.cleanupCreateAttempt(spec.sessionId, createAttemptId);
        throw error;
      }
    };
    let run = await launch();

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
      const observed = await this.containerState(containerName);
      if (observed !== null && isReapableContainerStatus(observed.status)) {
        console.warn(
          `[sandbox.session] reaping dead container ${containerName} (status=${observed.status}) and retrying create for ${spec.sessionId}`,
        );
        await this.bestEffortRm(observed.id, 'orphan reap');
        // The dead container may still have pinned the dind volume, so the
        // earlier ensureFreshDindVolume could not actually recreate it; redo it
        // now that the container is gone so the retry mounts a genuinely fresh
        // inner store. (Volume name is deterministic, so argv stays valid.)
        if (dind) {
          await this.ensureFreshDindVolume(spec.sessionId);
        }
        run = await launch();
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
        await this.cleanupCreateAttempt(spec.sessionId, createAttemptId);
      }
      // The run never pulls (`--pull=never`): a missing image fails at once,
      // and the spawner's warmup pulls it outside any create's budget.
      if (isDockerMissingImage(stderr)) this.runtimeImageMissing?.(stderr);
      throw new Error(
        `docker run (session) failed: ${stderr || run.stdout.trim()}`,
      );
    }

    // Poll runnerd until ready; on failure tear down only this attempt's
    // container and preserve any workspace files already written.
    try {
      const baseUrl = await this.resolveEndpoint(spec.sessionId);
      await this.waitForRunnerdOrExit(
        containerName,
        { baseUrl, token },
        this.cfg.session.createHealthTimeoutMs,
        100,
        signal,
      );
      // The inner daemon can rewrite firewall chains during boot. Connect the
      // organization bridge only after readiness and actual guard verification,
      // including for older runtime images. Failure uses the cleanup below.
      if (buildkitNetworkPlan) {
        await attachBuildkitNetwork(
          this.cfg,
          containerName,
          spec.organizationId,
          buildkitNetworkPlan,
        );
      }
      // Push the seed env now that runnerd is ready and BEFORE createSession
      // returns, so no exec can start without it. Fail-closed: a failed PATCH
      // tears the container down via the catch below rather than launching a
      // session missing its (possibly secret-bearing) env.
      if (Object.keys(spec.env).length > 0) {
        const denied = await runnerdEnvPatch(
          { baseUrl, token },
          { set: spec.env },
          signal,
        );
        if (denied.length > 0) {
          console.warn(
            `[sandbox.session] runnerd rejected seed env keys for ${spec.sessionId}: ${denied.join(', ')}`,
          );
        }
      }
      signal.throwIfAborted();
    } catch (err) {
      await this.cleanupCreateAttempt(spec.sessionId, createAttemptId);
      throw err;
    }
    return { resumed: preexisting };
  }

  /** A failed create owns only the container carrying its random attempt
   * label. Its deterministic workspace/volume may already serve a peer. */
  private async cleanupCreateAttempt(
    sessionId: string,
    createAttemptId: string,
  ): Promise<void> {
    try {
      await outsideOperationBudget(() =>
        withOperationBudget(10_000, async () => {
          await this.removeContainer(sessionId, undefined, createAttemptId);
          // Even an empty directory may already be mounted by a peer after
          // an absence check. Preserve workspaces/owner markers for retry or
          // explicit destroy, and inner-Docker volumes for normal orphan GC.
        }),
      );
    } catch (error) {
      console.warn(
        `[sandbox.session] failed-create cleanup skipped for ${sessionId}:`,
        error,
      );
    }
  }

  async resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string> {
    if (
      expectedCreatedAtMs !== undefined &&
      !(await this.sessionExists(sessionId, expectedCreatedAtMs))
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'container gone or changed before endpoint resolution',
      );
    }
    // Docker DNS: the spawner shares tale-sandbox-net with the session
    // container, so the container name resolves directly. Only adoption's
    // expected incarnation needs a lookup; an owned create already verified it.
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
    // runnerd answers ~0.3 s after `docker run`: a short poll keeps that
    // from becoming half a second more per create, and the container is
    // inspected for an early exit only every fifth miss.
    pollIntervalMs = 100,
    signal?: AbortSignal,
  ): Promise<void> {
    const start = Date.now();
    for (let miss = 1; ; miss += 1) {
      try {
        const health = await runnerdHealth(opts, signal);
        signal?.throwIfAborted();
        if (health.dockerReady === false)
          throw new Error('runnerd is live but inner Docker is not ready');
        return;
      } catch {
        signal?.throwIfAborted();
        const status =
          miss % 5 === 0 ? await this.containerStatus(containerName) : null;
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

  async hasWorkspace(sessionId: string): Promise<boolean> {
    return this.workspaceDirExists(
      await this.resolveWorkspaceDir(sessionId, { flatRootShortcut: true }),
    );
  }

  async sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    const containerName = sessionContainerName(sessionId);
    const inspect = await runDocker(
      [
        'inspect',
        '--format',
        expectedCreatedAtMs === undefined
          ? '{{.State.Running}}'
          : '{{.State.Running}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}',
        containerName,
      ],
      { timeoutMs: 5_000, priority: true },
    );
    if (inspect.exitCode === 0) {
      const [running, created] = inspect.stdout
        .replace(/\r?\n$/, '')
        .split('\t');
      if (running !== 'true') return false;
      if (expectedCreatedAtMs === undefined) return true;
      const stamp = Number(created);
      if (
        created === undefined ||
        created.trim() === '' ||
        !Number.isFinite(stamp)
      )
        throw new Error(
          `session ${sessionId} container creation stamp is unreadable`,
        );
      return stamp === expectedCreatedAtMs;
    }
    // Only a definitive "the object is gone" answer may return false; any
    // other inspect failure (daemon hiccup, timeout) is "unknown" and must
    // throw per the interface contract.
    if (isDockerNoSuchObject(inspect.stderr)) return false;
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

  /** Read identity and status together: a replacement after this observation
   * must never inherit an orphan's terminal-state removal verdict. */
  private async containerState(
    containerName: string,
  ): Promise<{ id: string; status: string } | null> {
    const observed = await runDocker(
      ['inspect', '--format', '{{.Id}}\t{{.State.Status}}', containerName],
      { timeoutMs: 5_000 },
    );
    if (observed.exitCode !== 0) return null;
    const [id, status] = observed.stdout.trim().split('\t');
    return id && /^[a-f0-9]{12,64}$/.test(id) && status ? { id, status } : null;
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

  /**
   * Remove the container, leaving the workspace dir untouched. Shared by
   * stopSession (keep dir) and destroySession (which then deletes the dir).
   * Returns whether the container existed.
   *
   * THROWS when the removal did not verifiably happen — a `docker rm --force`
   * that timed out against a wedged daemon (exit 124) or was refused for any
   * reason other than "no such container". `dockerRm` itself never rejects, so
   * a swallowed result here used to report a stop as done while the container
   * kept running: the reaper then dropped the registry entry and the live
   * container (2 cpu / 4-8 GB) was orphaned until a spawner restart re-adopted
   * it. Throwing is the stop/destroy contract (types.ts): the reaper keeps the
   * entry and retries next sweep; destroy leaves the workspace intact.
   */
  private async incarnationContainerId(
    sessionId: string,
    expectedCreatedAtMs: number | undefined,
    expectedCreateAttemptId?: string,
  ): Promise<string | null> {
    const containerName = sessionContainerName(sessionId);
    const observed = await runDocker(
      [
        'inspect',
        '--format',
        // `with`: a missing label prints nothing; a bare `index` prints
        // `<no value>`.
        '{{.Id}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}' +
          (expectedCreateAttemptId === undefined
            ? ''
            : '\t{{with index .Config.Labels "tale.create-attempt"}}{{.}}{{end}}'),
        containerName,
      ],
      // Short calls: a stop must not miss its fence behind a burst of
      // creates holding every shared docker CLI slot.
      { timeoutMs: 5_000, priority: true },
    );
    if (observed.exitCode !== 0) {
      if (isDockerNoSuchObject(observed.stderr)) return null;
      throw new Error(
        `cannot identify session ${sessionId} for lifecycle transition`,
      );
    }
    // Strip only the line break: a `trim()` would eat the tab in front of
    // an EMPTY label, and a label-less container adopted with
    // `createdAtMs: 0` must still match its stamp (`Number('') === 0`).
    const [containerId, created, createAttempt] = observed.stdout
      .replace(/\r?\n$/, '')
      .split('\t');
    if (!containerId || !/^[a-f0-9]{12,64}$/.test(containerId)) {
      throw new Error(
        `cannot identify session ${sessionId} for lifecycle transition`,
      );
    }
    if (
      expectedCreatedAtMs !== undefined &&
      Number(created) !== expectedCreatedAtMs
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'container creation stamp moved',
      );
    }
    if (
      expectedCreateAttemptId !== undefined &&
      createAttempt !== expectedCreateAttemptId
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'container create attempt moved',
      );
    }
    return containerId;
  }

  private async removeContainer(
    sessionId: string,
    expectedCreatedAtMs?: number,
    expectedCreateAttemptId?: string,
  ): Promise<{ existed: boolean; docker: boolean }> {
    const containerName = sessionContainerName(sessionId);
    let removalTarget = containerName;
    if (
      expectedCreatedAtMs !== undefined ||
      expectedCreateAttemptId !== undefined
    ) {
      const containerId = await this.incarnationContainerId(
        sessionId,
        expectedCreatedAtMs,
        expectedCreateAttemptId,
      );
      if (containerId === null) return { existed: false, docker: false };
      // The immutable container id fences a late rm against any replacement
      // that reuses the deterministic session name after a timeout/retry.
      removalTarget = containerId;
    }
    let existed = false;
    let docker = this.cfg.dockerInContainer;
    try {
      const inspect = await runDocker(
        [
          'inspect',
          '--format',
          '{{.Id}}\t{{with index .Config.Labels "tale.docker"}}{{.}}{{end}}\t{{range .Mounts}}{{if eq .Destination "/var/lib/docker"}}true{{end}}{{end}}',
          removalTarget,
        ],
        { timeoutMs: 5_000, priority: true },
      );
      existed = inspect.exitCode === 0;
      if (existed) {
        const [, capability, mounted] = inspect.stdout.trim().split('\t');
        docker =
          capability === 'true' ||
          (capability !== 'false' &&
            (mounted === 'true' || this.cfg.dockerInContainer));
      }
    } catch {
      existed = false;
    }
    const removal = await dockerRm(removalTarget);
    if (!dockerRmSucceeded(removal)) {
      throw new Error(
        `docker rm ${containerName} failed (exit ${removal.exitCode}): ` +
          `${removal.stderr.trim() || removal.stdout.trim() || 'no output'} — container may still be running`,
      );
    }
    return { existed, docker };
  }

  /** A cleanup-path `docker rm` whose failure must not mask the error being
   * surfaced, but must not pass silently either: a leftover container 409s
   * the next resume by name (the create-conflict reconcile reaps it once it
   * has exited), so the operator gets a warning line to find it by. */
  private async bestEffortRm(
    containerName: string,
    label: string,
  ): Promise<void> {
    const removal = await dockerRm(containerName);
    if (!dockerRmSucceeded(removal)) {
      console.warn(
        `[sandbox.session] ${label}: docker rm ${containerName} failed (exit ${removal.exitCode}): ${removal.stderr.trim()}`,
      );
    }
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
    // runDocker resolves on a failed command too: read the exit, or a refused
    // or timed-out removal leaves a multi-GB inner image store unnoticed.
    const removal = await runDocker(['volume', 'rm', '--force', name], {
      timeoutMs: 10_000,
    }).catch((err: unknown) => {
      console.warn(`[sandbox.session] dind volume rm ${name} failed:`, err);
      return null;
    });
    if (removal !== null && removal.exitCode !== 0) {
      console.warn(
        `[sandbox.session] dind volume rm ${name} failed (exit ${removal.exitCode}): ${removal.stderr.trim() || 'no output'}`,
      );
    }
  }

  async destroySession(sessionId: string): Promise<boolean> {
    // Capture every copy BEFORE removing the container. A flat workspace
    // can coexist with a legacy copy or mask a mount from a moved root; taking
    // only the first path and clearing ownership strands the others forever.
    const workspaceDirs = new Set(
      await listSessionWorkspaceDirs(this.cfg.hostSessionRoot, sessionId),
    );
    const mounted = await this.inspectWorkspaceMount(sessionId, true);
    if (mounted !== null) {
      workspaceDirs.add(mounted);
    }
    const hadWorkspace = workspaceDirs.size > 0;
    const { existed, docker } = await this.removeContainer(sessionId);
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
    if (docker) await this.removeDindVolume(sessionId);
    await this.clearPinMarker(sessionId);
    // The data-deleting half of the ONLY data-deleting verb. The workspace is
    // renamed into the session root's trash, which a background pass empties:
    // one rename whatever the workspace holds, so the answer never waits on
    // deleting tens of GB (the platform gives a destroy 30 s), and the id is
    // free for a fresh workspace at once. A workspace the trash cannot take
    // is deleted in place, and a failure there (EBUSY/EACCES on the bind dir)
    // must PROPAGATE. Swallowing it would let the route answer destroyed:true
    // — the platform flips its row and releases the id — while the user's
    // data survives under the session's name with nothing left to reclaim
    // it. A workspace already gone is nothing to move, so the retry the throw
    // provokes is idempotent (the container is gone by now, and
    // removeContainer/clearPinMarker are no-ops on a second pass).
    for (const workspaceHostDir of workspaceDirs) {
      try {
        await this.trash.discard(workspaceHostDir);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `destroy ${sessionId}: container removed but workspace ${workspaceHostDir} could not be deleted: ${msg}`,
          { cause: err },
        );
      }
    }
    await this.clearOwnerMarker(sessionId);
    return existed || hadWorkspace;
  }

  /** The trash entries of the id's workspaces, wherever they were rooted:
   * `discard` names each after the workspace dir (`ses-<id>.<uuid>`), so a
   * fresh workspace under the id never counts. */
  async workspaceDeletion(
    sessionId: string,
    waitMs = 0,
  ): Promise<WorkspaceDeletion> {
    const name = this.workspaceDir(sessionId);
    return waitMs > 0
      ? this.trash.settle(name, waitMs)
      : this.trash.deletion(name);
  }

  async stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    // Release compute but PRESERVE the host workspace dir — a later
    // createSession with the same sessionId re-mounts it (resume). The inner
    // docker store is ephemeral, so reap it (resume rebuilds the image cache).
    const { existed, docker } = await this.removeContainer(
      sessionId,
      expectedCreatedAtMs,
    );
    if (docker) await this.removeDindVolume(sessionId);
    // The pin belongs to the container that just went away; the resume's
    // create starts unpinned and the platform re-pushes.
    await this.clearPinMarker(sessionId);
    return existed;
  }

  /** A container that never got going — `created`, `paused` or `restarting`
   * past its create's whole budget — is removed like a stop removes one, its
   * workspace kept. Left alone it held a capacity slot for ever, answered
   * every create of the id busy, pinned an old runtime image and outlived
   * spawner restarts. Fenced to the incarnation the caller listed (its
   * `tale.created` stamp) and to the immutable container id read with its
   * state; Docker's own creation time keeps a container created just now
   * safe whatever stamp it carries. False when it is not provably abandoned. */
  async reapStaleSession(
    sessionId: string,
    expectedCreatedAtMs: number,
  ): Promise<boolean> {
    const containerName = sessionContainerName(sessionId);
    const observed = await runDocker(
      [
        'inspect',
        '--format',
        '{{.Id}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}\t{{.State.Status}}\t{{.Created}}\t{{with index .Config.Labels "tale.docker"}}{{.}}{{end}}\t{{range .Mounts}}{{if eq .Destination "/var/lib/docker"}}true{{end}}{{end}}',
        containerName,
      ],
      { timeoutMs: 5_000, priority: true },
    );
    if (observed.exitCode !== 0) {
      if (isDockerNoSuchObject(observed.stderr)) return true;
      throw new Error(
        `cannot identify session ${sessionId} for lifecycle transition`,
      );
    }
    const [containerId, created, status, dockerCreated, capability, mounted] =
      observed.stdout.replace(/\r?\n$/, '').split('\t');
    const stamp = Number(created);
    const createdAtMs = Date.parse(dockerCreated ?? '');
    if (
      !containerId ||
      !/^[a-f0-9]{12,64}$/.test(containerId) ||
      status === undefined ||
      !STUCK_CONTAINER_STATES.has(status) ||
      !Number.isSafeInteger(stamp) ||
      stamp <= 0 ||
      stamp !== expectedCreatedAtMs ||
      !Number.isFinite(createdAtMs) ||
      Date.now() <=
        Math.max(createdAtMs, stamp) +
          this.cfg.session.createHealthTimeoutMs +
          STUCK_CONTAINER_SLACK_MS
    )
      return false;
    const removal = await dockerRm(containerId);
    if (!dockerRmSucceeded(removal)) {
      throw new Error(
        `docker rm ${containerName} failed (exit ${removal.exitCode}): ${removal.stderr.trim() || removal.stdout.trim() || 'no output'}`,
      );
    }
    const docker =
      capability === 'true' ||
      (capability !== 'false' &&
        (mounted === 'true' || this.cfg.dockerInContainer));
    if (docker) await this.removeDindVolume(sessionId);
    await this.clearPinMarker(sessionId);
    console.warn(
      `[sandbox.session] removed ${sessionId}'s container, stuck ${status} since ${new Date(createdAtMs).toISOString()}`,
    );
    return true;
  }

  // --- the durable "always-on" pin -----------------------------------------
  //
  // The registry's `pinned` flag dies with the spawner process, so a deploy or
  // crash used to forget every pin and the first sweep after re-adoption
  // TTL/idle-reaped the user's always-on session. The host session root is the
  // one place this spawner already keeps durable state (`.spawner.lock`, the
  // workspaces), mounted identically into the replacement container — so the
  // pin lives there as a marker file, OUTSIDE the workspace (the agent must not
  // be able to pin itself by touching a file under /agent). `.pins/` is a
  // dot-dir: the host-dir sweep skips it (not an id-alphabet name) and the
  // legacy colour-root scan skips dot entries explicitly.

  private pinMarkerPath(sessionId: string): string {
    return join(this.cfg.hostSessionRoot, '.pins', `${sessionId}.pinned`);
  }

  async setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void> {
    if (
      expectedCreatedAtMs !== undefined &&
      (await this.incarnationContainerId(sessionId, expectedCreatedAtMs)) ===
        null
    ) {
      throw new SessionIncarnationChangedError(sessionId, 'container is gone');
    }
    if (!pinned) {
      // Unlike stop's best-effort cleanup, a toggle must acknowledge durable
      // removal. A failed unlink leaves observable drift for reconciliation.
      await rm(this.pinMarkerPath(sessionId), { force: true });
      return;
    }
    const marker = this.pinMarkerPath(sessionId);
    await mkdir(join(this.cfg.hostSessionRoot, '.pins'), { recursive: true });
    await writeFile(marker, `${Date.now()}\n`);
  }

  private async clearPinMarker(sessionId: string): Promise<void> {
    await rm(this.pinMarkerPath(sessionId), { force: true }).catch((err) => {
      console.warn(
        `[sandbox.session] clearing pin marker for ${sessionId} failed:`,
        err,
      );
    });
  }

  private async isPinned(sessionId: string): Promise<boolean> {
    try {
      await stat(this.pinMarkerPath(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  // --- the workspace's organization ----------------------------------------
  //
  // A session container names its organization in a label; the workspace it
  // leaves behind once stopped names it here, beside the pin markers and
  // outside the workspace for the same reason. The platform's workspace
  // cleanup reads it to tell this deployment's leftovers from another's, and
  // an organization's teardown finds the workspaces no container names any
  // more. Attribution only: a workspace without its marker (one created
  // before markers existed) is never taken for anyone's leftover.

  private ownerMarkerPath(sessionId: string): string {
    return join(this.cfg.hostSessionRoot, '.owners', `${sessionId}.org`);
  }

  private async writeOwnerMarker(
    sessionId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      await mkdir(join(this.cfg.hostSessionRoot, '.owners'), {
        recursive: true,
      });
      await writeFile(this.ownerMarkerPath(sessionId), `${organizationId}\n`);
    } catch (err) {
      console.warn(
        `[sandbox.session] recording the organization of ${sessionId} failed:`,
        err,
      );
    }
  }

  private async readOwnerMarker(
    sessionId: string,
  ): Promise<string | undefined> {
    let recorded: string;
    try {
      recorded = await readFile(this.ownerMarkerPath(sessionId), 'utf8');
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        console.warn(
          `[sandbox.session] reading the organization of ${sessionId} failed:`,
          err,
        );
      }
      return undefined;
    }
    const organizationId = recorded.trim();
    return ORG_ID_ALPHABET_RE.test(organizationId) ? organizationId : undefined;
  }

  private async clearOwnerMarker(sessionId: string): Promise<void> {
    await rm(this.ownerMarkerPath(sessionId), { force: true }).catch((err) => {
      console.warn(
        `[sandbox.session] clearing the organization of ${sessionId} failed:`,
        err,
      );
    });
  }

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    // No colour filter: the sandbox tier is a single container that rolls
    // in-place, so this spawner adopts ALL existing session containers —
    // including ones started by a previous (colour-rooted) build.
    const filters = [
      '--filter',
      'label=tale.sandbox-session=1',
      ...sessionInstanceFilter(this.cfg.instance),
    ];
    if (organizationId) {
      filters.push('--filter', `label=tale.org=${organizationId}`);
    }
    const res = await runDocker(
      [
        'ps',
        '--all',
        ...filters,
        '--format',
        `{{.Label "tale.session"}}\t{{.Label "tale.org"}}\t{{.Label "tale.profile"}}\t{{.Label "tale.created"}}\t{{.State}}\t{{.Label "${SESSION_INSTANCE_LABEL}"}}\t{{.Label "tale.docker"}}`,
      ],
      { timeoutMs: 10_000 },
    );
    // THROW, never `[]`, on a failed list: the callers (boot + periodic
    // adoption, the route layer's re-resolve) treat an empty list as "no
    // sessions", and a `docker ps` blip laundered into [] would leave every
    // running session unregistered — unroutable and never reaped — until the
    // next successful list. A throw is logged by the caller and retried.
    if (res.exitCode !== 0) {
      throw new Error(
        `docker ps (sessions) failed (exit ${res.exitCode}): ${res.stderr.trim() || res.stdout.trim() || 'no output'}`,
      );
    }
    const out: BackendSession[] = [];
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [sessionId, org, profile, created, state, instance, docker] =
        trimmed.split('\t');
      if (!sessionId) continue;
      // Another spawner on this Docker daemon (a connected device beside a
      // deployment) owns sessions labelled with its instance.
      if (!belongsToInstance(instance, this.cfg.instance)) continue;
      out.push({
        sessionId,
        organizationId: org ?? '',
        profile: isAgentSessionProfile(profile) ? profile : 'default',
        ...(docker === 'true' || docker === 'false'
          ? { docker: docker === 'true' }
          : {}),
        createdAtMs: Number(created) || 0,
        ttlMs: this.cfg.session.maxLifetimeMs,
        idleTimeoutMs: this.cfg.session.maxIdleMs,
        state: state === 'running' ? 'ready' : 'degraded',
        pinned: await this.isPinned(sessionId),
        ended: state !== undefined && isReapableContainerStatus(state),
      });
    }
    return out;
  }

  /** Every workspace dir under the host session root, joined with the
   * session containers beside them; the organization is the container's
   * label, or else the workspace's own marker. `listSessions` THROWS on a
   * failed `docker ps`, so a container that merely could not be listed never
   * reads as inactive. */
  async listWorkspaces(): Promise<BackendWorkspace[]> {
    const dirs = await listWorkspaceDirs(this.cfg.hostSessionRoot);
    const containers = new Map(
      (await this.listSessions()).map((session) => [
        session.sessionId,
        session,
      ]),
    );
    const workspaces: BackendWorkspace[] = [];
    for (const dir of dirs) {
      const container = containers.get(dir.sessionId);
      const organizationId =
        container !== undefined && container.organizationId !== ''
          ? container.organizationId
          : await this.readOwnerMarker(dir.sessionId);
      workspaces.push({
        sessionId: dir.sessionId,
        touchedAtMs: dir.touchedAtMs,
        active: container !== undefined && container.ended !== true,
        pinned: container?.pinned ?? (await this.isPinned(dir.sessionId)),
        ...(organizationId !== undefined ? { organizationId } : {}),
      });
    }
    return workspaces;
  }

  async listOrganizationResources(): Promise<string[]> {
    const organizations = new Set([
      ...(await listCacheVolumeOrganizations(this.cfg)),
      ...(await listBuildkitOrganizations()),
    ]);
    return [...organizations].sort();
  }

  /** The organization's build helpers, their volumes and network, then its
   * package caches. Whether the build cache is enabled right now does not
   * matter: what an earlier configuration left is the organization's too. */
  async teardownOrganization(
    organizationId: string,
  ): Promise<OrganizationTeardownResult> {
    const build = await removeOrganizationBuildkit(organizationId);
    const caches = await removeCacheVolumes(this.cfg, organizationId);
    return {
      containers: build.containers,
      volumes: build.volumes + caches,
      networks: build.networks,
    };
  }

  /**
   * Retire drained global helpers, then heal each organization's buildkitd so an
   * adopted session never builds against a daemon whose egress fence went stale
   * across a stack restart. ensureBuildkitd recreates a drifted daemon (its
   * `[dns]`/redsocks pinned to a since-moved sandbox-egress IP) and is a cheap
   * no-op when the daemon is already healthy. Gated on DinD + the build-cache
   * flag (no daemon otherwise); per-org best-effort — the cache is an
   * optimization, so a failure is logged, never thrown.
   */
  async reconcileBuildCache(
    orgIds: readonly string[],
    upkeep: BuildCacheUpkeep = {},
  ): Promise<void> {
    await retireLegacyBuildkitd().catch((error: unknown) => {
      console.warn(
        '[sandbox.session] legacy build-cache retirement deferred:',
        error,
      );
    });
    await sweepIdleBuildkitd(this.cfg, Date.now(), upkeep).catch(
      (error: unknown) => {
        console.warn(
          '[sandbox.session] idle build-cache cleanup deferred:',
          error,
        );
      },
    );
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
