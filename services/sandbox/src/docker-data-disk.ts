import { resolve } from 'node:path';

import {
  diskReserveBytes,
  HostDiskProbe,
  type HostDisk,
  type HostDiskSource,
} from './host-disk.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';

interface DockerDataDiskConfig {
  path: string;
  root?: string;
}

interface DockerDataDiskDeps {
  docker?: (args: string[]) => Promise<RunDockerResult>;
  disk?: HostDiskSource;
  hostname?: string;
  /** Direct host dev can trust a path only when /proc describes the daemon. */
  isLocalHost?: () => boolean;
  now?: () => number;
}

/** Docker volumes may live on a different disk from session workspaces.
 * Only an explicitly mapped, verified daemon data root counts as observed. */
export class DockerDataDiskProbe implements HostDiskSource {
  private readonly docker: NonNullable<DockerDataDiskDeps['docker']>;
  private readonly disk: HostDiskSource;
  private readonly now: () => number;
  private reading: HostDisk | null = null;
  private verifiedUntil = 0;
  private refreshing: Promise<HostDisk | null> | null = null;
  private warned = false;

  constructor(
    private readonly cfg: DockerDataDiskConfig,
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
    this.disk = deps.disk ?? new HostDiskProbe(cfg.path);
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
      throw new Error('Docker data filesystem identity could not be read');
    }
    return JSON.parse(result.stdout);
  }

  private async verify(): Promise<void> {
    const root = await this.json([
      'info',
      '--format',
      '{{json .DockerRootDir}}',
    ]);
    if (typeof root !== 'string' || !root.startsWith('/')) {
      throw new Error('DockerRootDir is invalid');
    }
    if (
      this.cfg.root !== undefined &&
      resolve(root) !== resolve(this.cfg.root)
    ) {
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
            entry.Destination === this.cfg.path &&
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
        resolve(this.cfg.path) === resolve(root)
      )
    ) {
      throw new Error(
        'Docker data path cannot be verified against this daemon',
      );
    }
    this.verifiedUntil = this.now() + 60_000;
  }

  private async readNow(fresh: boolean): Promise<HostDisk | null> {
    try {
      if (this.now() >= this.verifiedUntil) await this.verify();
      this.reading = await this.disk.read(fresh);
      if (this.reading === null)
        throw new Error('Docker data filesystem is unreadable');
      this.warned = false;
    } catch (error) {
      this.reading = null;
      this.verifiedUntil = 0;
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
      return { totalBytes: 0, availableBytes: 0, unavailable: true };
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
