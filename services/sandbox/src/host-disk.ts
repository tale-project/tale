// What the disks the session workspaces and Docker metadata live on have
// left, for admission. A free-space floor is not a per-workspace quota.
//
// Every session's workspace — its clones, dependency installs, build output
// and temp files — is a directory under the spawner's session root on the
// Docker host, with no quota of its own (Kubernetes gives each a volume of a
// fixed size instead). A disk that fills up fails the next write of every
// running session and, on a single-machine install, of the platform's own
// databases beside them. So admission keeps a floor of free space on that
// disk, and while it is below the floor the build caches of organizations
// that are not building go first (buildkitd.ts).

import { statfs } from 'node:fs/promises';

import { runDocker, type RunDockerResult } from './spawn-util.ts';

const GIB = 1024 ** 3;

export interface HostDisk {
  totalBytes: number;
  /** Observation path: upkeep may only compare readings from the same one. */
  filesystem?: string;
  /** What an unprivileged process may still write there: sessions run as
   * one. */
  availableBytes: number;
  /** An explicitly configured filesystem could not be verified/read.
   * Its zero counters are placeholders, never a successful observation. */
  unavailable?: boolean;
}

/** The free space admission keeps on the session disk: the operator's (0
 * turns the floor off), else a twentieth of the disk, at least 2 GiB and at
 * most 20 GiB. */
export function diskReserveBytes(
  totalBytes: number,
  configuredBytes?: number,
): number {
  if (configuredBytes !== undefined) return configuredBytes;
  return Math.min(20 * GIB, Math.max(2 * GIB, Math.floor(totalBytes / 20)));
}

/** The session disk as upkeep that frees space sees it: what is free, and
 * whether that is below the floor. */
export interface SessionDiskState {
  availableBytes: number;
  short: boolean;
  filesystem?: string;
}

/** Whether a reading is below the floor; an unknown disk never is. */
export function belowDiskFloor(
  disk: HostDisk | null,
  configuredBytes?: number,
): boolean {
  if (disk === null) return false;
  if (configuredBytes === 0) return false;
  if (disk.unavailable === true) return true;
  return (
    disk.availableBytes < diskReserveBytes(disk.totalBytes, configuredBytes)
  );
}

/** A reading may be reused this long: disk fills over minutes, not
 * milliseconds, and the probe refreshes it at this pace. */
const READING_TTL_MS = 5_000;

export interface HostDiskDeps {
  statfs?: (
    path: string,
  ) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  now?: () => number;
}

/** Where admission reads the session disk from. */
export interface HostDiskSource {
  latest(): HostDisk | null;
  read(fresh?: boolean): Promise<HostDisk | null>;
}

export class HostDiskProbe implements HostDiskSource {
  private readonly statfs: NonNullable<HostDiskDeps['statfs']>;
  private readonly now: () => number;
  private reading: { atMs: number; disk: HostDisk | null } | null = null;
  private refreshing: Promise<HostDisk | null> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The last verdict logged, so each change is said once. */
  private wasShort = false;
  private unreadableWarned = false;

  constructor(
    /** A directory on the disk: the session root. */
    private readonly path: string,
    /** SANDBOX_MIN_FREE_DISK, when set. */
    private readonly configuredBytes?: number,
    deps: HostDiskDeps = {},
  ) {
    this.statfs = deps.statfs ?? ((dir) => statfs(dir));
    this.now = deps.now ?? Date.now;
  }

  /** Keep the reading fresh, so admission, which decides without waiting,
   * never judges a create on an old one. */
  start(): void {
    if (this.ticker !== null) return;
    void this.read(true);
    this.ticker = setInterval(() => {
      void this.read(true);
    }, READING_TTL_MS);
    this.ticker.unref();
  }

  stop(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The last reading, without waiting; null until the first lands, and
   * while the disk cannot be read. */
  latest(): HostDisk | null {
    return this.reading?.disk ?? null;
  }

  /** The disk now. A reading under {@link READING_TTL_MS} old is reused and
   * concurrent callers share one read, unless `fresh` asks for one taken
   * after the call. Never rejects: an unreadable disk is null. */
  read(fresh = false): Promise<HostDisk | null> {
    const reading = this.reading;
    if (
      !fresh &&
      reading !== null &&
      this.now() - reading.atMs < READING_TTL_MS
    ) {
      return Promise.resolve(reading.disk);
    }
    if (fresh) return this.readNow();
    this.refreshing ??= this.readNow().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async readNow(): Promise<HostDisk | null> {
    const atMs = this.now();
    let disk: HostDisk | null = null;
    try {
      const fs = await this.statfs(this.path);
      disk = {
        totalBytes: fs.blocks * fs.bsize,
        availableBytes: fs.bavail * fs.bsize,
        filesystem: this.path,
      };
      this.unreadableWarned = false;
    } catch (error) {
      if (!this.unreadableWarned) {
        this.unreadableWarned = true;
        console.warn(
          `[sandbox] cannot read the free space of ${this.path}; admission does not hold creates to it until it can:`,
          error,
        );
      }
    }
    // A slower read that started earlier never replaces a newer reading.
    if (this.reading === null || this.reading.atMs <= atMs) {
      this.reading = { atMs, disk };
      this.sayChange(disk);
    }
    return disk;
  }

  /** Log the session disk going below its floor, and coming back. */
  private sayChange(disk: HostDisk | null): void {
    if (disk === null) return;
    const short = belowDiskFloor(disk, this.configuredBytes);
    if (short === this.wasShort) return;
    this.wasShort = short;
    const free = `${(disk.availableBytes / GIB).toFixed(1)} GiB`;
    const floor = `${(diskReserveBytes(disk.totalBytes, this.configuredBytes) / GIB).toFixed(1)} GiB`;
    if (short) {
      console.warn(
        `[sandbox] the session disk (${this.path}) has ${free} free, below its ${floor} floor: new sessions wait until some is freed (SANDBOX_MIN_FREE_DISK)`,
      );
    } else {
      console.log(
        `[sandbox] the session disk (${this.path}) has ${free} free again, above its ${floor} floor`,
      );
    }
  }
}

/** How often a verified Docker data mount is compared with
 * /proc/self/mountinfo: a file read, no Docker call. */
export const MOUNT_RECHECK_MS = 60_000;
const VERIFY_RETRY_FIRST_MS = 30_000;
const VERIFY_RETRY_MAX_MS = 10 * 60_000;

/** When to try a failed Docker data verification again: 30 s after the
 * first failure, doubling with each further one, at most 10 min. */
export function verificationRetryMs(failures: number): number {
  return Math.min(
    VERIFY_RETRY_MAX_MS,
    VERIFY_RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1),
  );
}

/** The Docker CLI gave no usable answer (it failed, timed out or found no
 * slot): unlike an answer that refutes a mount, this says nothing about the
 * mount, so its retry does not back off past the first delay. */
export class DockerUnansweredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerUnansweredError';
  }
}

/** Decode mountinfo's octal escapes of whitespace and backslashes. */
export function unescapeMountPath(field: string): string {
  return field.replace(/\\(040|011|012|134)/g, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

export interface DockerDataRootMountDeps {
  docker?: (args: string[]) => Promise<RunDockerResult>;
  readFile?: (path: string) => Promise<string>;
  now?: () => number;
}

/** Discover an existing bind on Docker's metadata filesystem. Docker mounts
 * its per-container HostnamePath at /etc/hostname; kernel mountinfo supplies
 * the full container identity to verify with the selected daemon. This does
 * not inspect a guessed /var/lib/docker inside our own namespace, add a host
 * mount, or launch a helper. Separately mounted volumes/containerd stores are
 * outside this observation, as are deployments without the verified bind.
 *
 * A container's binds and its daemon's data-root do not change under a
 * running process, so a verification stands while the bind's mountinfo line
 * stays the same (checked every minute, no Docker call) and until the caller
 * reports the bind unreadable (`invalidate`). A failed verification is
 * retried after {@link verificationRetryMs}. */
export class DockerDataRootMount {
  private readonly docker: NonNullable<DockerDataRootMountDeps['docker']>;
  private readonly readFile: NonNullable<DockerDataRootMountDeps['readFile']>;
  private readonly now: () => number;
  private cached: { path: string | null; retryAtMs: number } | null = null;
  private discovering: Promise<string | null> | null = null;
  private verifiedMount: string | null = null;
  private failures = 0;
  private warned = false;

  constructor(deps: DockerDataRootMountDeps = {}) {
    this.docker =
      deps.docker ??
      ((args) => runDocker(args, { timeoutMs: 5_000, priority: true }));
    this.readFile = deps.readFile ?? ((path) => Bun.file(path).text());
    this.now = deps.now ?? Date.now;
  }

  read(): Promise<string | null> {
    if (this.cached !== null && this.now() < this.cached.retryAtMs)
      return Promise.resolve(this.cached.path);
    this.discovering ??= this.discover().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  /** The caller could not read the verified bind: a failure like a refuted
   * verification, so it is verified again only after the retry delay, which
   * keeps growing while the bind verifies but stays unreadable. */
  invalidate(): void {
    if (this.cached?.path === null) return;
    this.verifiedMount = null;
    this.failures += 1;
    this.cached = {
      path: null,
      retryAtMs: this.now() + verificationRetryMs(this.failures),
    };
  }

  private async discover(): Promise<string | null> {
    let path: string | null = null;
    let ttl = MOUNT_RECHECK_MS;
    try {
      const mountinfo = await this.readFile('/proc/self/mountinfo');
      const mounts = mountinfo.split('\n').filter((line) => {
        const fields = line.split(' ');
        return fields[4] === '/etc/hostname' && fields[3] !== undefined;
      });
      const mount = mounts.length === 1 ? mounts[0] : undefined;
      if (mount !== undefined && mount === this.verifiedMount) {
        // The bind verified earlier is still the one mounted, and has been
        // readable since the last check.
        this.failures = 0;
        this.cached = { path: '/etc/hostname', retryAtMs: this.now() + ttl };
        return '/etc/hostname';
      }
      this.verifiedMount = null;
      const root =
        mount?.split(' ')[3] === undefined
          ? undefined
          : unescapeMountPath(mount.split(' ')[3] ?? '');
      const id = root?.match(/\/containers\/([a-f0-9]{64})\/hostname$/)?.[1];
      if (root === undefined || id === undefined)
        throw new Error('no identifiable Docker hostname bind');
      const [info, inspect] = await Promise.all([
        this.dockerJson(['info', '--format', '{{json .DockerRootDir}}']),
        this.dockerJson([
          'inspect',
          '--type',
          'container',
          '--format',
          '{"id":{{json .Id}},"hostnamePath":{{json .HostnamePath}}}',
          id,
        ]),
      ]);
      if (
        typeof info !== 'string' ||
        !info.startsWith('/') ||
        inspect === null ||
        typeof inspect !== 'object' ||
        !('id' in inspect) ||
        inspect.id !== id ||
        !('hostnamePath' in inspect)
      )
        throw new Error('Docker metadata does not verify the hostname bind');
      const expected = `${info.replace(/\/+$/, '')}/containers/${id}/hostname`;
      if (inspect.hostnamePath !== expected || !expected.endsWith(root))
        throw new Error(
          'Docker hostname bind is outside the reported data-root',
        );
      path = '/etc/hostname';
      this.verifiedMount = mount ?? null;
      this.warned = false;
    } catch (error) {
      this.failures =
        error instanceof DockerUnansweredError ? 1 : this.failures + 1;
      ttl = verificationRetryMs(this.failures);
      if (!this.warned) {
        this.warned = true;
        console.warn(
          '[sandbox] cannot verify the Docker data-root filesystem; its disk pressure is unknown (workspace admission remains active):',
          error,
        );
      }
    }
    this.cached = { path, retryAtMs: this.now() + ttl };
    return path;
  }

  private async dockerJson(args: string[]): Promise<unknown> {
    const result = await this.docker(args);
    if (result.exitCode !== 0)
      throw new DockerUnansweredError(
        `docker ${args[0]} failed while verifying its data-root (exit ${result.exitCode})`,
      );
    return JSON.parse(result.stdout);
  }
}
