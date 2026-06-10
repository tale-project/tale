import type { APIRequestContext } from '@playwright/test';

/**
 * Programmatic account creation against the Better Auth HTTP endpoint.
 *
 * Sign-up is restricted to the first user ONLY in the UI
 * (`app/routes/_auth/sign-up.tsx` redirects when users exist) —
 * `POST /api/auth/sign-up/email` itself accepts new accounts, which is what
 * makes a hermetic per-run test identity possible. The payload mirrors
 * `authClient.signUp.email` in the sign-up route.
 */

/** Satisfies the default password policy (length/lower/upper/digit/special). */
const E2E_PASSWORD = 'TaleE2E!Passw0rd';

interface E2ECredentials {
  email: string;
  password: string;
}

/** Unique per-run identity so re-runs never collide with existing state. */
export function uniqueCredentials(label: string): E2ECredentials {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e-${label}-${suffix}@tale.test`,
    password: E2E_PASSWORD,
  };
}

/**
 * Create an account via the sign-up endpoint. The session cookie lands in the
 * given request context's cookie jar — pass `page.request` to authenticate a
 * browser context, or the standalone `request` fixture for a throwaway user
 * that must NOT log the current page in.
 */
export async function signUpViaApi(
  request: APIRequestContext,
  credentials: E2ECredentials,
): Promise<void> {
  const response = await request.post('/api/auth/sign-up/email', {
    data: {
      name: credentials.email,
      email: credentials.email,
      password: credentials.password,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Sign-up failed for ${credentials.email}: ${response.status()} ${await response.text()}`,
    );
  }
}
