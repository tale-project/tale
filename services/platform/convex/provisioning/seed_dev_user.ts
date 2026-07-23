/**
 * Dev-login seeder — makes a fresh `bun run docker:dev` stack immediately
 * testable: creates the owner account (`dev@tale.test` by default) and a
 * "Dev Workspace" organization through the SAME Better Auth endpoints the
 * first-run setup wizard uses, so every org-creation side effect (config
 * scaffold, workflow/prompt/agent provisioning, starter content) fires
 * exactly as if a human completed `/setup`.
 *
 * Invoked by the platform docker-entrypoint after `convex deploy` (next to
 * `provisioning:provisionAll`), gated there on NODE_ENV=development plus the
 * TALE_DEV_SEED_USER flag. Defense in depth: this module re-checks the flag
 * AND refuses to run unless SITE_URL is a loopback host (see
 * `lib/utils/dev-seed-config.ts` — NODE_ENV is unreliable inside the Convex
 * runtime, so SITE_URL is the "not production" signal).
 *
 * Idempotent: an existing user short-circuits account creation; an existing
 * membership short-circuits org creation — so a re-run (every boot) is a
 * no-op, and a half-seeded state (user without org) self-heals.
 */

import { v } from 'convex/values';

import { resolveDevSeedConfig } from '../../lib/utils/dev-seed-config';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { createAuth } from '../auth';

const DEV_SEED_ORG_NAME = 'Dev Workspace';
const DEV_SEED_ORG_SLUG = 'dev-workspace';

/** Better Auth adapter lookup: the user's id by email, if the user exists. */
async function findUserIdByEmail(
  ctx: MutationCtx,
  email: string,
): Promise<string | undefined> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: 'email', value: email, operator: 'eq' }],
  });
  const row: unknown = result?.page?.[0];
  return isRecord(row) ? getString(row, '_id') : undefined;
}

/**
 * Ensure the dev account exists; returns its Better Auth user id. Mirrors
 * `users/create_user_without_session.ts`: `auth.api.signUpEmail` gives proper
 * password hashing without minting a session.
 */
export const ensureDevUser = internalMutation({
  args: { email: v.string(), password: v.string() },
  returns: v.object({ userId: v.string(), created: v.boolean() }),
  // Explicit return annotations on all three handlers: the action below
  // references this module's own functions via `internal.provisioning.
  // seed_dev_user.*`, and without annotations that self-reference makes the
  // module's type circular through _generated/api.d.ts (same reason
  // seed_starter.ts annotates `Promise<null>`).
  handler: async (ctx, args): Promise<{ userId: string; created: boolean }> => {
    const existingId = await findUserIdByEmail(ctx, args.email);
    if (existingId) return { userId: existingId, created: false };

    const auth = createAuth(ctx);
    // Wizard parity (account-step.tsx): name defaults to the email.
    await auth.api.signUpEmail({
      body: { email: args.email, password: args.password, name: args.email },
    });

    const userId = await findUserIdByEmail(ctx, args.email);
    if (!userId) {
      throw new Error(
        `Dev user ${args.email} was signed up but could not be found afterwards`,
      );
    }
    return { userId, created: true };
  },
});

/**
 * Ensure the dev user owns an organization; returns the org id. Runs through
 * `auth.api.createOrganization` with the server-only `userId` body field (a
 * sanctioned headless "system action" in Better Auth — no session required),
 * so `afterCreateOrganization` fires the full scaffold/provisioning chain.
 */
export const ensureDevOrg = internalMutation({
  args: { userId: v.string() },
  returns: v.object({ organizationId: v.string(), created: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ organizationId: string; created: boolean }> => {
    const membership = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'userId', value: args.userId, operator: 'eq' }],
      },
    );
    const existingRow: unknown = membership?.page?.[0];
    const existingOrgId = isRecord(existingRow)
      ? getString(existingRow, 'organizationId')
      : undefined;
    if (existingOrgId) return { organizationId: existingOrgId, created: false };

    const auth = createAuth(ctx);
    // Wizard parity (workspace-step.tsx): metadata carries creatorId +
    // defaultLocale (seeds the prompt library language).
    const organization = await auth.api.createOrganization({
      body: {
        name: DEV_SEED_ORG_NAME,
        slug: DEV_SEED_ORG_SLUG,
        userId: args.userId,
        metadata: { creatorId: args.userId, defaultLocale: 'en' },
      },
    });
    if (!organization) {
      throw new Error('Dev organization creation returned no organization');
    }
    return { organizationId: organization.id, created: true };
  },
});

/**
 * Entry point for the docker-entrypoint (`bunx convex run
 * provisioning/seed_dev_user:seedDevUser`). Returns a status string the
 * entrypoint can log; never throws for the "seeding disabled" cases so the
 * boot sequence stays quiet when the flag is off.
 */
export const seedDevUser = internalAction({
  args: {},
  returns: v.object({ status: v.string(), detail: v.string() }),
  handler: async (ctx): Promise<{ status: string; detail: string }> => {
    const config = resolveDevSeedConfig(process.env);
    if (!config.enabled) {
      console.log(`[seedDevUser] skipped: ${config.reason}`);
      return { status: 'skipped', detail: config.reason };
    }

    const user = await ctx.runMutation(
      internal.provisioning.seed_dev_user.ensureDevUser,
      { email: config.email, password: config.password },
    );
    const org = await ctx.runMutation(
      internal.provisioning.seed_dev_user.ensureDevOrg,
      { userId: user.userId },
    );
    // The system-default-agent seed (wizard parity)
    // returns with the chat rebuild; a fresh dev org currently starts agent-less.

    const detail = `user ${config.email} ${user.created ? 'created' : 'already existed'}; organization ${org.created ? 'created' : 'already existed'}`;
    console.log(`[seedDevUser] ${detail}`);
    return { status: 'seeded', detail };
  },
});
