/**
 * How the seed acts as a user: a minted session cookie when it wrote the
 * session rows itself, else a password sign-in (or sign-up) over the API.
 */

import {
  sessionCookieName,
  sessionTokenFor,
  signedSessionCookieValue,
  userEmail,
  userId,
} from '../plan.ts';
import {
  cookieHeader,
  cookiesFromSetCookie,
  SeedHttp,
  SeedHttpError,
  withRetry,
  type SeedRequest,
} from './http.ts';
import { syntheticIp } from './options.ts';
import type { PopulationPlan } from './population.ts';

/** A `Cookie` header that authenticates virtual user `index`. */
export type UserAuth = (index: number) => Promise<string>;

/** The minted session of user `index` as a ready `Cookie` header. */
export function mintedSessionCookie(
  siteUrl: string,
  authSecret: string,
  runId: string,
  index: number,
): string {
  const token = sessionTokenFor(authSecret, runId, index);
  return `${sessionCookieName(siteUrl)}=${signedSessionCookieValue(authSecret, token)}`;
}

/** Authenticates every user by their minted session; no request needed. */
export function mintedAuth(
  siteUrl: string,
  authSecret: string,
  runId: string,
): UserAuth {
  return (index) =>
    Promise.resolve(mintedSessionCookie(siteUrl, authSecret, runId, index));
}

/**
 * Prove the deployment accepts the minted session of user `index` before
 * anything is done in that user's name. A secret that is not the target's
 * BETTER_AUTH_SECRET, or session rows that expired since an earlier run,
 * would otherwise surface as one 401 per organization; this turns either
 * into one clear error up front.
 */
export async function assertMintedSessionAccepted(
  http: SeedHttp,
  siteUrl: string,
  authSecret: string,
  plan: Pick<PopulationPlan, 'runId'>,
  index: number,
): Promise<void> {
  const req: SeedRequest = {
    method: 'GET',
    path: '/api/auth/get-session',
    cookie: mintedSessionCookie(siteUrl, authSecret, plan.runId, index),
  };
  const res = await withRetry(async () => {
    const answer = await http.send(req);
    if (answer.status !== 200) throw new SeedHttpError(req, answer);
    return answer;
  });
  const id = (res.body as { user?: { id?: unknown } } | null)?.user?.id;
  if (id !== userId(plan.runId, index)) {
    throw new Error(
      `${http.target} does not accept the minted session of user ${index}: ` +
        "check that the auth secret is the deployment's BETTER_AUTH_SECRET and that the run's session rows have not expired",
    );
  }
}

export interface SignedInUser {
  userId: string;
  cookie: string;
}

/** Headers that make user `index` look like its own client to the limiter. */
function clientHeaders(
  forwardedForBase: string | undefined,
  index: number,
): Record<string, string> {
  return forwardedForBase === undefined
    ? {}
    : { 'x-forwarded-for': syntheticIp(forwardedForBase, index) };
}

/** The user id and session cookie of an auth answer. */
function signedIn(
  req: SeedRequest,
  res: Awaited<ReturnType<SeedHttp['send']>>,
): SignedInUser {
  const jar = cookiesFromSetCookie(res.headers['set-cookie']);
  const body = res.body as { user?: { id?: unknown } } | null;
  const id = body?.user?.id;
  if (typeof id !== 'string' || jar.size === 0) {
    throw new Error(
      `${req.method} ${req.path} answered ${res.status} without a user id and session cookie`,
    );
  }
  return { userId: id, cookie: cookieHeader(jar) };
}

/**
 * Sign user `index` in with the plan's password. The per-IP sign-in limit
 * (30 per minute) answers 429 with `Retry-After`, which the retry loop
 * honours; a synthetic `X-Forwarded-For` spreads the seed over many
 * addresses where the backend trusts this host as a proxy.
 */
export async function signIn(
  http: SeedHttp,
  plan: PopulationPlan,
  index: number,
  forwardedForBase?: string,
): Promise<SignedInUser> {
  const req: SeedRequest = {
    method: 'POST',
    path: '/api/auth/sign-in/email',
    json: { email: userEmail(plan, index), password: plan.users.password },
    headers: clientHeaders(forwardedForBase, index),
  };
  return withRetry(
    async () => {
      const res = await http.send(req);
      if (res.status !== 200) throw new SeedHttpError(req, res);
      return signedIn(req, res);
    },
    { attempts: 10, maxDelayMs: 65_000 },
  );
}

/** Raised when the deployment refuses open sign-up. */
export class SignUpClosedError extends Error {}

/**
 * Sign user `index` up; an e-mail that already has an account (a rerun)
 * signs in instead. Needs `TALE_ALLOW_OPEN_SIGN_UP=true` on the target once
 * the deployment has its first user.
 */
export async function signUpOrSignIn(
  http: SeedHttp,
  plan: PopulationPlan,
  index: number,
  name: string,
  forwardedForBase?: string,
): Promise<SignedInUser> {
  const req: SeedRequest = {
    method: 'POST',
    path: '/api/auth/sign-up/email',
    json: {
      name,
      email: userEmail(plan, index),
      password: plan.users.password,
    },
    headers: clientHeaders(forwardedForBase, index),
  };
  const res = await withRetry(async () => {
    const answer = await http.send(req);
    if (answer.status >= 500 || answer.status === 429) {
      throw new SeedHttpError(req, answer);
    }
    return answer;
  });
  if (res.status === 200) return signedIn(req, res);
  const code = (res.body as { code?: unknown } | null)?.code;
  if (res.status === 422 || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return signIn(http, plan, index, forwardedForBase);
  }
  if (res.status === 403 && code === 'SIGN_UP_CLOSED') {
    throw new SignUpClosedError(
      'The target refuses sign-up: set TALE_ALLOW_OPEN_SIGN_UP=true on it for an HTTP-only seed',
    );
  }
  throw new SeedHttpError(req, res);
}

/**
 * Password sign-in on demand, one sign-in per user however many
 * organizations ask for it (user 0 owns a block and the mega organization).
 */
export function passwordAuth(
  http: SeedHttp,
  plan: PopulationPlan,
  forwardedForBase?: string,
): UserAuth {
  const cache = new Map<number, Promise<string>>();
  return (index) => {
    let cookie = cache.get(index);
    if (cookie === undefined) {
      cookie = signIn(http, plan, index, forwardedForBase).then(
        (user) => user.cookie,
      );
      // A failed sign-in must not be cached: the next caller retries.
      cookie.catch(() => cache.delete(index));
      cache.set(index, cookie);
    }
    return cookie;
  };
}

/** Authenticates from cookies collected earlier (the HTTP-only sign-ups). */
export function knownCookieAuth(
  cookies: ReadonlyMap<number, string>,
  fallback: UserAuth,
): UserAuth {
  return (index) => {
    const cookie = cookies.get(index);
    return cookie === undefined ? fallback(index) : Promise.resolve(cookie);
  };
}
