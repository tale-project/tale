import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  PASSWORD_NOT_SET_CODE,
  REAUTHENTICATE_PATH,
} from '../../lib/shared/constants/session-freshness.ts';
import { normalizeAuthEmail } from '../core/lib/auth/normalize_auth_email.ts';
import { getClientIp } from '../core/lib/utils/client_ip.ts';
import { anchorTwoFactorGraceOnSignIn } from '../domains/two_factor/service.ts';
import {
  recordPasswordAttempt,
  refuseThrottledPasswordAttempt,
} from './password-attempts.ts';

/**
 * `POST /api/auth/reauthenticate` — a signed-in person confirms their
 * password and gets a FRESH session in exchange.
 *
 * Better Auth lets a session register a passkey only within
 * `session.freshAge` of its creation (`@better-auth/passkey` guards both
 * registration calls with `freshSessionMiddleware`). Someone who has been
 * signed in longer — everyone who meets the post-grace enrollment wall, since
 * they were signed in through the whole grace window — has no Better Auth
 * door that freshens a session short of a full sign-in, which for an account
 * with an authenticator drops the session cookie until the code is entered
 * and leaves the old session alive. This is that door.
 *
 * The password counts like a sign-in attempt: the per-account lockout and the
 * per-IP flood guard apply first, a wrong one bumps the shared failure
 * counter, and both outcomes write the sign-in audit rows, stamped as a
 * re-authentication. On success the session is ROTATED, not re-dated: a new
 * session carries the old one's organization and proxy fields, its cookie
 * replaces the old one and the old token is deleted, so a copy of the old
 * cookie does not become fresh with it.
 */
export function reauthenticate(deps: {
  sql: Sql;
  trustedProxies: () => Promise<string[]>;
}) {
  return {
    id: 'tale-reauthenticate',
    endpoints: {
      reauthenticate: createAuthEndpoint(
        REAUTHENTICATE_PATH,
        {
          method: 'POST',
          body: z.object({ password: z.string().min(1) }),
          use: [sensitiveSessionMiddleware],
          requireHeaders: true,
        },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const email = normalizeAuthEmail(user.email);
          const ip = ctx.request
            ? getClientIp(ctx.request.headers, await deps.trustedProxies())
            : undefined;
          const userAgent = ctx.request?.headers.get('user-agent') ?? undefined;

          await refuseThrottledPasswordAttempt(deps.sql, {
            email,
            ip: ip ?? 'unknown',
          });

          const credential =
            await ctx.context.internalAdapter.findCredentialAccount(user.id);
          if (!credential?.password) {
            throw new APIError('BAD_REQUEST', {
              message:
                'This account has no password to confirm; sign in again instead',
              code: PASSWORD_NOT_SET_CODE,
            });
          }
          const valid = await ctx.context.password.verify({
            hash: credential.password,
            password: ctx.body.password,
          });
          const attempt = {
            email,
            ...(ip !== undefined ? { ip } : {}),
            ...(userAgent !== undefined ? { userAgent } : {}),
            reauthentication: true,
          };
          if (!valid) {
            await recordPasswordAttempt(deps.sql, {
              ...attempt,
              outcome: 'failure',
            });
            // The code and wording Better Auth's own password confirmations
            // (two-factor enable / disable) answer with.
            throw new APIError('BAD_REQUEST', {
              message: 'Invalid password',
              code: 'INVALID_PASSWORD',
            });
          }
          // Everything else that can fail runs BEFORE the rotation: once the
          // old token is deleted, a refusal would leave the browser holding a
          // dead cookie — signed out instead of merely not fresh.
          await recordPasswordAttempt(deps.sql, {
            ...attempt,
            outcome: 'success',
          });
          // Every session-minting door anchors the 2FA grace clock.
          await anchorTwoFactorGraceOnSignIn(deps.sql, user.id);

          // The request that confirmed the password describes the new
          // session; everything else (the active organization, a proxy's
          // role) carries over.
          const {
            id: _id,
            ipAddress: _ipAddress,
            userAgent: _userAgent,
            ...carried
          } = session;
          const dontRememberMe = Boolean(
            await ctx.getSignedCookie(
              ctx.context.authCookies.dontRememberToken.name,
              ctx.context.secret,
            ),
          );
          const fresh = await ctx.context.internalAdapter.createSession(
            user.id,
            dontRememberMe,
            carried,
          );
          await setSessionCookie(ctx, { session: fresh, user });
          await ctx.context.internalAdapter.deleteSession(session.token);
          return ctx.json({ status: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
