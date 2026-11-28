import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { SlotAccount } from './raw/accounts';
import type { RawServiceKind } from './raw/service';

/**
 * A sandbox device's configuration — what `tale sandbox connect` writes and
 * the device's containers read. The shape is the contract of the sandbox
 * image's `device-apply` helper and device mode
 * (`services/sandbox/src/devices/device-config.ts` parses this exact object;
 * both suites pin the same example). It holds the device secret, so the file
 * is owner-only (0600) in an owner-only directory (0700).
 *
 * The directory is also the device's state: `sessions/` (the workspaces of
 * the sandboxes this machine runs), `state.json` (the release laid out) and
 * `update-status.json` (the last automatic update). Its path is mounted into
 * the device's containers at the same path, so it must be absolute.
 */

export interface SandboxDeviceRelay {
  name: 'api' | 'gateway';
  url: string;
}

/** How the device runs its sessions: in Docker containers, or directly on
 * this machine with no container (raw; services/sandbox/docs/raw.md). */
export type SandboxDeviceRuntime = 'docker' | 'raw';

/** A raw device's own settings. */
export interface SandboxDeviceRaw {
  /** `isolated`: each session runs as one of `slots` (the device runs as
   * root); `shared`: every session runs as the account that connected it. */
  isolation: 'isolated' | 'shared';
  /** Where the sessions, their records and the runtime live. */
  root: string;
  slots: SlotAccount[];
  /** Whether `connect` made the slot accounts (and `disconnect` removes
   * them); false when the machine's manager made them (`--slot`). */
  madeSlots: boolean;
  /** Where the harnesses are installed, before the system's PATH. */
  path: string[];
  /** The `tale` binary the device runs from. */
  binary: string;
  service: RawServiceKind;
}

export interface SandboxDeviceConfig {
  version: 1;
  /** The Tale site as the device's containers reach it. */
  serverUrl: string;
  deviceId: string;
  deviceSecret: string;
  organizationId: string;
  name: string;
  /** The device spawner's own signing secret — never leaves the machine. */
  localToken: string;
  stateDir: string;
  maxSessions: number;
  registry: string;
  images?: { sandbox?: string; runtime?: string; egress?: string };
  autoUpdate: boolean;
  relays: SandboxDeviceRelay[];
  host: { os: string; arch: string; hostname: string };
  dockerSocket?: string;
  /** The Tale site as THIS shell reaches it, when that differs from
   * `serverUrl` (a development server the containers reach through
   * `host.docker.internal`). Ignored by the device's containers. */
  cliServerUrl?: string;
  /** Absent: `docker`, as every device was before raw devices. */
  runtime?: SandboxDeviceRuntime;
  /** Present exactly when `runtime` is `raw`. */
  raw?: SandboxDeviceRaw;
}

/** The device's runtime. */
export function deviceRuntime(
  config: SandboxDeviceConfig,
): SandboxDeviceRuntime {
  return config.runtime === 'raw' ? 'raw' : 'docker';
}

/** Where an isolated raw device lives unless `--root` said otherwise: a
 * system directory, since it runs as root for every slot account. */
export function defaultIsolatedRoot(
  os: NodeJS.Platform = process.platform,
): string {
  return os === 'darwin'
    ? '/usr/local/var/tale-sandbox'
    : '/var/lib/tale-sandbox';
}

/** Where the device lives: `$TALE_SANDBOX_HOME`, else `~/.tale/sandbox` —
 * or, for root where that holds no device, an isolated raw device's system
 * directory when one is connected there. */
export function sandboxDeviceHome(): string {
  const override = process.env.TALE_SANDBOX_HOME?.trim();
  if (override) return resolve(override);
  const own = resolve(join(homedir(), '.tale', 'sandbox'));
  if (process.getuid?.() === 0 && !existsSync(join(own, 'device.json'))) {
    const system = defaultIsolatedRoot();
    if (existsSync(join(system, 'device.json'))) return system;
  }
  return own;
}

export function sandboxDeviceConfigPath(home = sandboxDeviceHome()): string {
  return join(home, 'device.json');
}

class SandboxDeviceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxDeviceConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read the device config, or null when this machine is not connected. */
export async function readSandboxDeviceConfig(
  path = sandboxDeviceConfigPath(),
): Promise<SandboxDeviceConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SandboxDeviceConfigError(`${path} is not valid JSON`);
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.deviceId !== 'string' ||
    typeof parsed.deviceSecret !== 'string' ||
    typeof parsed.stateDir !== 'string' ||
    typeof parsed.name !== 'string'
  ) {
    throw new SandboxDeviceConfigError(
      `${path} is not a sandbox device config this CLI understands`,
    );
  }
  if (parsed.runtime === 'raw' && !isRawSettings(parsed.raw)) {
    throw new SandboxDeviceConfigError(
      `${path} is a raw device's config without its raw settings`,
    );
  }
  // Checked field by field above; the rest is the image's to validate.
  return parsed as unknown as SandboxDeviceConfig;
}

function isRawSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.isolation === 'isolated' || value.isolation === 'shared') &&
    typeof value.root === 'string' &&
    value.root.startsWith('/') &&
    Array.isArray(value.slots) &&
    Array.isArray(value.path) &&
    typeof value.binary === 'string' &&
    typeof value.service === 'string'
  );
}

/** Write the config owner-only, atomically (a half-written secret file
 * would strand the device). */
export async function writeSandboxDeviceConfig(
  config: SandboxDeviceConfig,
  path = sandboxDeviceConfigPath(config.stateDir),
): Promise<void> {
  // An isolated raw device's slot accounts traverse its directory to their
  // sessions and its runtime; nobody else lists it, and the config itself
  // stays the owner's alone (0600).
  const mode = config.raw?.isolation === 'isolated' ? 0o711 : 0o700;
  await mkdir(config.stateDir, { recursive: true, mode });
  await chmod(config.stateDir, mode);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(tmp, path);
}

/** What the platform answers a join (`POST /api/sandbox-devices/join`). */
export interface SandboxDeviceJoinAnswer {
  deviceId: string;
  deviceSecret: string;
  organizationId: string;
  name: string;
  serverUrl: string;
  serverVersion: string;
  tunnelUrl: string;
  relays: SandboxDeviceRelay[];
  registry: string;
}

export interface BuildConfigOptions {
  stateDir: string;
  maxSessions: number;
  host: { os: string; arch: string; hostname: string };
  autoUpdate: boolean;
  /** The URL the machine's containers use, when not the one given. */
  deviceServerUrl?: string;
  /** The URL this shell used to join. */
  cliServerUrl: string;
  images?: SandboxDeviceConfig['images'];
  dockerSocket?: string;
}

export function buildSandboxDeviceConfig(
  joined: SandboxDeviceJoinAnswer,
  options: BuildConfigOptions,
): SandboxDeviceConfig {
  const serverUrl = (options.deviceServerUrl ?? options.cliServerUrl).replace(
    /\/+$/,
    '',
  );
  const shellUrl = options.cliServerUrl.replace(/\/+$/, '');
  return {
    version: 1,
    serverUrl,
    deviceId: joined.deviceId,
    deviceSecret: joined.deviceSecret,
    organizationId: joined.organizationId,
    name: joined.name,
    localToken: randomBytes(32).toString('hex'),
    stateDir: options.stateDir,
    maxSessions: options.maxSessions,
    registry: joined.registry,
    ...(options.images !== undefined ? { images: options.images } : {}),
    autoUpdate: options.autoUpdate,
    relays: joined.relays,
    host: options.host,
    ...(options.dockerSocket !== undefined
      ? { dockerSocket: options.dockerSocket }
      : {}),
    ...(shellUrl !== serverUrl ? { cliServerUrl: shellUrl } : {}),
  };
}

/** The Tale site this shell talks to for a configured device. */
export function cliServerUrl(config: SandboxDeviceConfig): string {
  return config.cliServerUrl ?? config.serverUrl;
}

/** A published release (`0.5.60`) — what a device can pull and follow. */
export function isReleaseVersion(version: string | undefined): boolean {
  return (
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  );
}

/**
 * How many sandboxes a machine offers by default: one per two CPUs and per
 * 4 GiB of memory Docker can use (the agent profile's defaults), at least one
 * and at most 16. `--max-sessions` overrides it.
 */
export function defaultMaxSessions(
  cpus: number | null,
  memoryBytes: number | null,
): number {
  const byCpu = cpus === null ? 1 : Math.floor(cpus / 2);
  const byMemory =
    memoryBytes === null ? 1 : Math.floor(memoryBytes / 1024 ** 3 / 4);
  return Math.max(1, Math.min(byCpu, byMemory, 16));
}
