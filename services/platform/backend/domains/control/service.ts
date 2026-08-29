import type { Sql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Deploy DRAIN control plane — the 0.5 twin of `convex/control/drain.ts`.
 * `tale deploy` restarts the backend on a version change, killing every
 * in-flight chat generation. Before the restart the CLI begins a drain
 * (the chat doors then refuse NEW turns so clients retry onto the restarted
 * backend), polls until `inFlight` reaches 0, recreates, and ends the
 * drain. Best-effort by design on the CLI side; on this side the flag is a
 * singleton row with a hard expiry so a deploy that dies mid-drain cannot
 * refuse chats forever.
 *
 * Where 0.4's `countActiveGenerations` had become a constant 0 (its chat
 * pipeline had moved off Convex), 0.5 counts the REAL in-flight rows —
 * `app.generations` with a fresh heartbeat — restoring the feature's
 * original meaning (rule 5: fix, don't port the vestige).
 */

/** Hard expiry for a drain flag — well above the CLI's 3-minute drain
 * budget, so chats self-heal in 15 minutes after a crashed deploy. */
const DRAIN_MAX_MS = 15 * 60 * 1000;

/** A generation whose heartbeat went silent for this long is already dead
 * (the watchdog clears it at the same threshold) — not something a drain
 * should wait on. */
const GENERATION_FRESH_MS = 10 * 60_000;

const SINGLETON = 'singleton';

/** Whether new chat turns should currently be refused. */
export async function isBackendDraining(sql: Sql): Promise<boolean> {
  const rows = await sql<
    { draining: boolean; drainExpiresAt: number | null }[]
  >`
    SELECT draining, drain_expires_at_ms::float8 AS "drainExpiresAt"
    FROM app.backend_control WHERE key = ${SINGLETON} LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.draining) return false;
  // Unexpired drain only — a stale flag (crashed deploy) reads as off.
  return row.drainExpiresAt === null || Date.now() < row.drainExpiresAt;
}

/** Generations genuinely in flight: present AND heartbeat-fresh (a stale
 * lock means the turn is already dead — not something to wait on). */
export async function countActiveGenerations(sql: Sql): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.generations
    WHERE heartbeat_at_ms >= ${Date.now() - GENERATION_FRESH_MS}
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function beginDrain(sql: Sql): Promise<{ inFlight: number }> {
  const now = Date.now();
  await sql`
    INSERT INTO app.backend_control (
      key, draining, drain_started_at_ms, drain_expires_at_ms, updated_at_ms
    ) VALUES (${SINGLETON}, true, ${now}, ${now + DRAIN_MAX_MS}, ${now})
    ON CONFLICT (key) DO UPDATE SET
      draining = true, drain_started_at_ms = ${now},
      drain_expires_at_ms = ${now + DRAIN_MAX_MS}, updated_at_ms = ${now}
  `;
  return { inFlight: await countActiveGenerations(sql) };
}

export async function endDrain(sql: Sql): Promise<void> {
  await sql`
    UPDATE app.backend_control SET
      draining = false, drain_started_at_ms = NULL,
      drain_expires_at_ms = NULL, updated_at_ms = ${Date.now()}
    WHERE key = ${SINGLETON}
  `;
}

export async function drainStatus(
  sql: Sql,
): Promise<{ draining: boolean; inFlight: number }> {
  return {
    draining: await isBackendDraining(sql),
    inFlight: await countActiveGenerations(sql),
  };
}

/**
 * Re-run provisioning for every organization — the 0.5 twin of `tale
 * migrate`'s Convex `provisioning:provisionAll` step. SCHEMA migrations need
 * no door: the backend applies them under an advisory lock at boot, so a
 * deployed image is always at its own schema. What stays operator-triggered
 * is the idempotent per-org seeding (default automation packs + starter
 * content), which rides the same `org.scaffold` job the create path uses —
 * one job per org so a slow or failing org retries on its own without
 * blocking the rest, and the CLI returns as soon as they are queued.
 */
export async function provisionAllOrganizations(
  sql: Sql,
): Promise<{ organizations: number }> {
  const orgs = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" ORDER BY "slug"
  `;
  for (const org of orgs) {
    await addJobInTx(sql, 'org.scaffold', { orgSlug: org.slug });
  }
  return { organizations: orgs.length };
}
