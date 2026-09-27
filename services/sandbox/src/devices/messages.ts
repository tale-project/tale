// The tunnel's connection-level messages (stream 0): what a device announces
// when it connects (HELLO) and every few seconds after (STATUS), and what the
// hub answers (WELCOME). Parsed field by field — the hub trusts a device with
// its own organization's work, never with the shape of its own memory.

import type { RuntimeState } from '../capacity.ts';
import { ID_ALPHABET_RE } from '../wire.ts';

export interface DevicePlatform {
  /** The device's operating system as the CLI saw it (`linux`, `darwin`). */
  os: string;
  arch: string;
  /** Docker's view of the machine: what sessions actually get. */
  cpus: number | null;
  memoryBytes: number | null;
  dockerVersion: string | null;
}

export interface DeviceSessionReport {
  sessionId: string;
  state: RuntimeState;
}

export interface DeviceUpdateReport {
  state: 'idle' | 'updating' | 'failed';
  targetVersion: string | null;
  error: string | null;
  atMs: number | null;
}

export interface DeviceResources {
  cpu: { totalCores: number | null; usedCores: number | null };
  memory: { totalBytes: number | null; usedBytes: number | null };
}

export interface DeviceHello {
  protocol: number;
  version: string;
  maxSessions: number;
  platform: DevicePlatform;
  sessions: DeviceSessionReport[];
  update: DeviceUpdateReport;
}

export interface DeviceStatus {
  maxSessions: number;
  running: number;
  starting: number;
  sessions: DeviceSessionReport[];
  resources: DeviceResources;
  update: DeviceUpdateReport;
}

export interface HubWelcome {
  protocol: number;
  hubVersion: string;
  deviceId: string;
  organizationId: string;
  /** How often the hub expects a STATUS; silence past 3× closes the tunnel. */
  statusIntervalMs: number;
}

const IDLE_UPDATE: DeviceUpdateReport = {
  state: 'idle',
  targetVersion: null,
  error: null,
  atMs: null,
};

const MAX_REPORTED_SESSIONS = 512;
/** The most sandboxes a device may offer — the device config's own bound,
 * enforced again here because the number raises its organization's quota
 * ceiling. */
const MAX_DEVICE_SESSIONS = 256;

function str(value: unknown, max = 128): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function measure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? Reflect.get(value, key)
    : undefined;
}

function parseSessions(value: unknown): DeviceSessionReport[] | null {
  if (!Array.isArray(value) || value.length > MAX_REPORTED_SESSIONS) {
    return null;
  }
  const out: DeviceSessionReport[] = [];
  for (const entry of value) {
    const sessionId = field(entry, 'sessionId');
    const state = field(entry, 'state');
    if (
      typeof sessionId !== 'string' ||
      !ID_ALPHABET_RE.test(sessionId) ||
      (state !== 'running' && state !== 'starting' && state !== 'stopped')
    ) {
      return null;
    }
    out.push({ sessionId, state });
  }
  return out;
}

function parseUpdate(value: unknown): DeviceUpdateReport {
  const state = field(value, 'state');
  if (state !== 'idle' && state !== 'updating' && state !== 'failed') {
    return IDLE_UPDATE;
  }
  return {
    state,
    targetVersion: str(field(value, 'targetVersion')),
    error: str(field(value, 'error'), 500),
    atMs: measure(field(value, 'atMs')),
  };
}

function parseResources(value: unknown): DeviceResources {
  const cpu = field(value, 'cpu');
  const memory = field(value, 'memory');
  return {
    cpu: {
      totalCores: measure(field(cpu, 'totalCores')),
      usedCores: measure(field(cpu, 'usedCores')),
    },
    memory: {
      totalBytes: measure(field(memory, 'totalBytes')),
      usedBytes: measure(field(memory, 'usedBytes')),
    },
  };
}

export function parseHello(value: Record<string, unknown>): DeviceHello | null {
  const protocol = count(value.protocol);
  const version = str(value.version);
  const maxSessions = count(value.maxSessions);
  const sessions = parseSessions(value.sessions);
  const platform = value.platform;
  const os = str(field(platform, 'os'), 32);
  const arch = str(field(platform, 'arch'), 32);
  if (
    protocol === null ||
    version === null ||
    maxSessions === null ||
    maxSessions < 1 ||
    maxSessions > MAX_DEVICE_SESSIONS ||
    sessions === null ||
    os === null ||
    arch === null
  ) {
    return null;
  }
  return {
    protocol,
    version,
    maxSessions,
    sessions,
    platform: {
      os,
      arch,
      cpus: measure(field(platform, 'cpus')),
      memoryBytes: measure(field(platform, 'memoryBytes')),
      dockerVersion: str(field(platform, 'dockerVersion'), 64),
    },
    update: parseUpdate(value.update),
  };
}

export function parseStatus(
  value: Record<string, unknown>,
): DeviceStatus | null {
  const maxSessions = count(value.maxSessions);
  const running = count(value.running);
  const starting = count(value.starting);
  const sessions = parseSessions(value.sessions);
  if (
    maxSessions === null ||
    maxSessions < 1 ||
    maxSessions > MAX_DEVICE_SESSIONS ||
    running === null ||
    starting === null ||
    sessions === null
  ) {
    return null;
  }
  return {
    maxSessions,
    running,
    starting,
    sessions,
    resources: parseResources(value.resources),
    update: parseUpdate(value.update),
  };
}

export function parseWelcome(
  value: Record<string, unknown>,
): HubWelcome | null {
  const protocol = count(value.protocol);
  const hubVersion = str(value.hubVersion);
  const deviceId = str(value.deviceId);
  const organizationId = str(value.organizationId);
  const statusIntervalMs = count(value.statusIntervalMs);
  if (
    protocol === null ||
    hubVersion === null ||
    deviceId === null ||
    organizationId === null ||
    statusIntervalMs === null
  ) {
    return null;
  }
  return { protocol, hubVersion, deviceId, organizationId, statusIntervalMs };
}

/** A published release (`0.5.60`, `1.2.0-rc.1`) — the only versions a device
 * can pull and follow. `dev`, `latest` and empty are local builds. */
export function isReleaseVersion(version: string | null | undefined): boolean {
  return (
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  );
}

/** Whether a device may take new sessions from this hub: release builds must
 * match exactly (the wire between platform and spawner moves with every
 * release); a local build on either side is a development setup and is
 * trusted to match. */
export function versionsCompatible(hub: string, device: string): boolean {
  return !(isReleaseVersion(hub) && isReleaseVersion(device) && hub !== device);
}
