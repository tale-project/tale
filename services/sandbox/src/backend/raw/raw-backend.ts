// The raw backend's host lifecycle: the device's directories and accounts are
// checked at boot, there is no image to warm, and the orphan sweep ends what a
// slot account still runs while no session holds it. See docs/raw.md.

import { constants } from 'node:fs';
import { access, chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnerConfig } from '../../types.ts';
import type { HealthResult, HostBackend, SweepOptions } from '../types.ts';
import type { RawConfig } from './raw-config.ts';
import { hostProcesses, type RawProcesses } from './raw-processes.ts';
import type { RawSessionBackend } from './raw-session-backend.ts';

export interface RawHostBackendDeps {
  processes?: RawProcesses;
  isRoot?: () => boolean;
  /** The session backend whose idle slots the sweep checks. */
  sessions?: () => RawSessionBackend | null;
}

export class RawHostBackend implements HostBackend {
  readonly kind = 'raw' as const;
  private readonly processes: RawProcesses;
  private readonly isRoot: () => boolean;

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly raw: RawConfig,
    private readonly deps: RawHostBackendDeps = {},
  ) {
    this.processes = deps.processes ?? hostProcesses;
    this.isRoot = deps.isRoot ?? (() => process.getuid?.() === 0);
  }

  async init(): Promise<void> {
    if (this.raw.isolation === 'isolated' && !this.isRoot()) {
      throw new Error(
        'an isolated raw device runs its sessions as its slot accounts, which only root may do: run the device service as root, or connect the device as shared',
      );
    }
    if (this.raw.isolation === 'shared' && this.isRoot()) {
      throw new Error(
        "a shared raw device runs every session as the service's own account, and refuses to run them as root: run the device service as an ordinary account, or connect the device as isolated",
      );
    }
    // The root is traversed by the slots (their sessions and the runtime's
    // helpers live below it), listed by no one; what only the spawner reads
    // stays its own.
    await mkdir(this.raw.root, { recursive: true, mode: 0o711 });
    const modes: Array<[string, number]> = [
      ['sessions', 0o711],
      ['control', 0o700],
      ['logs', 0o700],
    ];
    for (const [name, mode] of modes) {
      const dir = join(this.raw.root, name);
      await mkdir(dir, { recursive: true, mode });
      await chmod(dir, mode);
    }
    if (this.raw.isolation === 'isolated') await chmod(this.raw.root, 0o711);
    await access(this.raw.runnerd[0] ?? '', constants.X_OK);
    for (const slot of this.raw.slots) {
      const uid = await this.processes.run(['id', '-u', slot.user], {
        timeoutMs: 10_000,
      });
      if (uid.code !== 0 || uid.stdout.trim() !== String(slot.uid)) {
        throw new Error(
          `slot account ${slot.user} is not uid ${slot.uid} on this host (id -u: ${uid.stdout.trim() || uid.stderr.trim()})`,
        );
      }
    }
    console.log(
      `[sandbox.raw] sessions run on this host (${this.raw.isolation}${this.raw.isolation === 'isolated' ? `, ${this.raw.slots.length} slot accounts` : ''}) under ${this.raw.root}; at most ${this.cfg.session.maxSessions} at once`,
    );
  }

  async shutdown(): Promise<void> {
    // Sessions outlive the spawner, like containers do: a restart re-adopts
    // their runnerds from the records.
  }

  async health(): Promise<HealthResult> {
    try {
      const info = await stat(join(this.raw.root, 'sessions'));
      if (!info.isDirectory()) {
        return {
          ok: false,
          error: `${this.raw.root}/sessions is no directory`,
        };
      }
      await access(this.raw.runnerd[0] ?? '', constants.X_OK);
      return { ok: true, detail: `raw (${this.raw.isolation})` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async warmImage(): Promise<void> {
    // No image: the runtime is the device's own `tale` binary.
  }

  async sweepOrphans(_opts: SweepOptions): Promise<number> {
    const sessions = this.deps.sessions?.() ?? null;
    if (sessions === null) return 0;
    try {
      return await sessions.strayProcesses();
    } catch (err) {
      console.warn('[sandbox.raw] ending stray slot processes failed:', err);
      return 0;
    }
  }
}
