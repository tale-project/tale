import type {
  BetterAuthFindManyResult,
  BetterAuthUser,
} from '../../members/types';
import type { QueryCtx } from '../ctx';
import { components } from '../handler_names';
import { normalizeAuthEmail } from './normalize_auth_email';

export type AuthReadCtx = Pick<QueryCtx, 'runQuery'>;

const USER_PAGE = 200;
const USER_SCAN_CAP = 10_000;

async function findUserByExactEmail(
  ctx: AuthReadCtx,
  email: string,
): Promise<BetterAuthUser | undefined> {
  const res: BetterAuthFindManyResult<BetterAuthUser> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'email', value: email, operator: 'eq' }],
    },
  );
  return res?.page?.[0];
}

/** Paginated scan of every Better Auth user (migration / dedup only). */
export async function listAllAuthUsers(
  ctx: AuthReadCtx,
): Promise<BetterAuthUser[]> {
  const rows: BetterAuthUser[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res: BetterAuthFindManyResult<BetterAuthUser> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'user',
        paginationOpts: { cursor, numItems: USER_PAGE },
        where: [],
      },
    );
    rows.push(...(res?.page ?? []));
    if (res?.isDone || !res?.continueCursor || rows.length >= USER_SCAN_CAP) {
      if (rows.length >= USER_SCAN_CAP && !res?.isDone) {
        console.warn(
          `[auth] user scan hit the ${USER_SCAN_CAP}-row cap; results truncated`,
        );
      }
      break;
    }
    cursor = res.continueCursor;
  }
  return rows;
}

/**
 * Find a user by email using the canonical lowercase form. After every write
 * path normalizes email this is a single indexed `eq` lookup.
 */
export async function findUserByNormalizedEmail(
  ctx: AuthReadCtx,
  email: string,
): Promise<BetterAuthUser | undefined> {
  return findUserByExactEmail(ctx, normalizeAuthEmail(email));
}

/** All users whose mailbox matches `email` case-insensitively. */
export async function findUsersByNormalizedEmail(
  ctx: AuthReadCtx,
  email: string,
): Promise<BetterAuthUser[]> {
  const normalized = normalizeAuthEmail(email);
  const users = await listAllAuthUsers(ctx);
  return users.filter((u) => normalizeAuthEmail(u.email) === normalized);
}

export async function findAuthUserById(
  ctx: AuthReadCtx,
  userId: string,
): Promise<BetterAuthUser | undefined> {
  const res: BetterAuthFindManyResult<BetterAuthUser> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: userId, operator: 'eq' }],
    },
  );
  return res?.page?.[0];
}
