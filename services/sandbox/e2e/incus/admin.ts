// The node's administrator, as the suites play it: the `incus` CLI on the local
// socket, as root. The spawner never does this (it holds a restricted
// certificate); the suites do, to look at what the spawner made and to change
// the node the way an operator would.

import {
  type IncusInstance,
  type IncusInstanceState,
  type IncusVolume,
  parseInstance,
  parseInstanceState,
  parseVolume,
} from '../../src/backend/incus/incus-api.ts';
import type { LabConfig } from './lab-config.ts';

export interface AdminResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface RunOptions {
  stdin?: string;
  /** Resolve with the failure instead of throwing. */
  allowFailure?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** An instance with what the administrator sees of it and the spawner does not
 * need: the expanded configuration and the address of its NIC. */
export interface AdminInstance extends IncusInstance {
  expandedConfig: Record<string, string>;
  addresses: readonly string[];
  /** The instance's state as `incus query` answers it at recursion 2. */
  state: IncusInstanceState | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

function stringEntries(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

export class Admin {
  private readonly prefix: readonly string[];

  constructor(readonly lab: LabConfig) {
    this.prefix = process.getuid?.() === 0 ? [] : ['sudo', '-n'];
  }

  /** `incus <args>` as the administrator. */
  run(args: readonly string[], options: RunOptions = {}) {
    return this.spawn(['incus', ...args], options);
  }

  /** Any command on the host, as root: the journal, the leases, the links. */
  host(command: readonly string[], options: RunOptions = {}) {
    return this.spawn(command, options);
  }

  private async spawn(command: readonly string[], options: RunOptions) {
    const proc = Bun.spawn([...this.prefix, ...command], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const result: AdminResult = { stdout, stderr, code };
    if (code !== 0 && options.allowFailure !== true) {
      throw new Error(
        `${command.join(' ')} exited ${code}: ${(stderr || stdout).trim()}`,
      );
    }
    return result;
  }

  /** A GET against the local API; the `metadata` of the answer. */
  async query(path: string): Promise<unknown> {
    const { stdout } = await this.run(['query', path]);
    return JSON.parse(stdout);
  }

  /** Like `query`, but undefined for a 404. */
  async queryOptional(path: string): Promise<unknown> {
    const result = await this.run(['query', path], { allowFailure: true });
    if (result.code === 0) return JSON.parse(result.stdout);
    if (/not found/i.test(result.stderr)) return undefined;
    throw new Error(`incus query ${path}: ${result.stderr.trim()}`);
  }

  private instancePath(name: string): string {
    return `/1.0/instances/${encodeURIComponent(name)}?project=${this.lab.project}`;
  }

  private toInstance(raw: unknown): AdminInstance {
    const body = record(raw, 'an instance');
    const instance = parseInstance(body);
    const state =
      body.state === undefined || body.state === null
        ? undefined
        : parseInstanceState(body.state);
    const addresses: string[] = [];
    for (const list of Object.values(state?.network ?? {})) {
      for (const entry of list) {
        if (entry.family === 'inet' && entry.scope === 'global') {
          addresses.push(entry.address);
        }
      }
    }
    return {
      ...instance,
      expandedConfig: stringEntries(body.expanded_config),
      addresses,
      state,
    };
  }

  /** Every instance of the sandbox project, with its state. */
  async instances(): Promise<AdminInstance[]> {
    const raw = await this.query(
      `/1.0/instances?project=${this.lab.project}&recursion=2`,
    );
    if (!Array.isArray(raw)) throw new Error('the instance list is not a list');
    return raw.map((item) => this.toInstance(item));
  }

  async instance(name: string): Promise<AdminInstance | undefined> {
    const raw = await this.queryOptional(
      `${this.instancePath(name)}&recursion=1`,
    );
    if (raw === undefined) return undefined;
    const state = await this.queryOptional(
      `/1.0/instances/${encodeURIComponent(name)}/state?project=${this.lab.project}`,
    );
    return this.toInstance({ ...record(raw, 'an instance'), state });
  }

  /** The raw API object of an instance (every field `incus query` returns). */
  async instanceRaw(name: string): Promise<Record<string, unknown>> {
    return record(
      await this.query(`${this.instancePath(name)}&recursion=1`),
      'an instance',
    );
  }

  async volumes(): Promise<IncusVolume[]> {
    const raw = await this.query(
      `/1.0/storage-pools/${this.lab.pool}/volumes/custom?project=${this.lab.project}&recursion=1`,
    );
    if (!Array.isArray(raw)) throw new Error('the volume list is not a list');
    return raw.map((item) => parseVolume(item));
  }

  /** What a custom volume of the project uses, and the quota it is held to
   * (when the driver reports one). */
  async volumeUsage(
    name: string,
  ): Promise<{ used: number; total: number | undefined }> {
    const state = record(
      await this.query(
        `/1.0/storage-pools/${this.lab.pool}/volumes/custom/${encodeURIComponent(name)}/state?project=${this.lab.project}`,
      ),
      'the volume state',
    );
    const usage = record(state.usage, 'the volume usage');
    if (typeof usage.used !== 'number') {
      throw new Error(`the volume ${name} reports no usage`);
    }
    return {
      used: usage.used,
      total: typeof usage.total === 'number' ? usage.total : undefined,
    };
  }

  async volume(name: string): Promise<IncusVolume | undefined> {
    const raw = await this.queryOptional(
      `/1.0/storage-pools/${this.lab.pool}/volumes/custom/${encodeURIComponent(name)}?project=${this.lab.project}`,
    );
    return raw === undefined ? undefined : parseVolume(raw);
  }

  /** `incus exec` into an instance of the sandbox project, as root. */
  exec(
    name: string,
    command: readonly string[],
    options: RunOptions = {},
  ): Promise<AdminResult> {
    return this.run(
      ['exec', name, '--project', this.lab.project, '--', ...command],
      options,
    );
  }

  /** The leases the bridge's DHCP server holds (a line of its lease file
   * each: an address handed out and not yet expired or released). */
  async leases(): Promise<string[]> {
    const result = await this.host(
      ['cat', `/var/lib/incus/networks/${this.lab.network}/dnsmasq.leases`],
      { allowFailure: true },
    );
    return result.stdout.split('\n').filter((line) => /^\d+ /.test(line));
  }

  /** The end of an instance's console log (an OCI instance's output). */
  async consoleLog(name: string): Promise<string> {
    const result = await this.run(
      ['console', name, '--project', this.lab.project, '--show-log'],
      { allowFailure: true },
    );
    return result.stdout || result.stderr;
  }

  async instanceLog(name: string): Promise<string> {
    const result = await this.run(
      ['info', name, '--project', this.lab.project, '--show-log'],
      { allowFailure: true },
    );
    return result.stdout || result.stderr;
  }

  async projectConfig(): Promise<Record<string, string>> {
    return stringEntries(
      record(
        await this.query(`/1.0/projects/${this.lab.project}`),
        'the project',
      ).config,
    );
  }

  async setProject(key: string, value: string): Promise<void> {
    await this.run(['project', 'set', this.lab.project, `${key}=${value}`]);
  }

  async unsetProject(key: string): Promise<void> {
    await this.run(['project', 'unset', this.lab.project, key]);
  }

  /** A key of the sandbox profile (the project's own, not the default's). */
  async setProfile(key: string, value: string): Promise<void> {
    await this.run([
      'profile',
      'set',
      this.lab.profile,
      `${key}=${value}`,
      '--project',
      this.lab.project,
    ]);
  }

  async unsetProfile(key: string): Promise<void> {
    await this.run([
      'profile',
      'unset',
      this.lab.profile,
      key,
      '--project',
      this.lab.project,
    ]);
  }

  /** Remove every instance and every custom volume of the sandbox project
   * (the images stay: pulling the runtime image is the slow part). */
  async cleanSlate(): Promise<void> {
    for (const instance of await this.instances()) {
      await this.run(
        ['delete', instance.name, '--project', this.lab.project, '--force'],
        { allowFailure: true },
      );
    }
    for (const volume of await this.volumes()) {
      await this.run(
        [
          'storage',
          'volume',
          'delete',
          this.lab.pool,
          volume.name,
          '--project',
          this.lab.project,
        ],
        { allowFailure: true },
      );
    }
  }
}
