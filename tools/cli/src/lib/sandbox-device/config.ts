import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
}

/** Where the device lives: `$TALE_SANDBOX_HOME`, else `~/.tale/sandbox`. */
export function sandboxDeviceHome(): string {
  const override = process.env.TALE_SANDBOX_HOME?.trim();
  return resolve(override || join(homedir(), '.tale', 'sandbox'));
}

export function sandboxDeviceConfigPath(home = sandboxDeviceHome()): string {
  return join(home, 'device.json');
}

export class SandboxDeviceConfigError extends Error {
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
  // Checked field by field above; the rest is the image's to validate.
  return parsed as unknown as SandboxDeviceConfig;
}

/** Write the config owner-only, atomically (a half-written secret file
 * would strand the device). */
export async function writeSandboxDeviceConfig(
  config: SandboxDeviceConfig,
  path = sandboxDeviceConfigPath(config.stateDir),
): Promise<void> {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  await chmod(config.stateDir, 0o700);
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
