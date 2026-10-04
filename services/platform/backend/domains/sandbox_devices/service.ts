import type { Sql, TransactionSql } from 'postgres';

import {
  SANDBOX_DEVICE_JOIN_TOKEN_TTL_MS,
  SANDBOX_DEVICE_JOIN_TOKENS_LIVE_MAX,
  SANDBOX_DEVICE_TICKET_TTL_MS,
  SANDBOX_DEVICES_PER_ORG_MAX,
  sandboxDevicePlatformSchema,
  type HubDevices,
  type SandboxDeviceJoined,
  type SandboxDeviceJoinInput,
  type SandboxDeviceJoinToken,
  type SandboxDeviceJoinTokenStatus,
  type SandboxDevicePlatform,
  type SandboxDeviceRelay,
  type SandboxDevicesView,
  type SandboxDeviceStatus,
  type SandboxDeviceTicketGrant,
  type SandboxDeviceTicketRequest,
  type SandboxDeviceView,
} from '../../../lib/shared/schemas/sandbox-devices.ts';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  opaqueTokenPrefix,
} from '../../core/lib/opaque_token.ts';
import {
  sandboxDeviceDisconnect,
  sandboxDevices,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  deviceImageRegistry,
  deviceRelays,
  deviceServerUrl,
  deviceServerVersion,
  deviceTunnelUrl,
} from './settings.ts';
import { mintDeviceTicket } from './ticket.ts';

/**
 * Sandbox devices — machines an organization connected to run its sandboxes.
 *
 * The flow, credentials first:
 *   1. An admin opens "Add device": `createJoinToken` answers a one-hour,
 *      single-use join token the settings page embeds in a one-line command.
 *   2. The command (`tale sandbox connect <site> --token …`) trades it at the
 *      machine door for the device's OWN secret (`joinDevice`). Both are
 *      answered once and stored as SHA-256 hashes.
 *   3. The device's spawner presents that secret every few minutes for a
 *      15-minute connect ticket (`grantTicket`) signed with SANDBOX_TOKEN,
 *      which the deployment's spawner (the device hub) verifies when the
 *      device dials in. Each grant also stamps what the device reported.
 *   4. Removing a device (`removeDevice`, or the machine itself through
 *      `leaveDevice`) stamps the row and tells the hub to cut the tunnel —
 *      and a stamped secret never gets another ticket, so the device is out
 *      within one ticket lifetime even if the hub call is lost.
 *
 * The organization is always resolved FROM a credential, never from a
 * header, a body or a path.
 */

export const SANDBOX_DEVICE_JOIN_MARKER = 'tsdj_';
export const SANDBOX_DEVICE_SECRET_MARKER = 'tsd_';
/** The audit actor for what a device does with its own credential. */
const DEVICE_ACTOR = 'sandbox-device';
/** `last_seen_at_ms` moves at most this often (tickets are minted every few
 * minutes; the column is a "seen lately" signal, not a heartbeat log). */
const LAST_SEEN_THROTTLE_MS = 60_000;

export type SandboxDeviceErrorCode =
  | 'JOIN_TOKEN_INVALID'
  | 'JOIN_TOKEN_NOT_FOUND'
  | 'JOIN_TOKEN_LIMIT'
  | 'DEVICE_LIMIT'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_REVOKED'
  | 'DEVICE_CREDENTIAL_MISSING'
  | 'SANDBOX_NOT_CONFIGURED';

export class SandboxDeviceError extends Error {
  constructor(
    readonly code: SandboxDeviceErrorCode,
    message: string,
    readonly status: 401 | 404 | 409 | 503,
  ) {
    super(message);
    this.name = 'SandboxDeviceError';
  }
}

export interface SandboxDeviceActor {
  userId: string;
  email?: string;
}

interface DeviceRow {
  id: string;
  orgId: string;
  name: string;
  platform: unknown;
  version: string | null;
  maxSessions: number | null;
  createdBy: string;
  createdAt: number;
  lastSeenAt: number | null;
}

function requireSandboxToken(): string {
  const token = process.env.SANDBOX_TOKEN?.trim();
  if (!token) {
    throw new SandboxDeviceError(
      'SANDBOX_NOT_CONFIGURED',
      'This deployment runs without a sandbox service, so devices cannot connect',
      503,
    );
  }
  return token;
}

function orgLock(tx: TransactionSql, organizationId: string, what: string) {
  return tx`SELECT pg_advisory_xact_lock(hashtextextended(${`sandbox-devices:${what}:${organizationId}`}, 0))`;
}

function parsePlatform(value: unknown): SandboxDevicePlatform | null {
  const parsed = sandboxDevicePlatformSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Mint the join token an "Add device" command carries. */
export async function createJoinToken(
  sql: Sql,
  args: { organizationId: string; actor: SandboxDeviceActor },
): Promise<SandboxDeviceJoinToken> {
  requireSandboxToken();
  const token = generateOpaqueToken(SANDBOX_DEVICE_JOIN_MARKER);
  const tokenHash = await hashOpaqueToken(token);
  const now = Date.now();
  const expiresAt = now + SANDBOX_DEVICE_JOIN_TOKEN_TTL_MS;
  const id = await sql.begin(async (tx) => {
    await orgLock(tx, args.organizationId, 'join-tokens');
    // Spent and long-expired tokens have no use left; drop them here so the
    // table stays the size of what is live.
    await tx`
      DELETE FROM app.sandbox_device_join_tokens
      WHERE org_id = ${args.organizationId}
        AND expires_at_ms < ${now - 7 * 24 * 60 * 60 * 1000}
    `;
    const live = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.sandbox_device_join_tokens
      WHERE org_id = ${args.organizationId}
        AND used_at_ms IS NULL AND expires_at_ms > ${now}
    `;
    if (Number(live[0]?.count ?? '0') >= SANDBOX_DEVICE_JOIN_TOKENS_LIVE_MAX) {
      throw new SandboxDeviceError(
        'JOIN_TOKEN_LIMIT',
        `An organization holds at most ${SANDBOX_DEVICE_JOIN_TOKENS_LIVE_MAX} unused device commands at once; wait for one to expire`,
        409,
      );
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.sandbox_device_join_tokens (
        org_id, token_hash, created_by, created_at_ms, expires_at_ms
      ) VALUES (
        ${args.organizationId}, ${tokenHash}, ${args.actor.userId}, ${now},
        ${expiresAt}
      )
      RETURNING id
    `;
    const tokenId = inserted[0]?.id;
    if (tokenId === undefined)
      throw new Error('sandbox join token insert failed');
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'sandbox_device_join_token_created',
      category: 'security',
      resourceType: 'sandbox_device_join_token',
      newState: { expiresAt },
      status: 'success',
    });
    return tokenId;
  });
  return { id, token, expiresAt, serverUrl: deviceServerUrl() };
}

export async function getJoinTokenStatus(
  sql: Sql,
  args: { organizationId: string; tokenId: string; actor: SandboxDeviceActor },
): Promise<SandboxDeviceJoinTokenStatus> {
  const rows = await sql<SandboxDeviceJoinTokenStatus[]>`
    SELECT device_id AS "deviceId"
    FROM app.sandbox_device_join_tokens
    WHERE id = ${args.tokenId}
      AND org_id = ${args.organizationId}
      AND created_by = ${args.actor.userId}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new SandboxDeviceError(
      'JOIN_TOKEN_NOT_FOUND',
      'Device command not found',
      404,
    );
  }
  return row;
}

/** The machine door's join: spend the token, enrol the device, answer its
 * secret — the one time it exists outside the machine. */
export async function joinDevice(
  sql: Sql,
  input: SandboxDeviceJoinInput,
): Promise<SandboxDeviceJoined> {
  requireSandboxToken();
  const tokenHash = await hashOpaqueToken(input.token.trim());
  const secret = generateOpaqueToken(SANDBOX_DEVICE_SECRET_MARKER);
  const secretHash = await hashOpaqueToken(secret);
  const secretPrefix = opaqueTokenPrefix(secret, SANDBOX_DEVICE_SECRET_MARKER);
  const name = input.name.trim();
  const joined = await sql.begin(async (tx) => {
    const now = Date.now();
    const tokens = await tx<{ id: string; orgId: string; createdBy: string }[]>`
      SELECT id, org_id AS "orgId", created_by AS "createdBy"
      FROM app.sandbox_device_join_tokens
      WHERE token_hash = ${tokenHash}
        AND used_at_ms IS NULL AND expires_at_ms > ${now}
      FOR UPDATE
    `;
    const token = tokens[0];
    if (token === undefined) {
      throw new SandboxDeviceError(
        'JOIN_TOKEN_INVALID',
        'This connect command has expired or was already used — copy a new one from Settings → Sandboxes',
        401,
      );
    }
    await orgLock(tx, token.orgId, 'devices');
    const live = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.sandbox_devices
      WHERE org_id = ${token.orgId} AND revoked_at_ms IS NULL
    `;
    if (Number(live[0]?.count ?? '0') >= SANDBOX_DEVICES_PER_ORG_MAX) {
      throw new SandboxDeviceError(
        'DEVICE_LIMIT',
        `An organization connects at most ${SANDBOX_DEVICES_PER_ORG_MAX} devices; remove one first`,
        409,
      );
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.sandbox_devices (
        org_id, name, secret_hash, secret_prefix, platform, max_sessions,
        created_by, created_at_ms, last_seen_at_ms
      ) VALUES (
        ${token.orgId}, ${name}, ${secretHash}, ${secretPrefix},
        ${tx.json(JSON.parse(JSON.stringify(input.platform)))},
        ${input.maxSessions}, ${token.createdBy}, ${now}, ${now}
      )
      RETURNING id
    `;
    const deviceId = inserted[0]?.id;
    if (deviceId === undefined) throw new Error('sandbox device insert failed');
    await tx`
      UPDATE app.sandbox_device_join_tokens
      SET used_at_ms = ${now}, device_id = ${deviceId}
      WHERE id = ${token.id}
    `;
    await createAuditLog(tx, {
      organizationId: token.orgId,
      actorId: DEVICE_ACTOR,
      actorType: 'system',
      action: 'sandbox_device_connected',
      category: 'security',
      resourceType: 'sandbox_device',
      resourceId: deviceId,
      resourceName: name,
      newState: {
        name,
        secretPrefix,
        os: input.platform.os,
        arch: input.platform.arch,
        maxSessions: input.maxSessions,
      },
      metadata: { enrolledBy: token.createdBy },
      status: 'success',
    });
    return { deviceId, organizationId: token.orgId };
  });
  return {
    deviceId: joined.deviceId,
    deviceSecret: secret,
    organizationId: joined.organizationId,
    name,
    serverUrl: deviceServerUrl(),
    serverVersion: deviceServerVersion(),
    tunnelUrl: deviceTunnelUrl(),
    relays: deviceRelays(),
    registry: deviceImageRegistry(),
  };
}

/** The live device a presented secret belongs to, or null. */
async function resolveDevice(
  sql: Sql,
  presentedSecret: string,
): Promise<DeviceRow | null> {
  const secret = presentedSecret.trim();
  if (!secret.startsWith(SANDBOX_DEVICE_SECRET_MARKER)) return null;
  const secretHash = await hashOpaqueToken(secret);
  const rows = await sql<DeviceRow[]>`
    SELECT id, org_id AS "orgId", name, platform, version,
           max_sessions AS "maxSessions", created_by AS "createdBy",
           created_at_ms::float8 AS "createdAt",
           last_seen_at_ms::float8 AS "lastSeenAt"
    FROM app.sandbox_devices
    WHERE secret_hash = ${secretHash} AND revoked_at_ms IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function revoked(): SandboxDeviceError {
  return new SandboxDeviceError(
    'DEVICE_REVOKED',
    'This device is not connected to any organization (it was removed); run `tale sandbox disconnect`, then connect it again',
    401,
  );
}

/** A device's periodic check-in: record what it reported, answer a ticket. */
export async function grantTicket(
  sql: Sql,
  presentedSecret: string,
  report: SandboxDeviceTicketRequest,
): Promise<SandboxDeviceTicketGrant> {
  const sandboxToken = requireSandboxToken();
  const device = await resolveDevice(sql, presentedSecret);
  if (device === null) throw revoked();
  const now = Date.now();
  if (
    device.lastSeenAt === null ||
    now - device.lastSeenAt >= LAST_SEEN_THROTTLE_MS ||
    device.version !== report.version ||
    (report.maxSessions !== undefined &&
      device.maxSessions !== report.maxSessions)
  ) {
    await sql`
      UPDATE app.sandbox_devices SET
        last_seen_at_ms = ${now},
        version = ${report.version},
        max_sessions = ${report.maxSessions ?? device.maxSessions},
        platform = ${
          report.platform === undefined
            ? sql`platform`
            : sql.json(JSON.parse(JSON.stringify(report.platform)))
        }
      WHERE id = ${device.id} AND revoked_at_ms IS NULL
    `;
  }
  const expiresAt = now + SANDBOX_DEVICE_TICKET_TTL_MS;
  return {
    ticket: mintDeviceTicket(
      {
        deviceId: device.id,
        organizationId: device.orgId,
        issuedAtMs: now,
        expiresAtMs: expiresAt,
      },
      sandboxToken,
    ),
    expiresAt,
    tunnelUrl: deviceTunnelUrl(),
    serverVersion: deviceServerVersion(),
  };
}

/** What `tale sandbox status` shows about the device's side of the link. */
export async function describeDevice(
  sql: Sql,
  presentedSecret: string,
): Promise<{
  deviceId: string;
  name: string;
  organizationId: string;
  organizationName: string | null;
  connected: boolean;
  lastSeenAt: number | null;
  serverVersion: string;
  /** The addresses its sessions call now — `tale sandbox update` applies a
   * change the operator made after the device joined. */
  relays: SandboxDeviceRelay[];
}> {
  const device = await resolveDevice(sql, presentedSecret);
  if (device === null) throw revoked();
  const orgs = await sql<{ name: string | null }[]>`
    SELECT "name" FROM "organization" WHERE "id" = ${device.orgId} LIMIT 1
  `;
  let connected = false;
  try {
    const live = await sandboxDevices(device.orgId);
    connected = live.devices.some((d) => d.deviceId === device.id);
  } catch (err) {
    console.warn(
      '[sandbox-devices] hub unavailable while describing a device:',
      err instanceof Error ? err.message : err,
    );
  }
  return {
    deviceId: device.id,
    name: device.name,
    organizationId: device.orgId,
    organizationName: orgs[0]?.name ?? null,
    connected,
    lastSeenAt: device.lastSeenAt,
    serverVersion: deviceServerVersion(),
    relays: deviceRelays(),
  };
}

async function stampRevoked(
  tx: TransactionSql,
  args: {
    organizationId: string;
    deviceId: string;
    revokedBy: string;
    actor: { id: string; type: 'user' | 'system'; email?: string };
  },
): Promise<boolean> {
  const rows = await tx<
    { id: string; name: string; revokedAt: string | null }[]
  >`
    SELECT id, name, revoked_at_ms::text AS "revokedAt"
    FROM app.sandbox_devices
    WHERE id = ${args.deviceId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) return false;
  if (row.revokedAt !== null) return true;
  await tx`
    UPDATE app.sandbox_devices
    SET revoked_at_ms = ${Date.now()}, revoked_by = ${args.revokedBy}
    WHERE id = ${row.id}
  `;
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor.id,
    ...(args.actor.email !== undefined ? { actorEmail: args.actor.email } : {}),
    actorType: args.actor.type,
    action: 'sandbox_device_removed',
    category: 'security',
    resourceType: 'sandbox_device',
    resourceId: row.id,
    resourceName: row.name,
    previousState: { name: row.name },
    status: 'success',
  });
  return true;
}

/**
 * Have the hub drop a removed device: close its tunnel and forget where its
 * sessions were, so their next calls reach the server (which answers "gone"
 * and the platform starts them afresh) instead of "device offline" forever.
 * Stamped once confirmed; when the spawner cannot be reached the sandbox
 * watchdog retries (`releaseRemovedDevices`). The device itself is cut off
 * either way: its secret is stamped, so it mints no new ticket.
 */
async function releaseFromHub(
  sql: Sql,
  deviceId: string,
  disconnect: (deviceId: string) => Promise<unknown> = sandboxDeviceDisconnect,
): Promise<boolean> {
  // Without a sandbox service there is no hub holding anything for it.
  if (process.env.SANDBOX_TOKEN?.trim()) {
    try {
      await disconnect(deviceId);
    } catch (err) {
      console.warn(
        `[sandbox-devices] the hub has not dropped removed device ${deviceId} yet; the sandbox watchdog retries:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }
  await sql`
    UPDATE app.sandbox_devices SET hub_released_at_ms = ${Date.now()}
    WHERE id = ${deviceId} AND hub_released_at_ms IS NULL
  `;
  return true;
}

/** The watchdog's pass: removed devices whose release the hub has not
 * confirmed, oldest first. Returns how many it released. */
export async function releaseRemovedDevices(
  sql: Sql,
  options: {
    batch?: number;
    disconnect?: (deviceId: string) => Promise<unknown>;
  } = {},
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.sandbox_devices
    WHERE revoked_at_ms IS NOT NULL AND hub_released_at_ms IS NULL
    ORDER BY revoked_at_ms
    LIMIT ${options.batch ?? 25}
  `;
  let released = 0;
  for (const { id } of rows) {
    if (await releaseFromHub(sql, id, options.disconnect)) released += 1;
  }
  return released;
}

/** An admin removes a device from the organization. */
export async function removeDevice(
  sql: Sql,
  args: {
    organizationId: string;
    deviceId: string;
    actor: SandboxDeviceActor;
  },
): Promise<void> {
  const found = await sql.begin((tx) =>
    stampRevoked(tx, {
      organizationId: args.organizationId,
      deviceId: args.deviceId,
      revokedBy: args.actor.userId,
      actor: {
        id: args.actor.userId,
        type: 'user',
        ...(args.actor.email !== undefined ? { email: args.actor.email } : {}),
      },
    }),
  );
  if (!found) {
    throw new SandboxDeviceError(
      'DEVICE_NOT_FOUND',
      'No such device in this organization',
      404,
    );
  }
  await releaseFromHub(sql, args.deviceId);
}

/** The machine disconnects itself (`tale sandbox disconnect`). */
export async function leaveDevice(
  sql: Sql,
  presentedSecret: string,
): Promise<void> {
  const device = await resolveDevice(sql, presentedSecret);
  if (device === null) throw revoked();
  await sql.begin((tx) =>
    stampRevoked(tx, {
      organizationId: device.orgId,
      deviceId: device.id,
      revokedBy: 'device',
      actor: { id: DEVICE_ACTOR, type: 'system' },
    }),
  );
  await releaseFromHub(sql, device.id);
}

function statusOf(
  live: HubDevices['devices'][number] | undefined,
): SandboxDeviceStatus {
  if (live === undefined) return 'offline';
  if (live.update.state === 'updating') return 'updating';
  if (!live.compatible) {
    return live.update.state === 'failed' ? 'update_failed' : 'outdated';
  }
  return 'online';
}

/** The settings list: the organization's devices, live state merged in. */
export async function listDevices(
  sql: Sql,
  organizationId: string,
): Promise<SandboxDevicesView> {
  const rows = await sql<DeviceRow[]>`
    SELECT id, org_id AS "orgId", name, platform, version,
           max_sessions AS "maxSessions", created_by AS "createdBy",
           created_at_ms::float8 AS "createdAt",
           last_seen_at_ms::float8 AS "lastSeenAt"
    FROM app.sandbox_devices
    WHERE org_id = ${organizationId} AND revoked_at_ms IS NULL
    ORDER BY created_at_ms DESC
  `;
  let hub: SandboxDevicesView['hub'] = 'not_configured';
  let live: HubDevices['devices'] = [];
  if (process.env.SANDBOX_TOKEN?.trim()) {
    try {
      const answer = await sandboxDevices(organizationId);
      hub = answer.hub ? 'available' : 'not_configured';
      live = answer.devices;
    } catch (err) {
      hub = 'unavailable';
      console.warn(
        '[sandbox-devices] device hub unavailable:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  const devices: SandboxDeviceView[] = rows.map((row) => {
    const now = live.find((d) => d.deviceId === row.id);
    return {
      id: row.id,
      name: row.name,
      status: statusOf(now),
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      lastSeenAt: row.lastSeenAt,
      connectedAt: now?.connectedAtMs ?? null,
      version: now?.version ?? row.version,
      maxSessions: now?.maxSessions ?? row.maxSessions,
      platform: now?.platform ?? parsePlatform(row.platform),
      sessions: now?.sessions ?? null,
      resources: now?.resources ?? null,
      update: now?.update ?? null,
    };
  });
  return { devices, hub, serverVersion: deviceServerVersion() };
}
