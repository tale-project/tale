import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import pkg from '../../../../package.json';
import { isDevBuild } from '../../version/self-update';
import {
  deviceRuntime,
  readSandboxDeviceConfig,
  type SandboxDeviceConfig,
} from '../config';
import { realHost, type RawHost } from './host';
import { layOutRawRuntime, type RawRuntime } from './runtime';

/**
 * `tale sandbox device run` — a raw device itself, what its service runs: lay
 * out this release's runtime under the device's root and run the sandbox
 * spawner in device mode with the raw backend, in this process
 * (services/sandbox/docs/raw.md). The spawner bundle is imported, not
 * spawned: one process is the device, and its service manager signals it.
 */

/** The system's own program directories, after the harnesses' and the
 * device's: where `bash`, `jq`, `python3` and `git` are. */
export function systemPath(os: NodeJS.Platform): string[] {
  return os === 'darwin'
    ? [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ]
    : [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/local/sbin',
        '/usr/sbin',
        '/sbin',
      ];
}

/** The release this CLI is, as the hub compares it (`dev` for a build that
 * is no release). */
export function deviceVersion(version: string = pkg.version): string {
  return isDevBuild(version) ? 'dev' : version;
}

/** The spawner's environment for a raw device. */
export function rawSpawnerEnv(
  config: SandboxDeviceConfig,
  configPath: string,
  runtime: RawRuntime,
  host: Pick<RawHost, 'os' | 'execPath'>,
  version: string,
): Record<string, string> {
  const raw = config.raw;
  if (raw === undefined) throw new Error('not a raw device');
  const path = [...raw.path, ...systemPath(host.os())].filter(
    (dir, index, all) => all.indexOf(dir) === index,
  );
  return {
    SANDBOX_BACKEND: 'raw',
    SANDBOX_DEVICE_CONFIG: configPath,
    SANDBOX_TOKEN: config.localToken,
    SANDBOX_MAX_SESSIONS: String(config.maxSessions),
    // Its API answers only its tunnel (in-process); a port the kernel picks
    // never collides with the owner's programs.
    SANDBOX_PORT: '0',
    SANDBOX_SKIP_IMAGE_WARMUP: '1',
    TALE_VERSION: version,
    SANDBOX_RAW: JSON.stringify({
      root: raw.root,
      isolation: raw.isolation,
      slots: raw.slots,
      // runnerd runs as this very binary told to be Bun.
      runnerd: [host.execPath(), runtime.runnerd],
      runnerdEnv: { BUN_BE_BUN: '1' },
      bin: runtime.bin,
      path,
      claudeSettings: runtime.claudeSettings,
    }),
  };
}

export async function runRawDevice(
  configPath: string,
  host: RawHost = realHost,
): Promise<void> {
  const config = await readSandboxDeviceConfig(configPath);
  if (config === null) {
    throw new Error(
      `${configPath} holds no device; connect this machine first`,
    );
  }
  if (deviceRuntime(config) !== 'raw' || config.raw === undefined) {
    throw new Error(
      `${configPath} is a Docker device: its spawner runs in a container, not here`,
    );
  }
  if (config.raw.isolation === 'isolated' && !host.isRoot()) {
    throw new Error(
      'this isolated device runs its sessions as its slot accounts, so its service runs as root',
    );
  }
  await mkdir(join(config.raw.root, 'logs'), { recursive: true, mode: 0o700 });
  const version = deviceVersion();
  const runtime = await layOutRawRuntime(config.raw.root, version);
  const env = rawSpawnerEnv(config, configPath, runtime, host, version);
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  // The device reports nothing to an error tracker: the reporter's SDK is
  // not part of its runtime.
  delete process.env.SENTRY_DSN;
  delete process.env.BUN_BE_BUN;
  const spawner: unknown = await import(runtime.spawner);
  const run =
    spawner !== null && typeof spawner === 'object'
      ? Reflect.get(spawner, 'runSpawner')
      : undefined;
  if (typeof run !== 'function') {
    throw new Error(`${runtime.spawner} is not the sandbox spawner`);
  }
  await Promise.resolve(run());
}
