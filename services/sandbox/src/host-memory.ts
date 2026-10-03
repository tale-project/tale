// What the Docker host has left in memory, for admission and capacity sizing.
//
// A session's memory limit is a ceiling, not a reservation: an idle session
// uses ~60 MB and an agent turn a few hundred, so counting sessions alone
// either wastes most of a large host or lets a small one be overcommitted
// until the kernel's OOM killer picks sessions. The spawner reads the host's
// MemAvailable instead and admits a session only while the host would keep
// its reserve free. That reading is only trusted where /proc describes the
// Docker host: the standard local socket, the same kernel and the same total
// as the daemon reports (a remote daemon, or a context pointing elsewhere,
// leaves admission to the session count alone).

import { release } from 'node:os';

import { parseMemory } from './capacity.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';
import type { SandboxSessionProfile } from './wire.ts';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** What one session typically holds while it works: an agent turn (the CLI
 * and its MCP servers), a turn with its inner Docker daemon, a crawler render
 * (Chromium and a few pages). Admission keeps this much per starting session
 * beyond the reserve. */
const SESSION_WORKING_SET_BYTES = {
  agent: 512 * MIB,
  dind: 1536 * MIB,
  default: 512 * MIB,
} as const;

/** The memory a session slot is sized with when capacity follows the host:
 * between an idle session and a heavy turn, so a busy fleet still fits —
 * and a whole Docker-in-sandbox turn where agent sessions run their own
 * daemon. */
const SIZING_BYTES_PER_SESSION = 768 * MIB;
const AUTO_MIN_SESSIONS = 8;
const AUTO_MAX_SESSIONS = 256;

export interface HostMemory {
  totalBytes: number;
  availableBytes: number;
}

/** The memory admission always leaves free: the operator's, else a tenth of
 * the host and at least 1 GiB (the platform, its databases and the page cache
 * live on the same machine). */
export function memoryReserveBytes(
  totalBytes: number,
  configuredBytes?: number,
): number {
  return configuredBytes ?? Math.max(GIB, Math.floor(totalBytes / 10));
}

/** The session capacity a host of this size gets when the operator set none:
 * never below the fixed default it replaces, never above 256. */
export function autoSessionCapacity(
  totalBytes: number,
  reserveBytes: number,
  dockerInside = false,
): number {
  const perSession = Math.max(
    SIZING_BYTES_PER_SESSION,
    sessionWorkingSetBytes('agent', dockerInside),
  );
  const fits = Math.floor((totalBytes - reserveBytes) / perSession);
  return Math.min(AUTO_MAX_SESSIONS, Math.max(AUTO_MIN_SESSIONS, fits));
}

/** The working set admission plans for a session of this kind. */
export function sessionWorkingSetBytes(
  profile: SandboxSessionProfile,
  dockerInside: boolean,
): number {
  if (profile === 'agent-light') return SESSION_WORKING_SET_BYTES.agent;
  if (profile !== 'agent') return SESSION_WORKING_SET_BYTES.default;
  return dockerInside
    ? SESSION_WORKING_SET_BYTES.dind
    : SESSION_WORKING_SET_BYTES.agent;
}

/** A MemAvailable reading may be reused this long: a burst of creates reads
 * the file once, and in-flight creates are accounted for separately. */
const READING_TTL_MS = 1_000;
/** How long the verdict "this /proc describes the Docker host" holds. */
const VERDICT_TTL_MS = 10 * 60_000;
/** How long a verdict the Docker CLI could not reach holds: a busy daemon
 * right after a reboot must not switch the memory guard off for ten
 * minutes. */
const FAILED_VERDICT_TTL_MS = 30_000;

export interface HostMemoryDeps {
  docker?: (args: string[]) => Promise<RunDockerResult>;
  readFile?: (path: string) => Promise<string>;
  kernelRelease?: () => string;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

export class HostMemoryProbe {
  private readonly docker: (args: string[]) => Promise<RunDockerResult>;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly kernelRelease: () => string;
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private verdict: {
    local: boolean;
    atMs: number;
    totalBytes: number;
    failed: boolean;
  } | null = null;
  private judging: Promise<boolean> | null = null;
  private reading: { atMs: number; memory: HostMemory | null } | null = null;
  private refreshing: Promise<HostMemory | null> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HostMemoryDeps = {}) {
    // Short calls: a burst of creates holding every shared docker CLI slot
    // must not switch the memory guard off.
    this.docker =
      deps.docker ??
      ((args) => runDocker(args, { timeoutMs: 5_000, priority: true }));
    this.readFile = deps.readFile ?? ((path) => Bun.file(path).text());
    this.kernelRelease = deps.kernelRelease ?? release;
    this.now = deps.now ?? Date.now;
    this.env = deps.env ?? process.env;
  }

  /** Keep the reading fresh: one read a second, so admission, which
   * decides without waiting, never judges a create on an old one. */
  start(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => {
      void this.read().catch((error: unknown) => {
        console.warn('[sandbox] host memory refresh failed:', error);
      });
    }, READING_TTL_MS);
    this.ticker.unref();
  }

  stop(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The last reading, without waiting: what admission decides with inside
   * its lock — about a second old once `start()` keeps it fresh. Null until
   * the first reading lands, and where this process cannot see the Docker
   * host's memory. */
  latest(): HostMemory | null {
    return this.reading?.memory ?? null;
  }

  /** The host's memory, or null when this process cannot see the Docker
   * host's (never a guess: null leaves admission to the session count). A
   * reading under a second old is reused and concurrent callers share one
   * read, unless `fresh` asks for one taken after the call. */
  read(fresh = false): Promise<HostMemory | null> {
    const reading = this.reading;
    if (
      !fresh &&
      reading !== null &&
      this.now() - reading.atMs < READING_TTL_MS
    ) {
      return Promise.resolve(reading.memory);
    }
    if (fresh) return this.readNow();
    this.refreshing ??= this.readNow().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async readNow(): Promise<HostMemory | null> {
    const now = this.now();
    let memory: HostMemory | null = null;
    if (await this.describesDockerHost()) {
      try {
        const parsed = parseMemory(await this.readFile('/proc/meminfo'));
        if (parsed !== null && parsed.totalBytes === this.verdict?.totalBytes) {
          memory = {
            totalBytes: parsed.totalBytes,
            availableBytes: parsed.totalBytes - parsed.usedBytes,
          };
        }
      } catch (error) {
        console.warn('[sandbox] cannot read the host memory:', error);
      }
    }
    // A slower read that started earlier never replaces a newer reading.
    if (this.reading === null || this.reading.atMs <= now) {
      this.reading = { atMs: now, memory };
    }
    return memory;
  }

  private describesDockerHost(): Promise<boolean> {
    const verdict = this.verdict;
    const ttl =
      verdict?.failed === true ? FAILED_VERDICT_TTL_MS : VERDICT_TTL_MS;
    if (verdict !== null && this.now() - verdict.atMs < ttl) {
      return Promise.resolve(verdict.local);
    }
    this.judging ??= this.judge().finally(() => {
      this.judging = null;
    });
    return this.judging;
  }

  private async judge(): Promise<boolean> {
    let local = false;
    let totalBytes = 0;
    let failed = false;
    try {
      const endpoint =
        !this.env.DOCKER_CONTEXT && this.env.DOCKER_HOST
          ? this.env.DOCKER_HOST
          : await this.dockerJson([
              'context',
              'inspect',
              '--format',
              '{{json .Endpoints.docker.Host}}',
            ]);
      const info = await this.dockerJson([
        'info',
        '--format',
        '{"memory":{{json .MemTotal}},"kernel":{{json .KernelVersion}}}',
      ]);
      const daemonTotal =
        info !== null && typeof info === 'object' && 'memory' in info
          ? info.memory
          : null;
      const daemonKernel =
        info !== null && typeof info === 'object' && 'kernel' in info
          ? info.kernel
          : null;
      const own = parseMemory(await this.readFile('/proc/meminfo'));
      local =
        (endpoint === 'unix:///var/run/docker.sock' ||
          endpoint === 'unix:///run/docker.sock') &&
        daemonKernel === this.kernelRelease() &&
        typeof daemonTotal === 'number' &&
        own !== null &&
        own.totalBytes === daemonTotal;
      totalBytes = local && own !== null ? own.totalBytes : 0;
    } catch (error) {
      failed = true;
      // A host once found to be the Docker host stays it: a re-judge the
      // CLI could not answer (a busy daemon, a burst holding every CLI slot)
      // must not switch the memory guard off. It is asked again soon.
      const previous = this.verdict;
      if (previous?.local === true) {
        local = true;
        totalBytes = previous.totalBytes;
      }
      console.warn(
        `[sandbox] cannot tell whether this host is the Docker host${local ? '; keeping the last verdict' : '; admission counts sessions only'} (asked again in ${FAILED_VERDICT_TTL_MS / 1000} s):`,
        error,
      );
    }
    this.verdict = { local, atMs: this.now(), totalBytes, failed };
    return local;
  }

  private async dockerJson(args: string[]): Promise<unknown> {
    const result = await this.docker(args);
    if (result.exitCode !== 0) {
      throw new Error(
        `docker ${args[0]} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout.trim());
  }
}
