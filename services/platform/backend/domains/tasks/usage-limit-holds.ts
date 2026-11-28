/**
 * Usage-limit holds (TASK-R87): a subscription a run worked on reached its
 * usage limit, so the organization's runs on it wait until it resets — or,
 * for a device's own sign-in (`device-login`), start on another device whose
 * sign-in is not held. One hold per credential and device
 * (`app.usage_limit_holds`, migration 0240); a credential no device holds
 * (a pasted subscription token) is held under the device `''`.
 *
 * A hold lasts until the reset the harness named (Claude Code's rejected
 * rate-limit event, or its result), bounded by {@link USAGE_LIMIT_MAX_HOLD_MS};
 * a limit that named no reset is held {@link USAGE_LIMIT_DEFAULT_HOLD_MS},
 * after which the next run tries the sign-in again and holds it anew if it
 * is still at its limit.
 */
import type { Sql, TransactionSql } from 'postgres';

import { sandboxDevices } from '../../core/node_only/sandbox/helpers/session_client.ts';

/** How long a limit that named no reset is held. */
export const USAGE_LIMIT_DEFAULT_HOLD_MS = 60 * 60_000;
/** The longest a named reset is believed: a weekly window, and a day more. */
export const USAGE_LIMIT_MAX_HOLD_MS = 8 * 24 * 60 * 60_000;
/** Expired holds are kept this long for the record, then removed. */
const EXPIRED_KEEP_MS = 24 * 60 * 60_000;

export interface UsageLimitHold {
  deviceId: string;
  heldUntilMs: number;
  resetKnown: boolean;
}

/** When a limit recorded at `now` may be tried again. */
export function usageLimitHeldUntil(
  now: number,
  resetsAtMs: number | undefined,
): { heldUntilMs: number; resetKnown: boolean } {
  if (
    resetsAtMs === undefined ||
    !Number.isFinite(resetsAtMs) ||
    resetsAtMs <= now
  ) {
    return {
      heldUntilMs: now + USAGE_LIMIT_DEFAULT_HOLD_MS,
      resetKnown: false,
    };
  }
  return {
    heldUntilMs: Math.min(resetsAtMs, now + USAGE_LIMIT_MAX_HOLD_MS),
    resetKnown: true,
  };
}

/** Hold a credential (on a device) until its limit resets. A later limit
 * of the same sign-in moves the hold to its own reset. */
export async function recordUsageLimitHold(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    credentialId: string;
    deviceId: string;
    resetsAtMs?: number;
    runId?: string;
    now?: number;
  },
): Promise<UsageLimitHold> {
  const now = args.now ?? Date.now();
  const { heldUntilMs, resetKnown } = usageLimitHeldUntil(now, args.resetsAtMs);
  await sql`
    INSERT INTO app.usage_limit_holds
      (org_id, credential_id, device_id, held_until_ms, reset_known,
       recorded_at_ms, run_id)
    VALUES (${args.organizationId}, ${args.credentialId}, ${args.deviceId},
      ${heldUntilMs}, ${resetKnown}, ${now}, ${args.runId ?? null})
    ON CONFLICT (org_id, credential_id, device_id) DO UPDATE SET
      held_until_ms = EXCLUDED.held_until_ms,
      reset_known = EXCLUDED.reset_known,
      recorded_at_ms = EXCLUDED.recorded_at_ms,
      run_id = EXCLUDED.run_id
  `;
  await sql`
    DELETE FROM app.usage_limit_holds
    WHERE org_id = ${args.organizationId}
      AND held_until_ms < ${now - EXPIRED_KEEP_MS}
  `;
  return { deviceId: args.deviceId, heldUntilMs, resetKnown };
}

/** The credential's holds that still stand, by device. */
export async function readUsageLimitHolds(
  sql: Sql | TransactionSql,
  args: { organizationId: string; credentialId: string; now?: number },
): Promise<Map<string, UsageLimitHold>> {
  const now = args.now ?? Date.now();
  const rows = await sql<
    { deviceId: string; heldUntilMs: number; resetKnown: boolean }[]
  >`
    SELECT device_id AS "deviceId", held_until_ms::float8 AS "heldUntilMs",
           reset_known AS "resetKnown"
    FROM app.usage_limit_holds
    WHERE org_id = ${args.organizationId}
      AND credential_id = ${args.credentialId}
      AND held_until_ms > ${now}
  `;
  return new Map(rows.map((row) => [row.deviceId, row]));
}

/** Every hold of the organization that still stands, for the device list. */
export async function listUsageLimitHolds(
  sql: Sql | TransactionSql,
  args: { organizationId: string; now?: number },
): Promise<Array<UsageLimitHold & { credentialId: string }>> {
  const now = args.now ?? Date.now();
  return await sql<Array<UsageLimitHold & { credentialId: string }>>`
    SELECT credential_id AS "credentialId", device_id AS "deviceId",
           held_until_ms::float8 AS "heldUntilMs", reset_known AS "resetKnown"
    FROM app.usage_limit_holds
    WHERE org_id = ${args.organizationId} AND held_until_ms > ${now}
  `;
}

/**
 * Which sign-in a run's usage limit holds (TASK-R87): the provider's default
 * credential the run served on — a device's own sign-in (`device-login`), on
 * the device the hub placed the run's worker on, or a pasted subscription
 * token (`subscription-key`), under the device `''`. Null for any other
 * credential (a subscription broker cools its own account down) and when the
 * device cannot be found (the hub did not answer, the worker is not placed).
 */
export async function usageLimitTarget(
  sql: Sql,
  runId: string,
): Promise<{ credentialId: string; deviceId: string } | null> {
  const rows = await sql<
    {
      organizationId: string;
      sessionId: string;
      credentialId: string | null;
      authMethod: string | null;
    }[]
  >`
    SELECT r.org_id AS "organizationId", r.session_id AS "sessionId",
           c.id AS "credentialId", c.auth_method AS "authMethod"
    FROM app.project_agent_runs r
    LEFT JOIN app.provider_credentials c
      ON c.org_id = r.org_id AND c.provider_slug = r.model_provider
     AND c.is_default AND c.status = 'active'
    WHERE r.id = ${runId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined || row.credentialId === null) return null;
  if (row.authMethod === 'subscription-key') {
    return { credentialId: row.credentialId, deviceId: '' };
  }
  if (row.authMethod !== 'device-login') return null;
  try {
    const hub = await sandboxDevices(row.organizationId);
    const placement = (hub.placements ?? []).find(
      (entry) => entry.sessionId === row.sessionId,
    );
    return placement === undefined
      ? null
      : { credentialId: row.credentialId, deviceId: placement.deviceId };
  } catch (error) {
    console.warn(
      `[task-agent] the device of run ${runId}'s limit is unknown (the hub did not answer); its sign-in is not held`,
      error,
    );
    return null;
  }
}

/** The devices whose own sign-in for the provider's default device sign-in
 * credential is held (TASK-R87); none when the default is no device
 * sign-in. */
export async function heldDeviceLogins(
  sql: Sql,
  args: { organizationId: string; providerSlug: string; now?: number },
): Promise<string[]> {
  const now = args.now ?? Date.now();
  const rows = await sql<{ deviceId: string }[]>`
    SELECT h.device_id AS "deviceId"
    FROM app.provider_credentials c
    JOIN app.usage_limit_holds h
      ON h.org_id = c.org_id AND h.credential_id = c.id
    WHERE c.org_id = ${args.organizationId}
      AND c.provider_slug = ${args.providerSlug}
      AND c.is_default AND c.status = 'active'
      AND c.auth_method = 'device-login'
      AND h.device_id <> '' AND h.held_until_ms > ${now}
  `;
  return rows.map((row) => row.deviceId).sort();
}
