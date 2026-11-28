// The harnesses a raw device can run, as it finds them on the PATH its
// sessions get (RawConfig.bin and .path): the platform places a run on a raw
// device only when the device reported its harness (devices/hub.ts), since
// unlike a Docker device's runtime image a host carries what its owner
// installed. A harness counts when its program and what its Tale wrapper
// needs are found; its version is what the program prints.

import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';

import type { DeviceHarness, DevicePlatform } from '../../devices/messages.ts';
import type { RawConfig } from './raw-config.ts';
import { hostProcesses, type RawProcesses } from './raw-processes.ts';

interface HarnessProbe {
  /** The platform's harness slug (configs/platform/system/harnesses). */
  id: string;
  /** The program the harness is. */
  program: string;
  /** What its Tale wrapper or hooks need beside it. */
  needs: readonly string[];
}

/** Every harness of the platform's registry, with what it needs on a host.
 * The Tale wrappers (`tale-pi-run`, …) and Claude Code's hooks ship with the
 * device's runtime (RawConfig.bin); the programs are the host's. */
export const HARNESS_PROBES: readonly HarnessProbe[] = [
  { id: 'claude-code', program: 'claude', needs: ['bash', 'jq'] },
  { id: 'codex', program: 'codex', needs: [] },
  { id: 'gemini', program: 'gemini', needs: ['python3'] },
  { id: 'pi', program: 'pi', needs: ['python3'] },
  { id: 'qwen-code', program: 'qwen', needs: ['python3'] },
  { id: 'opencode', program: 'opencode', needs: [] },
  { id: 'hermes', program: 'hermes', needs: ['python3'] },
  { id: 'openclaw', program: 'openclaw', needs: ['python3'] },
  // The platform runs Cursor's agent as `agent`, a name too common to trust
  // alone: its installer puts `cursor-agent` beside it.
  { id: 'cursor', program: 'cursor-agent', needs: ['agent'] },
];

/** A version as a program prints it: the first dotted number. */
export function readVersion(output: string): string | null {
  const match = /\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?/.exec(output);
  return match === null ? null : match[0].slice(0, 64);
}

async function findProgram(
  program: string,
  dirs: readonly string[],
): Promise<string | null> {
  for (const dir of dirs) {
    const path = join(dir, program);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/** The PATH a raw session gets, in order. */
export function sessionPath(raw: RawConfig): string[] {
  return [raw.bin, ...raw.path];
}

/** The harnesses this host runs now. A program that is found but does not
 * answer `--version` still counts, without a version. */
export async function detectHarnesses(
  dirs: readonly string[],
  processes: RawProcesses = hostProcesses,
): Promise<DeviceHarness[]> {
  const out: DeviceHarness[] = [];
  for (const probe of HARNESS_PROBES) {
    const program = await findProgram(probe.program, dirs);
    if (program === null) continue;
    let missing = false;
    for (const need of probe.needs) {
      if ((await findProgram(need, dirs)) === null) {
        missing = true;
        break;
      }
    }
    if (missing) continue;
    let version: string | null = null;
    try {
      const result = await processes.run([program, '--version'], {
        timeoutMs: 15_000,
      });
      if (result.code === 0) version = readVersion(result.stdout);
    } catch (err) {
      console.warn(`[sandbox.raw] ${program} --version failed:`, err);
    }
    out.push({ id: probe.id, version });
  }
  return out;
}

/** What a raw device reports of its host in its HELLO. */
export async function rawDevicePlatform(
  raw: RawConfig,
  host: { os: string; arch: string },
  processes: RawProcesses = hostProcesses,
): Promise<DevicePlatform> {
  const cores = cpus().length;
  const memory = totalmem();
  return {
    os: host.os,
    arch: host.arch,
    cpus: cores > 0 ? cores : null,
    memoryBytes: memory > 0 ? memory : null,
    dockerVersion: null,
    runtime: 'raw',
    isolation: raw.isolation,
    harnesses: await detectHarnesses(sessionPath(raw), processes),
  };
}

/** How long a raw device trusts what it found: a harness installed while
 * it runs is reported within this. */
export const HARNESS_RECHECK_MS = 10 * 60_000;

/** The harness list, found again at most every {@link HARNESS_RECHECK_MS}. */
export class HarnessInventory {
  private found: { atMs: number; harnesses: DeviceHarness[] } | null = null;
  private inFlight: Promise<DeviceHarness[]> | null = null;

  constructor(
    private readonly dirs: readonly string[],
    private readonly processes: RawProcesses = hostProcesses,
    private readonly now: () => number = Date.now,
  ) {}

  /** The last list, finding it again in the background once stale. */
  current(): DeviceHarness[] | undefined {
    const found = this.found;
    if (found === null || this.now() - found.atMs >= HARNESS_RECHECK_MS) {
      void this.refresh().catch((err: unknown) => {
        console.warn('[sandbox.raw] finding the harnesses failed:', err);
      });
    }
    return found?.harnesses;
  }

  refresh(): Promise<DeviceHarness[]> {
    this.inFlight ??= detectHarnesses(this.dirs, this.processes)
      .then((harnesses) => {
        this.found = { atMs: this.now(), harnesses };
        return harnesses;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
