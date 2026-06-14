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
import { waitForRunnerd } from '../../session/runnerd-client.ts';
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
    await ensureCacheVolume(pip);
    await ensureCacheVolume(npm);
    await ensureCacheVolume(bun);

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
    });
    // The seed env reaches runnerd via TALE_SESSION_ENV; passed as an extra
    // --env appended to the argv (kept out of docker-session-args.ts so the
    // pure builder snapshot stays env-content-free).
    const fullArgv = this.withSeedEnv(argv, spec.env);

    const run = await runDocker(fullArgv, { timeoutMs: 30_000 });
    if (run.exitCode !== 0) {
      // Clean up a half-created container before surfacing the failure. On a
      // resume (preexisting dir), preserve the workspace; only a fresh create
      // deletes its own empty dir.
      await dockerRm(containerName).catch((err) =>
        console.warn('[sandbox.session] cleanup dockerRm failed:', err),
      );
      if (!preexisting) {
        await rm(workspaceHostDir, { recursive: true, force: true }).catch(
          (err) =>
            console.warn('[sandbox.session] cleanup workspace rm failed:', err),
        );
      }
      throw new Error(
        `docker run (session) failed: ${run.stderr.trim() || run.stdout.trim()}`,
      );
    }

    // Poll runnerd until ready; on timeout tear the container down — but a
    // resume keeps its preserved workspace (stop, not destroy).
    try {
      await waitForRunnerd(
        { baseUrl: await this.resolveEndpoint(spec.sessionId), token },
        this.cfg.session.createHealthTimeoutMs,
      );
    } catch (err) {
      if (preexisting) {
        await this.stopSession(spec.sessionId);
      } else {
        await this.destroySession(spec.sessionId);
      }
      throw err;
    }
  }

  /** Append the session seed env as a single TALE_SESSION_ENV JSON --env,
   * just before the image positional. Kept here (not in the pure builder) so
   * user-controlled env content never enters the snapshot-tested argv. */
  private withSeedEnv(argv: string[], env: Record<string, string>): string[] {
    if (Object.keys(env).length === 0) return argv;
    const imageIdx = argv.lastIndexOf(this.cfg.runtimeImage);
    if (imageIdx === -1) return argv;
    const inject = ['--env', `TALE_SESSION_ENV=${JSON.stringify(env)}`];
    return [...argv.slice(0, imageIdx), ...inject, ...argv.slice(imageIdx)];
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

  async destroySession(sessionId: string): Promise<boolean> {
    const existed = await this.removeContainer(sessionId);
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
    // createSession with the same sessionId re-mounts it (resume).
    return this.removeContainer(sessionId);
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
