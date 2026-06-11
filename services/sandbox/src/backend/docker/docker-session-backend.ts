// DockerSessionBackend — persistent sessions on the Compose path.
//
// Sibling of DockerBackend (one-shot). Launches a long-lived detached
// container running runnerd as PID 1, with a host-bind workspace that
// survives the container, and resolves the spawner→runnerd endpoint by
// container DNS name on tale-sandbox-net. Cleanup.ts's one-shot sweep ignores
// these (distinct `tale.sandbox-session=1` label).

import { chown, mkdir, rm } from 'node:fs/promises';
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
    const profile =
      spec.profile === 'agent'
        ? this.cfg.session.agentProfile
        : { user: '65534:65534' };
    const uid = Number(profile.user.split(':')[0] ?? '65534');
    const gid = Number(profile.user.split(':')[1] ?? '65534');

    // Workspace dir survives the container; chown to the container's uid so
    // the unprivileged session process can write it.
    await mkdir(workspaceHostDir, { recursive: true });
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
    await ensureCacheVolume(pip);
    await ensureCacheVolume(npm);

    const token = this.tokenFor(spec.sessionId);
    const argv = buildDockerSessionRunArgs(this.cfg, {
      sessionId: spec.sessionId,
      organizationId: spec.organizationId,
      profile: spec.profile,
      workspaceHostDir,
      pipCacheVolume: pip,
      npmCacheVolume: npm,
      runnerdToken: token,
      createdAtMs: spec.createdAtMs,
    });
    // The seed env reaches runnerd via TALE_SESSION_ENV; passed as an extra
    // --env appended to the argv (kept out of docker-session-args.ts so the
    // pure builder snapshot stays env-content-free).
    const fullArgv = this.withSeedEnv(argv, spec.env);

    const run = await runDocker(fullArgv, { timeoutMs: 30_000 });
    if (run.exitCode !== 0) {
      // Clean up a half-created container before surfacing the failure.
      await dockerRm(containerName).catch(() => {});
      await rm(workspaceHostDir, { recursive: true, force: true }).catch(
        () => {},
      );
      throw new Error(
        `docker run (session) failed: ${run.stderr.trim() || run.stdout.trim()}`,
      );
    }

    // Poll runnerd until ready; on timeout tear the container down.
    try {
      await waitForRunnerd(
        { baseUrl: await this.resolveEndpoint(spec.sessionId), token },
        this.cfg.session.createHealthTimeoutMs,
      );
    } catch (err) {
      await this.destroySession(spec.sessionId);
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

  async destroySession(sessionId: string): Promise<boolean> {
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
