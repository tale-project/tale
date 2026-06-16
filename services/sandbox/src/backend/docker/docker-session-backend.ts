// DockerSessionBackend — persistent sessions on the Compose path.
//
// Sibling of DockerBackend (one-shot). Launches a long-lived detached
// container running runnerd as PID 1, with a host-bind workspace that
// survives the container, and resolves the spawner→runnerd endpoint by
// container DNS name on tale-sandbox-net. Cleanup.ts's one-shot sweep ignores
// these (distinct `tale.sandbox-session=1` label).

import { chown, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { buildDockerSessionRunArgs } from '../../session/docker-session-args.ts';
import {
  runnerdEnvPatch,
  waitForRunnerd,
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

  async createSession(spec: SessionSpec): Promise<void> {
    const containerName = sessionContainerName(spec.sessionId);
    const workspaceHostDir = this.workspaceDir(spec.sessionId);
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
    if (!this.cfg.dockerInContainer) {
      await ensureCacheVolume(pip);
      await ensureCacheVolume(npm);
      await ensureCacheVolume(bun);
    }
    // Fresh, ephemeral /var/lib/docker volume for the inner dockerd (DinD only).
    // Recreated each start so a SIGKILLed dockerd's dirty overlay2 never wedges
    // resume; reaped on stop + destroy.
    const dockerStorageVolume = this.cfg.dockerInContainer
      ? await this.ensureFreshDindVolume(spec.sessionId)
      : undefined;

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
    });
    // The seed env is NOT passed on the `docker run` argv. A `--env
    // TALE_SESSION_ENV=…` would be readable by anyone with host Docker access
    // via `docker inspect`, and the seed env can carry secrets. It is instead
    // pushed to runnerd over POST /env after readiness (below), mirroring the
    // K8s backend, which routes it through a Secret rather than a visible arg.
    const run = await runDocker(argv, { timeoutMs: 30_000 });
    if (run.exitCode !== 0) {
      const stderr = run.stderr.trim();
      // A name conflict means a CONCURRENT createSession for the same id already
      // created the container — it is the WINNER's, not ours. Never run the
      // destructive cleanup below against it; just surface the failure (the
      // route layer reserves the id and returns 409 to keep the two from
      // racing in the first place; this is defense-in-depth).
      const nameConflict = /already in use|conflict/i.test(stderr);
      if (!nameConflict) {
        // Clean up a half-created container before surfacing the failure. On a
        // resume (preexisting dir), preserve the workspace; only a fresh create
        // deletes its own empty dir.
        await dockerRm(containerName).catch((err) =>
          console.warn('[sandbox.session] cleanup dockerRm failed:', err),
        );
        if (this.cfg.dockerInContainer) {
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
      await waitForRunnerd(
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
    const existed = await this.removeContainer(sessionId);
    if (this.cfg.dockerInContainer) await this.removeDindVolume(sessionId);
    await rm(this.workspaceDir(sessionId), {
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
}
