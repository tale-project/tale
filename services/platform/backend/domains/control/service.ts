import { transactSerializable } from '@tale/shared/db/serializable';
import { hashPassword } from 'better-auth/crypto';
import type { Sql } from 'postgres';

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../../lib/shared/schemas/password.ts';
import { normalizeAuthEmail } from '../../core/lib/auth/normalize_auth_email.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { scaffoldNewOrganization } from '../organizations/scaffold.ts';
import {
  recordPasswordChange,
  setCredentialPassword,
} from '../users/service.ts';

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

export interface ReseedOrgResult {
  slug: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface ReseedResult {
  total: number;
  succeeded: number;
  failed: number;
  results: ReseedOrgResult[];
}

/**
 * FACTORY RESEED of every registered organization — the door behind `tale
 * deploy --override-all`. Unlike {@link provisionAllOrganizations} this runs
 * SYNCHRONOUSLY, org by org, because the operator is standing at a prompt
 * waiting for a per-org verdict: a queued job could only report "queued", and
 * a destructive reseed that silently failed for one org is exactly the
 * outcome the command exists to make visible.
 *
 * `override` overwrites each domain's files from the builtin catalog;
 * `strict` turns a misconfigured deployment into a raise instead of a silent
 * skip. `*.secrets.json`, `.history/` trails and uploaded branding images
 * survive — the scaffolder's own per-domain rules decide, unchanged.
 *
 * Filesystem-only org subtrees (no organization row) are NOT touched:
 * "--override-all" means every REGISTERED org, not every directory on disk.
 * One org's failure never stops the sweep; the caller decides what a partial
 * outcome means.
 */
export async function reseedAllOrganizations(sql: Sql): Promise<ReseedResult> {
  const orgs = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" ORDER BY "slug"
  `;
  const results: ReseedOrgResult[] = [];
  for (const org of orgs) {
    try {
      const outcome = await scaffoldNewOrganization({
        orgSlug: org.slug,
        override: true,
        strict: true,
      });
      results.push(
        outcome.ok
          ? { slug: org.slug, status: 'ok' }
          : {
              slug: org.slug,
              status: 'error',
              error: outcome.error ?? 'unknown error',
            },
      );
    } catch (error) {
      results.push({
        slug: org.slug,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failed = results.filter((r) => r.status === 'error').length;
  return {
    total: results.length,
    succeeded: results.length - failed,
    failed,
    results,
  };
}

/**
 * Recover the owner's sign-in — the machine door behind `tale auth
 * reset-owner`, reached through the control token (the operator is on the
 * host with docker access; there is no session to authenticate).
 *
 * It deliberately validates against the BUILT-IN policy, not the org's: this
 * is the way back in when an admin has locked themselves out with an
 * unreachably strict one, so honoring that policy here would make recovery
 * impossible. Every live session of that account is dropped, so a stolen
 * cookie cannot outlive the reset.
 */
export async function resetOwnerCredentials(
  sql: Sql,
  args: { newEmail?: string; newPassword?: string },
): Promise<{ email: string; updated: { email: boolean; password: boolean } }> {
  if ((args.newEmail ?? '') === '' && (args.newPassword ?? '') === '') {
    throw new ControlError(
      'INVALID_ARGUMENT',
      'At least one of newEmail or newPassword is required',
    );
  }
  const owners = await sql<{ userId: string; email: string }[]>`
    SELECT m."userId", u."email"
    FROM "member" m JOIN "user" u ON u."id" = m."userId"
    WHERE lower(m."role") = 'owner'
    ORDER BY m."createdAt" ASC
    LIMIT 1
  `;
  const owner = owners[0];
  if (owner === undefined) {
    throw new ControlError('NO_OWNER', 'No owner found in this deployment');
  }

  let email = owner.email;
  let updatedEmail = false;
  let updatedPassword = false;

  if (args.newEmail !== undefined && args.newEmail !== '') {
    const normalized = normalizeAuthEmail(args.newEmail);
    const taken = await sql<{ id: string }[]>`
      SELECT "id" FROM "user"
      WHERE lower("email") = ${normalized} AND "id" <> ${owner.userId}
      LIMIT 1
    `;
    if (taken.length > 0) {
      throw new ControlError(
        'EMAIL_IN_USE',
        `Email "${normalized}" is already in use by another user`,
      );
    }
    await sql`
      UPDATE "user" SET "email" = ${normalized}, "updatedAt" = ${new Date()}
      WHERE "id" = ${owner.userId}
    `;
    email = normalized;
    updatedEmail = true;
  }

  if (args.newPassword !== undefined && args.newPassword !== '') {
    if (!isPasswordValid(args.newPassword)) {
      throw new ControlError(
        'PASSWORD_POLICY_VIOLATION',
        `Password does not meet recovery defaults (failed: ${passwordPolicyViolations(
          args.newPassword,
        ).join(', ')})`,
      );
    }
    const passwordHash = await hashPassword(args.newPassword);
    // The credential write, the session sweep and the rotation anchor are
    // one transaction (the same shape as the admin door's setMemberPassword).
    await transactSerializable(sql, async (tx) => {
      await setCredentialPassword(tx, owner.userId, passwordHash);
      await tx`DELETE FROM "session" WHERE "userId" = ${owner.userId}`;
      await recordPasswordChange(tx, owner.userId);
    });
    updatedPassword = true;
  }

  return { email, updated: { email: updatedEmail, password: updatedPassword } };
}

/** A refusal the control door answers as a 400 with its code. */
export class ControlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
  }
}
