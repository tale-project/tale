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
 * outside this observation, as are deployments without the verified bind. */
export class DockerDataRootMount {
  private readonly docker: NonNullable<DockerDataRootMountDeps['docker']>;
  private readonly readFile: NonNullable<DockerDataRootMountDeps['readFile']>;
  private readonly now: () => number;
  private cached: { path: string | null; retryAtMs: number } | null = null;
  private discovering: Promise<string | null> | null = null;
  private verifiedMount: string | null = null;
  private warned: 'unknown' | 'retained' | null = null;

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

  private async discover(): Promise<string | null> {
    let path: string | null = null;
    let ttl = 10 * 60_000;
    try {
      const mountinfo = await this.readFile('/proc/self/mountinfo');
      const mounts = mountinfo.split('\n').filter((line) => {
        const fields = line.split(' ');
        return fields[4] === '/etc/hostname' && fields[3] !== undefined;
      });
      const mount = mounts.length === 1 ? mounts[0] : undefined;
      if (mount !== this.verifiedMount) this.verifiedMount = null;
      // mountinfo escapes whitespace/backslashes in path fields as octal.
      const root = mount
        ?.split(' ')[3]
        ?.replace(/\\(040|011|012|134)/g, (_match, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        );
      const id = root?.match(/\/containers\/([a-f0-9]{64})\/hostname$/)?.[1];
      if (root === undefined || id === undefined)
        throw new Error('no identifiable Docker hostname bind');
      // A busy/unavailable daemon cannot invalidate an unchanged, previously
      // verified kernel mount. Keep observing it during metadata retries.
      if (this.verifiedMount !== null) path = '/etc/hostname';
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
      path = null;
      this.verifiedMount = null;
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
      this.warned = null;
    } catch (error) {
      ttl = 30_000;
      const verdict = path === null ? 'unknown' : 'retained';
      if (this.warned !== verdict) {
        this.warned = verdict;
        console.warn(
          path === null
            ? '[sandbox] cannot verify the Docker data-root filesystem; its disk pressure is unknown (workspace admission remains active):'
            : '[sandbox] Docker data-root metadata is unavailable; continuing to observe its unchanged verified hostname mount:',
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
      throw new Error(
        `docker ${args[0]} failed while verifying its data-root (exit ${result.exitCode})`,
      );
    return JSON.parse(result.stdout);
  }
}
