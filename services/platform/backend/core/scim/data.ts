/**
 * Shared read helpers over Better Auth's component tables for the SCIM layer.
 *
 * All reads go through `components.betterAuth.adapter.findMany` (a sub-query),
 * so these helpers only need `ctx.runQuery` and work from both query and
 * mutation contexts.
 */

import { findUserByNormalizedEmail as findUserByNormalizedEmailShared } from '../lib/auth/find_user_by_normalized_email';
import type { QueryCtx } from '../lib/ctx';
import { components } from '../lib/handler_names';
import type {
  BetterAuthMember,
  BetterAuthUser,
  BetterAuthFindManyResult,
} from '../members/types';

/** Minimal ctx shape these helpers need — satisfied by query and mutation ctx. */
export type ScimReadCtx = Pick<QueryCtx, 'runQuery'>;

interface BetterAuthTeam {
  _id: string;
  name: string;
  organizationId: string;
  createdAt?: number;
  updatedAt?: number | null;
}

interface BetterAuthTeamMember {
  _id: string;
  teamId: string;
  userId: string;
  createdAt?: number | null;
}

// A defensive cap so a runaway scan can't fan out unbounded sub-queries.
// The deployment is effectively single-org, so org membership is well within
// this. We `console.warn` rather than silently truncate if it is ever hit.
const SCAN_CAP = 5000;
const PAGE = 200;

async function gatherAll<T>(
  ctx: ScimReadCtx,
  model: 'user' | 'member' | 'team' | 'teamMember',
  where: { field: string; value: string; operator: 'eq' }[],
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res: BetterAuthFindManyResult<T> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      { model, paginationOpts: { cursor, numItems: PAGE }, where },
    );
    rows.push(...(res?.page ?? []));
    if (res?.isDone || !res?.continueCursor || rows.length >= SCAN_CAP) {
      if (rows.length >= SCAN_CAP && !res?.isDone) {
        console.warn(
          `[scim] ${model} scan hit the ${SCAN_CAP}-row cap; results truncated`,
        );
      }
      break;
    }
    cursor = res.continueCursor;
  }
  return rows;
}

async function findOne<T>(
  ctx: ScimReadCtx,
  model: 'user' | 'member' | 'team' | 'teamMember',
  where: { field: string; value: string; operator: 'eq' }[],
): Promise<T | undefined> {
  const res: BetterAuthFindManyResult<T> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    { model, paginationOpts: { cursor: null, numItems: 1 }, where },
  );
  return res?.page?.[0];
}

export async function findUserByEmail(
  ctx: ScimReadCtx,
  email: string,
): Promise<BetterAuthUser | undefined> {
  return findUserByNormalizedEmailShared(ctx, email);
}

export async function findUserById(
  ctx: ScimReadCtx,
  userId: string,
): Promise<BetterAuthUser | undefined> {
  return findOne<BetterAuthUser>(ctx, 'user', [
    { field: '_id', value: userId, operator: 'eq' },
  ]);
}

export async function findMember(
  ctx: ScimReadCtx,
  organizationId: string,
  userId: string,
): Promise<BetterAuthMember | undefined> {
  return findOne<BetterAuthMember>(ctx, 'member', [
    { field: 'organizationId', value: organizationId, operator: 'eq' },
    { field: 'userId', value: userId, operator: 'eq' },
  ]);
}

export async function listOrgMembers(
  ctx: ScimReadCtx,
  organizationId: string,
): Promise<BetterAuthMember[]> {
  return gatherAll<BetterAuthMember>(ctx, 'member', [
    { field: 'organizationId', value: organizationId, operator: 'eq' },
  ]);
}

/**
 * All `member` rows for a user across every org. The SCIM create path uses this
 * to decide whether a user matched globally by email is owned by another tenant
 * before reusing it (#2036).
 */
export async function listUserMemberships(
  ctx: ScimReadCtx,
  userId: string,
): Promise<BetterAuthMember[]> {
  return gatherAll<BetterAuthMember>(ctx, 'member', [
    { field: 'userId', value: userId, operator: 'eq' },
  ]);
}

/** Map of `userId → user` for an org, built from two paginated scans (no N+1). */
export async function buildOrgUserMap(
  ctx: ScimReadCtx,
): Promise<Map<string, BetterAuthUser>> {
  const users = await gatherAll<BetterAuthUser>(ctx, 'user', []);
  const map = new Map<string, BetterAuthUser>();
  for (const user of users) {
    if (user?._id) map.set(user._id, user);
  }
  return map;
}

export async function findTeamById(
  ctx: ScimReadCtx,
  teamId: string,
): Promise<BetterAuthTeam | undefined> {
  return findOne<BetterAuthTeam>(ctx, 'team', [
    { field: '_id', value: teamId, operator: 'eq' },
  ]);
}

export async function findTeamByName(
  ctx: ScimReadCtx,
  organizationId: string,
  name: string,
): Promise<BetterAuthTeam | undefined> {
  const teams = await gatherAll<BetterAuthTeam>(ctx, 'team', [
    { field: 'organizationId', value: organizationId, operator: 'eq' },
  ]);
  return teams.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

export async function listOrgTeams(
  ctx: ScimReadCtx,
  organizationId: string,
): Promise<BetterAuthTeam[]> {
  return gatherAll<BetterAuthTeam>(ctx, 'team', [
    { field: 'organizationId', value: organizationId, operator: 'eq' },
  ]);
}

export async function listTeamMembers(
  ctx: ScimReadCtx,
  teamId: string,
): Promise<BetterAuthTeamMember[]> {
  return gatherAll<BetterAuthTeamMember>(ctx, 'teamMember', [
    { field: 'teamId', value: teamId, operator: 'eq' },
  ]);
}

export type { BetterAuthTeam, BetterAuthTeamMember };
