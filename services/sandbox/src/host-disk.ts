// What the disk the session workspaces live on has left, for admission.
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

const GIB = 1024 ** 3;

export interface HostDisk {
  totalBytes: number;
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
