/**
 * HTTP-only identities, for a deployment the seed has no database access to
 * (a deployment smoke, a staging stack): every user signs up through the
 * API, and owners add their members through the app's members door.
 *
 * Each sign-up costs the server a scrypt hash, so this mode suits a few
 * thousand users, not a million. It needs `TALE_ALLOW_OPEN_SIGN_UP=true` on
 * the target once the deployment has its first account. Sessions are not
 * minted here (the plan says so), so the driver signs every user in.
 */

import { isOwner } from '../plan.ts';
import { signUpOrSignIn, SignUpClosedError, type UserAuth } from './auth.ts';
import { createProgress, mapLimit } from './concurrency.ts';
import {
  SeedHttp,
  SeedHttpError,
  withRetry,
  type SeedRequest,
} from './http.ts';
import {
  displayNames,
  membershipsFor,
  ownerIndexFor,
  type PopulationPlan,
} from './population.ts';

export interface IndexIssue {
  index: number;
  message: string;
}

export interface HttpIdentityResult {
  /** User id of every user that signed up or in. */
  userIds: Map<number, string>;
  /** Session cookies of organization owners, reused to create their orgs. */
  ownerCookies: Map<number, string>;
  failures: IndexIssue[];
  elapsedMs: number;
}

/**
 * Sign every user up (or in, on a rerun). A deployment that refuses sign-up
 * stops the seed at once; any other per-user failure is reported.
 */
export async function signUpUsers(
  http: SeedHttp,
  plan: PopulationPlan,
  options: {
    concurrency: number;
    forwardedForBase?: string;
    log: (line: string) => void;
  },
): Promise<HttpIdentityResult> {
  const started = performance.now();
  const total = plan.users.count;
  const names = displayNames(plan.runId, 0, total);
  const userIds = new Map<number, string>();
  const ownerCookies = new Map<number, string>();
  const failures: IndexIssue[] = [];
  const progress = createProgress('sign-ups', total, { write: options.log });
  const indexes = Array.from({ length: total }, (_, index) => index);
  await mapLimit(indexes, options.concurrency, async (index) => {
    try {
      const user = await signUpOrSignIn(
        http,
        plan,
        index,
        names[index] ?? `Load User ${index}`,
        options.forwardedForBase,
      );
      userIds.set(index, user.userId);
      if (isOwner(plan, index)) ownerCookies.set(index, user.cookie);
    } catch (error) {
      if (error instanceof SignUpClosedError) throw error;
      failures.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    progress.tick();
  });
  progress.done();
  return {
    userIds,
    ownerCookies,
    failures,
    elapsedMs: performance.now() - started,
  };
}

export interface HttpMembershipResult {
  added: number;
  /** Already members (a rerun). */
  existing: number;
  /** Memberships whose organization or user is missing. */
  skipped: number;
  failures: IndexIssue[];
  elapsedMs: number;
}

/**
 * Every non-owner membership through `POST /api/app/members`, as the owner
 * (the door is admin-only). `DUPLICATE_MEMBER` counts as done.
 */
export async function addMembersOverHttp(
  http: SeedHttp,
  plan: PopulationPlan,
  ids: {
    orgIds: ReadonlyMap<number, string>;
    userIds: ReadonlyMap<number, string>;
  },
  auth: UserAuth,
  options: { concurrency: number; log: (line: string) => void },
): Promise<HttpMembershipResult> {
  const started = performance.now();
  const memberships = membershipsFor(plan, 0, plan.users.count);
  const result: HttpMembershipResult = {
    added: 0,
    existing: 0,
    skipped: 0,
    failures: [],
    elapsedMs: 0,
  };
  const progress = createProgress('memberships', memberships.length, {
    write: options.log,
  });
  await mapLimit(memberships, options.concurrency, async (membership) => {
    const orgId = ids.orgIds.get(membership.orgIndex);
    const userId = ids.userIds.get(membership.index);
    if (orgId === undefined || userId === undefined) {
      result.skipped += 1;
      progress.tick();
      return;
    }
    try {
      const cookie = await auth(ownerIndexFor(plan, membership.orgIndex));
      const req: SeedRequest = {
        method: 'POST',
        path: '/api/app/members',
        query: { orgId },
        cookie,
        json: { userId, role: membership.role },
      };
      const res = await withRetry(async () => {
        const answer = await http.send(req);
        if (answer.status >= 500 || answer.status === 429) {
          throw new SeedHttpError(req, answer);
        }
        return answer;
      });
      const code = (res.body as { error?: unknown } | null)?.error;
      if (res.status === 200) result.added += 1;
      else if (code === 'DUPLICATE_MEMBER') result.existing += 1;
      else throw new SeedHttpError(req, res);
    } catch (error) {
      result.failures.push({
        index: membership.index,
        message: `org ${membership.orgIndex}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    progress.tick();
  });
  progress.done();
  result.elapsedMs = performance.now() - started;
  return result;
}
