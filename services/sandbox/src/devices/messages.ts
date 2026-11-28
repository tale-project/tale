// The tunnel's connection-level messages (stream 0): what a device announces
// when it connects (HELLO) and every few seconds after (STATUS), and what the
// hub answers (WELCOME). Parsed field by field — the hub trusts a device with
// its own organization's work, never with the shape of its own memory.

import type { RuntimeState } from '../capacity.ts';
import { ID_ALPHABET_RE } from '../wire.ts';

/** How a device runs its sessions: in Docker containers, or as plain
 * processes on its own host (raw, docs/raw.md). */
export type DeviceRuntime = 'docker' | 'raw';

/** How a raw device keeps its sessions apart: each as an account of its own
 * (`isolated`), or all as the device's one account (`shared`). */
export type DeviceIsolation = 'isolated' | 'shared';

/** A harness a raw device found it can run, and its version as the harness
 * printed it (null when it printed none that reads as one). */
export interface DeviceHarness {
  id: string;
  version: string | null;
}

export interface DevicePlatform {
  /** The device's operating system as the CLI saw it (`linux`, `darwin`). */
  os: string;
  arch: string;
  /** Docker's view of the machine: what sessions actually get. */
  cpus: number | null;
  memoryBytes: number | null;
  dockerVersion: string | null;
  /** `docker` from a device older than raw devices. */
  runtime: DeviceRuntime;
  /** A raw device's isolation; null on Docker. */
  isolation: DeviceIsolation | null;
  /** The harnesses a raw device runs; null on Docker, whose runtime image
   * carries every harness of its release. */
  harnesses: DeviceHarness[] | null;
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

/** A sign-in the device holds (logins.ts): the harness, and since when. */
export interface DeviceLogin {
  harness: string;
  addedAtMs: number;
}

export interface DeviceHello {
  protocol: number;
  version: string;
  maxSessions: number;
  platform: DevicePlatform;
  sessions: DeviceSessionReport[];
  update: DeviceUpdateReport;
  /** The device's own sign-ins; none from a device older than them. */
  logins: DeviceLogin[];
}

export interface DeviceStatus {
  maxSessions: number;
  running: number;
  starting: number;
  sessions: DeviceSessionReport[];
  resources: DeviceResources;
  update: DeviceUpdateReport;
  /** A raw device's harnesses when they changed since its HELLO (one was
   * installed or removed while it ran); absent otherwise. */
  harnesses?: DeviceHarness[];
  /** The device's sign-ins when they changed since it last reported them. */
  logins?: DeviceLogin[];
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

/** A sign-in list; an unreadable one reads as none. */
function parseLogins(value: unknown): DeviceLogin[] {
  if (!Array.isArray(value) || value.length > MAX_HARNESSES) return [];
  const out: DeviceLogin[] = [];
  for (const entry of value) {
    const harness = field(entry, 'harness');
    const addedAtMs = measure(field(entry, 'addedAtMs'));
    if (
      typeof harness !== 'string' ||
      !HARNESS_ID.test(harness) ||
      addedAtMs === null
    ) {
      return [];
    }
    out.push({ harness, addedAtMs });
  }
  return out;
}

/** The most harnesses a device may report: there are a handful. */
const MAX_HARNESSES = 32;
const HARNESS_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A harness list, or null when there is none or it is malformed (a raw
 * device whose list is unreadable runs nothing that needs one). */
function parseHarnesses(value: unknown): DeviceHarness[] | null {
  if (!Array.isArray(value) || value.length > MAX_HARNESSES) return null;
  const out: DeviceHarness[] = [];
  for (const entry of value) {
    const id = field(entry, 'id');
    if (typeof id !== 'string' || !HARNESS_ID.test(id)) return null;
    out.push({ id, version: str(field(entry, 'version'), 64) });
  }
  return out;
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

function parsePlatform(
  platform: unknown,
  os: string,
  arch: string,
): DevicePlatform {
  const runtime: DeviceRuntime =
    field(platform, 'runtime') === 'raw' ? 'raw' : 'docker';
  const isolation = field(platform, 'isolation');
  return {
    os,
    arch,
    cpus: measure(field(platform, 'cpus')),
    memoryBytes: measure(field(platform, 'memoryBytes')),
    dockerVersion: str(field(platform, 'dockerVersion'), 64),
    runtime,
    isolation:
      runtime === 'raw' && (isolation === 'isolated' || isolation === 'shared')
        ? isolation
        : null,
    // A raw device that names no readable list runs no harness at all, never
    // "every harness" as a Docker device does.
    harnesses:
      runtime === 'raw'
        ? (parseHarnesses(field(platform, 'harnesses')) ?? [])
        : null,
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
    platform: parsePlatform(platform, os, arch),
    update: parseUpdate(value.update),
    logins: parseLogins(value.logins),
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
    ...(value.harnesses === undefined
      ? {}
      : { harnesses: parseHarnesses(value.harnesses) ?? [] }),
    ...(value.logins === undefined
      ? {}
      : { logins: parseLogins(value.logins) }),
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
