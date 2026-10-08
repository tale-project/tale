import { resolve } from 'node:path';

import {
  diskReserveBytes,
  DockerDataRootMount,
  DockerUnansweredError,
  HostDiskProbe,
  MOUNT_RECHECK_MS,
  unescapeMountPath,
  verificationRetryMs,
  type HostDisk,
  type HostDiskSource,
} from './host-disk.ts';
import {
  isDockerNoSuchObject,
  runDocker,
  type RunDockerResult,
} from './spawn-util.ts';

interface DockerDataDiskConfig {
  path: string;
  root?: string;
}

interface DockerDataDiskDeps {
  docker?: (args: string[]) => Promise<RunDockerResult>;
  disk?: HostDiskSource;
  mount?: Pick<DockerDataRootMount, 'read'> &
    Partial<Pick<DockerDataRootMount, 'invalidate'>>;
  hostname?: string;
  /** Direct host dev can trust a path only when /proc describes the daemon. */
  isLocalHost?: () => boolean;
  readFile?: (path: string) => Promise<string>;
  now?: () => number;
}

/** The /proc/self/mountinfo line of the mount a path lives on: the one with
 * the longest mount point containing it, the last of those when mounts are
 * stacked. Null when mountinfo cannot be read or names none. */
export function mountLineFor(mountinfo: string, path: string): string | null {
  const target = resolve(path);
  let found: { line: string; depth: number } | null = null;
  for (const line of mountinfo.split('\n')) {
    const point = line.split(' ')[4];
    if (point === undefined) continue;
    const mountPoint = unescapeMountPath(point);
    const contains =
      mountPoint === '/' ||
      target === mountPoint ||
      target.startsWith(`${mountPoint}/`);
    if (!contains) continue;
    const depth = mountPoint === '/' ? 0 : mountPoint.length;
    if (found === null || depth >= found.depth) found = { line, depth };
  }
  return found?.line ?? null;
}

/** Observe Docker's metadata filesystem through one verified source: an
 * explicit read-only data-root mount takes priority, otherwise discover the
 * existing hostname bind. Neither observation supplies a storage quota.
 *
 * An explicit path is verified with the daemon once per process: a
 * container's binds and its daemon's data-root do not change under it. It is
 * verified again only when its free space cannot be read or the mountinfo
 * line of the mount it lives on changes (compared every minute, no Docker
 * call). A failed verification is retried after 30 s, doubling to 10 min
 * while the daemon keeps refuting the mount; until then the configured disk
 * reads as unavailable, which holds new sessions back as before. */
export class DockerDataDiskProbe implements HostDiskSource {
  private readonly docker: NonNullable<DockerDataDiskDeps['docker']>;
  private disk: HostDiskSource | undefined;
  private readonly mount: NonNullable<DockerDataDiskDeps['mount']>;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly now: () => number;
  private reading: HostDisk | null = null;
  /** The verified mount's mountinfo line, and when it was last compared. */
  private verified: { mountLine: string | null; checkedAtMs: number } | null =
    null;
  private failures = 0;
  private retryAtMs = 0;
  private lastFailure: unknown = null;
  private refreshing: Promise<HostDisk | null> | null = null;
  private warned = false;
  private mountinfoWarned = false;

  constructor(
    private readonly cfg: DockerDataDiskConfig | undefined,
    private readonly deps: DockerDataDiskDeps = {},
  ) {
    this.docker =
      deps.docker ??
      ((args) =>
        runDocker(args, {
          timeoutMs: 5_000,
          priority: true,
          stdoutMaxBytes: 64 * 1024,
        }));
    this.disk =
      deps.disk ??
      (cfg === undefined ? undefined : new HostDiskProbe(cfg.path));
    this.mount = deps.mount ?? new DockerDataRootMount();
    this.readFile = deps.readFile ?? ((path) => Bun.file(path).text());
    this.now = deps.now ?? Date.now;
  }

  latest(): HostDisk | null {
    return this.reading;
  }

  read(fresh = false): Promise<HostDisk | null> {
    this.refreshing ??= this.readNow(fresh).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async json(args: string[]): Promise<unknown> {
    const result = await this.docker(args);
    if (result.exitCode !== 0 || result.stdoutTruncated) {
      const message = 'Docker data filesystem identity could not be read';
      // A daemon that answered "no such object" refuted the mount; only one
      // that did not answer is asked again at the first delay.
      throw result.exitCode !== 0 && isDockerNoSuchObject(result.stderr)
        ? new Error(message)
        : new DockerUnansweredError(message);
    }
    return JSON.parse(result.stdout);
  }

  /** The mountinfo line of the mount the explicit path lives on; null where
   * mountinfo cannot be read (then only a failed read re-verifies). */
  private async mountLine(path: string): Promise<string | null> {
    try {
      return mountLineFor(await this.readFile('/proc/self/mountinfo'), path);
    } catch (error) {
      if (!this.mountinfoWarned) {
        this.mountinfoWarned = true;
        console.warn(
          '[sandbox] cannot read /proc/self/mountinfo to follow the Docker data mount; only an unreadable disk verifies it again:',
          error,
        );
      }
      return null;
    }
  }

  private async verify(): Promise<void> {
    const cfg = this.cfg;
    if (cfg === undefined)
      throw new Error('Explicit Docker data path is absent');
    const root = await this.json([
      'info',
      '--format',
      '{{json .DockerRootDir}}',
    ]);
    if (typeof root !== 'string' || !root.startsWith('/')) {
      throw new Error('DockerRootDir is invalid');
    }
    if (cfg.root !== undefined && resolve(root) !== resolve(cfg.root)) {
      throw new Error('SANDBOX_DOCKER_DATA_ROOT does not match DockerRootDir');
    }
    const hostname = this.deps.hostname ?? process.env.HOSTNAME;
    if (hostname !== undefined && /^[a-f0-9]{12,64}$/.test(hostname)) {
      const mounts = await this.json([
        'inspect',
        '--format',
        '{{json .Mounts}}',
        hostname,
      ]);
      const matching =
        Array.isArray(mounts) &&
        mounts.some((entry: unknown) => {
          if (entry === null || typeof entry !== 'object') return false;
          return (
            'Type' in entry &&
            entry.Type === 'bind' &&
            'Source' in entry &&
            entry.Source === root &&
            'Destination' in entry &&
            entry.Destination === cfg.path &&
            'RW' in entry &&
            entry.RW === false
          );
        });
      if (!matching)
        throw new Error(
          'Docker data path is not a read-only bind of DockerRootDir',
        );
    } else if (
      !(
        this.deps.isLocalHost?.() === true &&
        resolve(cfg.path) === resolve(root)
      )
    ) {
      throw new Error(
        'Docker data path cannot be verified against this daemon',
      );
    }
  }

  /** Verify the explicit path when nothing stands, or when the mount it
   * lives on changed; throws while it cannot be. */
  private async ensureVerified(path: string): Promise<void> {
    const now = this.now();
    const verified = this.verified;
    if (verified !== null) {
      if (now - verified.checkedAtMs < MOUNT_RECHECK_MS) return;
      const line = await this.mountLine(path);
      if (line === verified.mountLine) {
        verified.checkedAtMs = now;
        // Readable since the last comparison: a later failure starts over.
        this.failures = 0;
        return;
      }
      this.verified = null;
    }
    if (now < this.retryAtMs) throw this.lastFailure;
    try {
      const mountLine = await this.mountLine(path);
      await this.verify();
      this.verified = { mountLine, checkedAtMs: now };
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Count a failure and set when to verify again: the first delay for a
   * daemon that did not answer, a growing one for anything else. */
  private fail(error: unknown): void {
    this.failures =
      error instanceof DockerUnansweredError ? 1 : this.failures + 1;
    this.retryAtMs = this.now() + verificationRetryMs(this.failures);
    this.lastFailure = error;
  }

  private async readNow(fresh: boolean): Promise<HostDisk | null> {
    if (this.cfg === undefined) {
      const path = await this.mount.read();
      if (path === null) return (this.reading = null);
      this.disk ??= new HostDiskProbe(path);
      this.reading = await this.disk.read(fresh);
      // The verified bind cannot be read: it is verified again.
      if (this.reading === null) this.mount.invalidate?.();
      return this.reading;
    }
    try {
      await this.ensureVerified(this.cfg.path);
      this.reading = (await this.disk?.read(fresh)) ?? null;
      if (this.reading === null) {
        // A statfs that fails says nothing about which filesystem the bind
        // is: the mount stays verified, and the next read tries statfs again
        // without asking Docker.
        throw new Error('Docker data filesystem is unreadable');
      }
      this.warned = false;
    } catch (error) {
      this.reading = null;
      if (!this.warned) {
        console.warn(
          '[sandbox] Docker data disk monitoring unavailable; configured disk admission is closed:',
          error,
        );
        this.warned = true;
      }
    }
    return this.reading;
  }
}

/** One admission decision over independently measured filesystems. Unknown
 * optional monitoring is reported; an explicitly configured unreadable disk
 * cannot silently remove the operator's guard. */
export class SandboxDiskProbe implements HostDiskSource {
  private ticker: ReturnType<typeof setInterval> | undefined;
  private reading: Promise<HostDisk | null> | null = null;

  constructor(
    private readonly workspace: HostDiskSource,
    private readonly dockerData?: HostDiskSource,
    private readonly reserve?: number,
    private readonly dockerDataRequired = true,
  ) {
    if (dockerData === undefined) {
      console.warn(
        '[sandbox] Docker data filesystem is not monitored; configure SANDBOX_DOCKER_DATA_PATH with a verified read-only data-root mount',
      );
    }
  }

  status() {
    return {
      workspace: this.workspace.latest() === null ? 'unavailable' : 'ready',
      dockerData:
        this.dockerData === undefined
          ? 'unconfigured'
          : this.dockerData.latest() === null
            ? 'unavailable'
            : 'ready',
    };
  }

  latest(): HostDisk | null {
    const workspace = this.workspace.latest();
    if (this.dockerData === undefined) return workspace;
    const docker = this.dockerData.latest();
    if (docker === null)
      return this.dockerDataRequired
        ? { totalBytes: 0, availableBytes: 0, unavailable: true }
        : workspace;
    if (workspace === null) return docker;
    const headroom = (disk: HostDisk) =>
      disk.availableBytes - diskReserveBytes(disk.totalBytes, this.reserve);
    return headroom(docker) < headroom(workspace) ? docker : workspace;
  }

  read(fresh = false): Promise<HostDisk | null> {
    this.reading ??= Promise.all([
      this.workspace.read(fresh),
      this.dockerData?.read(fresh),
    ])
      .then(() => this.latest())
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  start(): void {
    if (this.ticker !== undefined) return;
    void this.read(true);
    this.ticker = setInterval(() => {
      void this.read(true);
    }, 5_000);
    this.ticker.unref();
  }

  stop(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }
}
