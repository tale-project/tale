/**
 * The helpers `backend/integration-check.ts` shares with the lanes that live
 * in modules of their own (`*.integration.ts`), so a lane never carries a
 * second copy of the suite's cookie handling or its throwaway sign-up.
 */
import { z } from 'zod';

/** The password every throwaway `itest-` user signs up with. */
export const ITEST_PASSWORD = 'itest-password-1';

/** The `Cookie` header a browser would send after `response`. */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
}

/**
 * A fresh user signed up through Better Auth (with {@link ITEST_PASSWORD})
 * and a member of NO organization yet — what a lane needs when the
 * membership itself is what it exercises (the members API, an org the user
 * goes on to create and own) or when the probe is about the account alone.
 * `signUpOrgMember` builds on it; a lane that only needs another pair of
 * hands in the suite's org wants that one. `userId` is empty when the
 * sign-up was refused.
 */
export async function signUpUser(
  base: string,
  label: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  const email = `itest-${label}-${Date.now()}@example.com`;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      email,
      password: ITEST_PASSWORD,
      name: `Itest ${label}`,
    }),
  });
  const parsed = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await res.json());
  return {
    cookie: cookieHeaderFrom(res),
    userId: parsed.success ? parsed.data.user.id : '',
    email,
  };
}
