import { z } from 'zod';

/**
 * Sandbox devices — machines an organization connected with
 * `tale sandbox connect` to run its sandboxes on its own hardware. The shapes
 * the settings list, its `/api/app/sandbox-devices` routes and the machine
 * door `/api/sandbox-devices` (the CLI and the device's spawner) share.
 */

/** A join token works once, and not for long: the command it rides in ends up
 * in shell histories. */
export const SANDBOX_DEVICE_JOIN_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Connected devices per organization — a fleet, not a registry. */
export const SANDBOX_DEVICES_PER_ORG_MAX = 50;
/** Unspent, unexpired join tokens per organization. */
export const SANDBOX_DEVICE_JOIN_TOKENS_LIVE_MAX = 20;
const SANDBOX_DEVICE_NAME_MAX = 64;
/** A device mints a new connect ticket this often; the hub closes a tunnel
 * whose ticket lapsed. */
export const SANDBOX_DEVICE_TICKET_TTL_MS = 15 * 60 * 1000;

const measure = z.number().nonnegative().nullable();

/** What a device reports about the machine it runs on. */
export const sandboxDevicePlatformSchema = z.object({
  os: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  cpus: measure.optional(),
  memoryBytes: measure.optional(),
  dockerVersion: z.string().max(64).nullable().optional(),
});
export type SandboxDevicePlatform = z.infer<typeof sandboxDevicePlatformSchema>;

/** `POST /api/sandbox-devices/join` — the CLI trades a join token for the
 * device's own credential. */
export const sandboxDeviceJoinSchema = z.object({
  token: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(SANDBOX_DEVICE_NAME_MAX),
  maxSessions: z.number().int().min(1).max(256),
  platform: sandboxDevicePlatformSchema,
});
export type SandboxDeviceJoinInput = z.infer<typeof sandboxDeviceJoinSchema>;

/** `POST /api/sandbox-devices/ticket` — the device's spawner, every few
 * minutes, reporting what it runs. */
export const sandboxDeviceTicketRequestSchema = z.object({
  version: z.string().min(1).max(64),
  maxSessions: z.number().int().min(1).max(256).optional(),
  platform: sandboxDevicePlatformSchema.optional(),
});
export type SandboxDeviceTicketRequest = z.infer<
  typeof sandboxDeviceTicketRequestSchema
>;

/** A platform address a device answers for its sessions (see the spawner's
 * devices/relay-policy.ts). */
export interface SandboxDeviceRelay {
  name: 'api' | 'gateway';
  url: string;
}

/** The join answer — the device secret is in THIS answer and nowhere else. */
export interface SandboxDeviceJoined {
  deviceId: string;
  deviceSecret: string;
  organizationId: string;
  name: string;
  serverUrl: string;
  /** The release the device must run (`dev` for a local build). */
  serverVersion: string;
  tunnelUrl: string;
  relays: SandboxDeviceRelay[];
  /** Where release images come from. */
  registry: string;
}

/** A device's check-in answer: what it needs to dial the hub and which
 * release to follow. (The relay addresses come with the join, and again when
 * `tale sandbox update` asks `GET /self`.) */
export interface SandboxDeviceTicketGrant {
  ticket: string;
  expiresAt: number;
  tunnelUrl: string;
  serverVersion: string;
}

/** `POST /api/app/sandbox-devices/join-tokens` — the settings page builds
 * the one-line command from it. */
export interface SandboxDeviceJoinToken {
  token: string;
  expiresAt: number;
  /** The Tale site the device must reach (the deployment's SITE_URL). */
  serverUrl: string;
}

/**
 * - `online`        connected, same release, taking sandboxes
 * - `updating`      connected, moving to the server's release by itself
 * - `outdated`      connected on another release, not updating (auto-update
 *                   off) — takes no new sandboxes until updated
 * - `update_failed` its last automatic update failed
 * - `offline`       not connected
 */
export type SandboxDeviceStatus =
  | 'online'
  | 'updating'
  | 'outdated'
  | 'update_failed'
  | 'offline';

export interface SandboxDeviceView {
  id: string;
  name: string;
  status: SandboxDeviceStatus;
  createdAt: number;
  createdBy: string;
  lastSeenAt: number | null;
  /** When the current connection opened (online only). */
  connectedAt: number | null;
  version: string | null;
  maxSessions: number | null;
  platform: SandboxDevicePlatform | null;
  /** Live counts (online only). */
  sessions: { running: number; starting: number } | null;
  resources: {
    cpu: { totalCores: number | null; usedCores: number | null };
    memory: { totalBytes: number | null; usedBytes: number | null };
  } | null;
  update: {
    state: 'idle' | 'updating' | 'failed';
    targetVersion: string | null;
    error: string | null;
    atMs: number | null;
  } | null;
}

/** `GET /api/app/sandbox-devices` */
export interface SandboxDevicesView {
  devices: SandboxDeviceView[];
  /** Can devices connect at all? `not_configured`: the deployment's spawner
   * runs without its device hub; `unavailable`: the spawner did not answer. */
  hub: 'available' | 'unavailable' | 'not_configured';
  serverVersion: string;
}

const count = z.number().int().nonnegative();

/** The hub's `GET /v1/devices` answer, validated at the spawner boundary. */
export const hubDevicesSchema = z.object({
  hub: z.boolean(),
  devices: z.array(
    z.object({
      deviceId: z.string().min(1).max(64),
      connectedAtMs: count,
      version: z.string().max(64).nullable(),
      compatible: z.boolean(),
      maxSessions: count.nullable(),
      sessions: z.object({ running: count, starting: count }),
      resources: z
        .object({
          cpu: z.object({ totalCores: measure, usedCores: measure }),
          memory: z.object({ totalBytes: measure, usedBytes: measure }),
        })
        .nullable(),
      platform: sandboxDevicePlatformSchema.nullable(),
      update: z.object({
        state: z.enum(['idle', 'updating', 'failed']),
        targetVersion: z.string().max(128).nullable(),
        error: z.string().max(500).nullable(),
        atMs: measure,
      }),
    }),
  ),
});
export type HubDevices = z.infer<typeof hubDevicesSchema>;
