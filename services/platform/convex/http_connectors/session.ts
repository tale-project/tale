/**
 * Who is asking, for the browser-facing half of the OAuth2 flow.
 *
 * The `start` route is reached by a click in the settings UI, so identity comes
 * from the Better Auth session cookie — an HTTP action gets no `ctx.auth`
 * identity from a cookie, the same reason `/api/tts-audio` and the sandbox
 * workspace routes resolve their caller this way.
 *
 * Kept in its own module so the authorization rules around it are testable
 * without standing up the auth component.
 */

import type { ActionCtx } from '../_generated/server';
import { createAuth } from '../auth';

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
}

/** The signed-in user, or null when the request carries no valid session. */
export async function resolveSessionUser(
  ctx: ActionCtx,
  req: Request,
): Promise<SessionUser | null> {
  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return null;
  return { userId: session.user.id, email: session.user.email };
}
