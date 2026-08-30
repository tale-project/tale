/**
 * Dev-login seeder — makes a fresh `bun run docker:dev` / `bun dev` stack
 * immediately testable: creates the owner account (`dev@tale.test` by
 * default) and a "Dev Workspace" organization through the SAME Better Auth
 * endpoints the first-run setup wizard uses, so every org-creation side
 * effect (`afterCreateOrganization`: scaffold job, joined_organization audit)
 * fires exactly as if a human completed `/setup`.
 *
 * Invoked from the backend boot sequence (`main.ts`) on any role that carries
 * auth, gated on the TALE_DEV_SEED_USER flag AND a loopback SITE_URL — see
 * `lib/utils/dev-seed-config.ts` for the rules, which are pure and unit
 * tested there. NODE_ENV alone is not the gate: a known password on a
 * reachable hostname is an account takeover, not a convenience.
 *
 * Idempotent: an existing user short-circuits account creation; an existing
 * membership short-circuits org creation — so a re-run (every boot) is a
 * no-op, and a half-seeded state (user without org) self-heals.
 */

import type { Sql } from 'postgres';

import { resolveDevSeedConfig } from '../../../lib/utils/dev-seed-config.ts';
import type { Auth } from '../../auth/auth.ts';

const DEV_SEED_ORG_NAME = 'Dev Workspace';
const DEV_SEED_ORG_SLUG = 'dev-workspace';

export interface DevSeedResult {
  status: 'seeded' | 'skipped';
  detail: string;
}

/** The user's id by email (Better Auth stores emails already normalized). */
async function findUserIdByEmail(
  sql: Sql,
  email: string,
): Promise<string | undefined> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "user" WHERE lower("email") = ${email} LIMIT 1
  `;
  return rows[0]?.id;
}

/** The first organization this user belongs to, if any. */
async function findMembershipOrgId(
  sql: Sql,
  userId: string,
): Promise<string | undefined> {
  const rows = await sql<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "member"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  return rows[0]?.organizationId;
}

/**
 * Seed the dev owner + workspace. Never throws for the "seeding disabled"
 * cases so the boot sequence stays quiet when the flag is off; a genuine
 * failure propagates to the caller, which logs it without failing boot.
 */
export async function seedDevUser(deps: {
  sql: Sql;
  auth: Auth;
  env?: Record<string, string | undefined>;
}): Promise<DevSeedResult> {
  const config = resolveDevSeedConfig(deps.env ?? process.env);
  if (!config.enabled) {
    return { status: 'skipped', detail: config.reason };
  }

  const existingUserId = await findUserIdByEmail(deps.sql, config.email);
  let userId = existingUserId;
  if (userId === undefined) {
    // Wizard parity (account-step.tsx): name defaults to the email.
    const signUp = await deps.auth.api.signUpEmail({
      body: {
        email: config.email,
        password: config.password,
        name: config.email,
      },
    });
    userId = signUp.user.id;
    if (!userId) {
      throw new Error(
        `Dev user ${config.email} was signed up but came back without an id`,
      );
    }
  }

  const existingOrgId = await findMembershipOrgId(deps.sql, userId);
  if (existingOrgId === undefined) {
    // The server-only `userId` body field is a sanctioned headless "system
    // action" in Better Auth (no session required), so the org hooks fire.
    const organization = await deps.auth.api.createOrganization({
      body: {
        name: DEV_SEED_ORG_NAME,
        slug: DEV_SEED_ORG_SLUG,
        userId,
        // Wizard parity (workspace-step.tsx).
        metadata: { creatorId: userId, defaultLocale: 'en' },
      },
    });
    if (!organization) {
      throw new Error('Dev organization creation returned no organization');
    }
  }

  const detail = `user ${config.email} ${
    existingUserId === undefined ? 'created' : 'already existed'
  }; organization ${existingOrgId === undefined ? 'created' : 'already existed'}`;
  return { status: 'seeded', detail };
}
