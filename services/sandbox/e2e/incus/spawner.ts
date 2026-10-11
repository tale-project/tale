// The spawner under test: this checkout's `src/server.ts`, started the way the
// image starts it, as a child process of the suite so that it can be stopped,
// killed and started again (re-adoption) and so that two of them can overlap
// (a rollout).

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type LabConfig, logDir } from './lab-config.ts';
import { field, SpawnerApi } from './spawner-api.ts';
import { asText, describeError } from './util.ts';

const SANDBOX_DIR = resolve(import.meta.dir, '../..');

export interface SpawnerSettings {
  /** Names the log file: `spawner-<name>-<start>.log`. */
  name: string;
  port: number;
  /** The shared SANDBOX_TOKEN; peers of one project must share it. */
  token: string;
  /** Variables on top of the lab's (a `undefined` value removes one). */
  env?: Record<string, string | undefined>;
}

/** A token as `tale deploy` mints it. */
export function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** The environment the lab gives a spawner: the documented variables of
 * docs/incus.md, and nothing the Docker host would have. */
export function spawnerEnv(
  lab: LabConfig,
  settings: SpawnerSettings,
  home: string,
): Record<string, string> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    LANG: 'C.UTF-8',
    // No deployment config: the environment decides.
    TALE_PLATFORM_SHARED_CONFIG_DIR: home,
    SANDBOX_BACKEND: 'incus',
    SANDBOX_TOKEN: settings.token,
    SANDBOX_PORT: String(settings.port),
    SANDBOX_INCUS_ENDPOINT: lab.endpoint,
    SANDBOX_INCUS_PROJECT: lab.project,
    SANDBOX_INCUS_PROFILE: lab.profile,
    SANDBOX_INCUS_NETWORK: lab.network,
    SANDBOX_INCUS_STORAGE_POOL: lab.pool,
    SANDBOX_INCUS_IMAGE: lab.image,
    SANDBOX_INCUS_IMAGE_SOURCE: lab.imageSource,
    SANDBOX_INCUS_CLIENT_CERT_FILE: lab.clientCertFile,
    SANDBOX_INCUS_CLIENT_KEY_FILE: lab.clientKeyFile,
    SANDBOX_INCUS_SERVER_CERT_FILE: lab.serverCertFile,
    SANDBOX_EGRESS_PROXY: lab.egressProxy,
    // Until the shm device is gone from the backend (a restricted project cannot admit it).
    SANDBOX_INCUS_SHM_DEVICE: 'false',
    SANDBOX_MAX_SESSIONS: '6',
    SANDBOX_INCUS_WORKSPACE_SIZE: '512MiB',
    ...settings.env,
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export class Spawner {
  readonly api: SpawnerApi;
  private proc: Bun.Subprocess | undefined;
  private starts = 0;
  private logFile = '';
  private readonly home: string;

  constructor(
    private readonly lab: LabConfig,
    readonly settings: SpawnerSettings,
  ) {
    this.api = new SpawnerApi(
      `http://127.0.0.1:${settings.port}`,
      settings.token,
    );
    this.home = mkdtempSync(
      join(tmpdir(), `incus-e2e-spawner-${settings.name}-`),
    );
  }

  get running(): boolean {
    return this.proc !== undefined && this.proc.exitCode === null;
  }

  get log(): string {
    return this.logFile;
  }

  /** The last `lines` lines of the current (or last) run's log. */
  logTail(lines = 60): string {
    if (this.logFile === '') return '(never started)';
    try {
      return readFileSync(this.logFile, 'utf8')
        .split('\n')
        .slice(-lines)
        .join('\n');
    } catch (error) {
      return `(log unreadable: ${describeError(error)})`;
    }
  }

  /** Start the process; the caller waits for it with `ready`. */
  start(env: Record<string, string | undefined> = {}): void {
    if (this.running)
      throw new Error(`spawner ${this.settings.name} already runs`);
    this.starts += 1;
    mkdirSync(logDir(this.lab), { recursive: true });
    this.logFile = join(
      logDir(this.lab),
      `spawner-${this.settings.name}-${this.starts}.log`,
    );
    const settings = {
      ...this.settings,
      env: { ...this.settings.env, ...env },
    };
    this.proc = Bun.spawn(
      ['bash', '-c', 'exec bun src/server.ts >>"$SPAWNER_LOG" 2>&1'],
      {
        cwd: SANDBOX_DIR,
        env: {
          ...spawnerEnv(this.lab, settings, this.home),
          SPAWNER_LOG: this.logFile,
        },
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
  }

  /**
   * Wait for /health to answer ok (and, with `image`, for the runtime image to
   * be present: the first boot pulls it from the registry and has Incus unpack
   * it). Throws with the log's tail when the process dies or the time is up.
   */
  async ready(
    options: { image?: boolean; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const deadline = performance.now() + (options.timeoutMs ?? 30 * 60_000);
    let last = 'no answer yet';
    for (;;) {
      if (this.proc !== undefined && this.proc.exitCode !== null) {
        throw new Error(
          `spawner ${this.settings.name} exited ${this.proc.exitCode} before it was ready:\n${this.logTail()}`,
        );
      }
      try {
        const reply = await this.api.health(5_000);
        last = `${reply.status} ${reply.text.slice(0, 300)}`;
        if (reply.status === 200) {
          const image = field(reply.json, 'runtimeImage', 'state');
          if (options.image !== true || image === 'ready') return reply.json;
          last = `health ok, runtime image ${String(image)}: ${asText(field(reply.json, 'runtimeImage', 'lastError') ?? '')}`;
        }
      } catch (error) {
        last = describeError(error);
      }
      if (performance.now() > deadline) {
        throw new Error(
          `spawner ${this.settings.name} was not ready in time (${last}):\n${this.logTail(120)}`,
        );
      }
      await Bun.sleep(options.image === true ? 3_000 : 500);
    }
  }

  /** SIGTERM, then SIGKILL after `graceMs`; the exit code. */
  async stop(graceMs = 30_000): Promise<number | null> {
    const proc = this.proc;
    if (proc === undefined || proc.exitCode !== null)
      return proc?.exitCode ?? null;
    proc.kill('SIGTERM');
    const exited = await Promise.race([
      proc.exited,
      Bun.sleep(graceMs).then(() => null),
    ]);
    if (exited === null) {
      proc.kill('SIGKILL');
      await proc.exited;
    }
    return proc.exitCode;
  }

  /** SIGKILL: a crash, nothing flushed. */
  async kill(): Promise<void> {
    const proc = this.proc;
    if (proc === undefined || proc.exitCode !== null) return;
    proc.kill('SIGKILL');
    await proc.exited;
  }

  /** Wait for the process to end by itself (a boot that must be refused). */
  async exited(timeoutMs = 120_000): Promise<number | null> {
    const proc = this.proc;
    if (proc === undefined) return null;
    const code = await Promise.race([
      proc.exited,
      Bun.sleep(timeoutMs).then(() => null),
    ]);
    return code === null ? null : proc.exitCode;
  }
}
