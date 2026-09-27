// A device's configuration — written once by `tale sandbox connect` (the CLI
// in tools/cli/src/lib/sandbox-device/config.ts writes this exact shape) and
// read by the device's spawner and by the `device-apply` helper that lays out
// the device's containers. It holds the device's credential, so the CLI
// writes it owner-only (0600) under the device's state directory.
//
// Everything a device runs is named here, so the CLI, the spawner and the
// updater agree on what "the device stack" is on a machine.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DeviceUpdateReport } from './messages.ts';
import {
  isRelayName,
  relayEndpoint,
  type RelayTarget,
} from './relay-policy.ts';

/** The device's spawner — the process that dials the hub. */
export const DEVICE_SANDBOX_CONTAINER = 'tale-device-sandbox';
/** The device's egress proxy (answers `sandbox-egress` to its sessions). */
export const DEVICE_EGRESS_CONTAINER = 'tale-device-egress';
/** The one-shot helper that (re)lays the stack out — also the auto-updater. */
export const DEVICE_UPDATER_CONTAINER = 'tale-device-updater';
/** Internal network the device's sessions live on (no route out). */
export const DEVICE_SANDBOX_NETWORK = 'tale-device-net';
/** Outbound network for the spawner (to the hub) and the egress proxy. */
export const DEVICE_UPLINK_NETWORK = 'tale-device-uplink';
/** SANDBOX_INSTANCE of a device's spawner: its sessions carry this label, so
 * a Tale deployment on the same Docker daemon never adopts them (and the
 * device never adopts the deployment's). */
export const DEVICE_INSTANCE = 'device';
/** Label on every container of the device stack. */
export const DEVICE_STACK_LABEL = 'tale.device-stack';

export interface DeviceConfig {
  version: 1;
  /** The Tale site as the device reaches it. */
  serverUrl: string;
  deviceId: string;
  /** The long-lived device credential (`tsd_…`); only its hash is on the server. */
  deviceSecret: string;
  organizationId: string;
  name: string;
  /** The device spawner's own SANDBOX_TOKEN — never leaves the device. */
  localToken: string;
  /** Absolute host path: config, runtime state and `sessions/`. */
  stateDir: string;
  maxSessions: number;
  /** Where release images come from, e.g. `ghcr.io/tale-project/tale`. */
  registry: string;
  /** Explicit image references (local builds); overrides registry + version. */
  images?: { sandbox?: string; runtime?: string; egress?: string };
  /** Follow the server's release automatically. */
  autoUpdate: boolean;
  /** The platform addresses the device answers for its sessions. */
  relays: RelayTarget[];
  /** The machine as the CLI saw it. */
  host: { os: string; arch: string; hostname: string };
  /** The Docker socket as the daemon sees it (rootless Docker differs);
   * default `/var/run/docker.sock`. */
  dockerSocket?: string;
}

export class DeviceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceConfigError';
  }
}

function text(raw: Record<string, unknown>, key: string, max = 2048): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new DeviceConfigError(
      `device config: "${key}" must be a non-empty string`,
    );
  }
  return value;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceConfigError(`device config: ${what} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function parseDeviceConfig(input: unknown): DeviceConfig {
  const raw = record(input, 'the file');
  if (raw.version !== 1) {
    throw new DeviceConfigError(
      `device config: unsupported version ${JSON.stringify(raw.version)} — update the tale CLI and run \`tale sandbox update\``,
    );
  }
  const serverUrl = text(raw, 'serverUrl');
  if (!/^https?:\/\//.test(serverUrl)) {
    throw new DeviceConfigError(
      'device config: "serverUrl" must be an http(s) URL',
    );
  }
  const stateDir = text(raw, 'stateDir');
  if (!stateDir.startsWith('/')) {
    throw new DeviceConfigError(
      'device config: "stateDir" must be an absolute path',
    );
  }
  const maxSessions = raw.maxSessions;
  if (
    typeof maxSessions !== 'number' ||
    !Number.isInteger(maxSessions) ||
    maxSessions < 1 ||
    maxSessions > 256
  ) {
    throw new DeviceConfigError(
      'device config: "maxSessions" must be an integer from 1 to 256',
    );
  }
  if (!Array.isArray(raw.relays)) {
    throw new DeviceConfigError('device config: "relays" must be a list');
  }
  const relays: RelayTarget[] = raw.relays.map((entry) => {
    const relay = record(entry, 'a relay');
    if (!isRelayName(relay.name) || typeof relay.url !== 'string') {
      throw new DeviceConfigError(
        'device config: a relay needs a known "name" and a "url"',
      );
    }
    relayEndpoint(relay.url);
    return { name: relay.name, url: relay.url };
  });
  const host = record(raw.host, '"host"');
  let images: DeviceConfig['images'];
  if (raw.images !== undefined) {
    const imgs = record(raw.images, '"images"');
    images = {};
    for (const key of ['sandbox', 'runtime', 'egress'] as const) {
      const value = imgs[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !/^[\w./:@-]{1,256}$/.test(value)) {
        throw new DeviceConfigError(
          `device config: images.${key} is not an image reference`,
        );
      }
      images[key] = value;
    }
  }
  const registry = text(raw, 'registry', 256);
  if (!/^[\w./:-]+$/.test(registry)) {
    throw new DeviceConfigError(
      'device config: "registry" is not a registry path',
    );
  }
  const dockerSocket = raw.dockerSocket;
  if (
    dockerSocket !== undefined &&
    (typeof dockerSocket !== 'string' || !dockerSocket.startsWith('/'))
  ) {
    throw new DeviceConfigError(
      'device config: "dockerSocket" must be an absolute path',
    );
  }
  return {
    version: 1,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    deviceId: text(raw, 'deviceId', 64),
    deviceSecret: text(raw, 'deviceSecret', 256),
    organizationId: text(raw, 'organizationId', 128),
    name: text(raw, 'name', 128),
    localToken: text(raw, 'localToken', 256),
    stateDir: stateDir.replace(/\/+$/, ''),
    maxSessions,
    registry,
    ...(images !== undefined ? { images } : {}),
    autoUpdate: raw.autoUpdate !== false,
    relays,
    host: {
      os: text(host, 'os', 32),
      arch: text(host, 'arch', 32),
      hostname: text(host, 'hostname', 255),
    },
    ...(dockerSocket !== undefined ? { dockerSocket } : {}),
  };
}

export async function loadDeviceConfig(path: string): Promise<DeviceConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new DeviceConfigError(
      `device config ${path} is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DeviceConfigError(`device config ${path} is not JSON`);
  }
  return parseDeviceConfig(parsed);
}

/** The images a device runs at a release. Explicit references win. */
export function deviceImages(
  config: DeviceConfig,
  version: string,
): { sandbox: string; runtime: string; egress: string } {
  const at = (name: string) => `${config.registry}/${name}:${version}`;
  return {
    sandbox: config.images?.sandbox ?? at('tale-sandbox'),
    runtime: config.images?.runtime ?? at('tale-sandbox-runtime'),
    egress: config.images?.egress ?? at('tale-sandbox-egress'),
  };
}

export function sessionRoot(config: DeviceConfig): string {
  return join(config.stateDir, 'sessions');
}

function updateStatusPath(stateDir: string): string {
  return join(stateDir, 'update-status.json');
}

/** The last update attempt, as the updater recorded it. */
export async function readUpdateStatus(
  stateDir: string,
): Promise<DeviceUpdateReport> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(updateStatusPath(stateDir), 'utf8'),
    );
    const state: unknown =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'state')
        : undefined;
    if (state !== 'idle' && state !== 'updating' && state !== 'failed') {
      return { state: 'idle', targetVersion: null, error: null, atMs: null };
    }
    const field = (key: string): unknown =>
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, key)
        : undefined;
    const targetVersion = field('targetVersion');
    const error = field('error');
    const atMs = field('atMs');
    return {
      state,
      targetVersion: typeof targetVersion === 'string' ? targetVersion : null,
      error: typeof error === 'string' ? error.slice(0, 500) : null,
      atMs: typeof atMs === 'number' ? atMs : null,
    };
  } catch (err) {
    // No file yet is the normal state of a device that never updated.
    const missing =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT';
    if (!missing)
      console.warn('[sandbox.devices] unreadable update status:', err);
    return { state: 'idle', targetVersion: null, error: null, atMs: null };
  }
}

export async function writeUpdateStatus(
  stateDir: string,
  report: DeviceUpdateReport,
): Promise<void> {
  const path = updateStatusPath(stateDir);
  const tmp = `${path}.${process.pid}.tmp`;
  // Readable by the machine's user (`tale sandbox status`); no secret here.
  await writeFile(tmp, JSON.stringify(report), { mode: 0o644 });
  await rename(tmp, path);
}
