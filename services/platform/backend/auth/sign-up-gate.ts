/**
 * Who may create an account on a deployment.
 *
 * A deployment's FIRST account is created over HTTP: the setup flow in the
 * browser, or the managed CLI's bootstrap sign-up. Every later account is
 * created by an administrator through `POST /api/app/users/members`, which
 * reaches Better Auth as a SERVER-side call carrying no request — the product
 * says so itself ("after the initial account, local account creation uses
 * invitations rather than open self-service registration"), and the login page
 * offers setup only while `hasAnyUsers` is false.
 *
 * The route stayed open anyway, which is not a feature nobody uses: it is a way
 * in for anyone who can reach the backend. That is wider than the edge, because
 * `backend-api` is dual-homed onto the sandbox network so in-sandbox connectors
 * can call their host door (compose.yml). Code running inside an agent session —
 * a prompt-injected agent, or a client's own automation body — could therefore
 * create accounts on a deployment whose proxy refuses exactly that, and an
 * address someone else holds first is an address an operator can no longer
 * declare for a machine account.
 *
 * So the gate keeps the two paths that exist and closes the one that does not.
 */

/**
 * Two limits this gate does not cover, stated so nobody reads more into it.
 * The empty-deployment window is a race: the probe and the insert are separate
 * statements, so simultaneous first sign-ups are all admitted. And a managed
 * deployment closes the same route at its edge (the CLI's Caddy policy in
 * `tools/cli/src/lib/deployment/runtime-prepare.ts`); this gate is what holds
 * when a caller is already past that edge.
 */

/** Test deployments that deliberately want the route open (integration checks
 * create their own users over HTTP). Never set on a real deployment. */
export const OPEN_SIGN_UP_ENV = 'TALE_ALLOW_OPEN_SIGN_UP';

export const SIGN_UP_CLOSED_MESSAGE =
  'Sign-up is closed on this deployment; an administrator creates accounts.';

/** The Better Auth path this gate guards. */
export const SIGN_UP_EMAIL_PATH = '/sign-up/email';

export interface SignUpAttempt {
  /** The call arrived as an HTTP request, not from the server's own API. */
  readonly overHttp: boolean;
  /** `TALE_ALLOW_OPEN_SIGN_UP` is on. */
  readonly openSignUp: boolean;
  /**
   * Whether the deployment already holds an account — a QUERY, asked only
   * where its answer can still change the verdict. An administrator's
   * server-side call must neither pay for it nor fail when the database
   * hiccups on a path that ignores the result.
   */
  readonly deploymentHasUsers: () => Promise<boolean>;
}

export async function signUpAllowed(attempt: SignUpAttempt): Promise<boolean> {
  // An administrator's own door, and the deployment's provisioning: these
  // never arrive as a request, and they carry their own authorization.
  if (!attempt.overHttp) return true;
  if (attempt.openSignUp) return true;
  // First boot: the setup flow and the managed CLI's bootstrap.
  return !(await attempt.deploymentHasUsers());
}

export function openSignUpEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return env[OPEN_SIGN_UP_ENV] === 'true';
}
