import {
  isEmailAllowlisted,
  parseEmailAllowlist,
} from '../lib/email-allowlist.ts';

/**
 * Who may create an organization on a deployment.
 *
 * Better Auth's organization plugin lets every signed-in user create one, and
 * on a deployment an operator runs for one team that is the wrong default:
 * a managed deployment used to close the door at its edge for EVERYONE — the
 * CLI's proxy policy answered the capability probe `{"canCreate":false}` and
 * refused `POST /api/auth/organization/create` — so the owner and the
 * operator could not open a second workspace either, and nothing the
 * deployment declared could change that.
 *
 * The operator now names the people who may create organizations in
 * `TALE_ORGANIZATION_CREATORS` (a managed deployment declares them as
 * `organizations.creators` in its specification and the CLI writes the
 * variable), and the BACKEND decides — the edge cannot know who is asking,
 * and `backend-api` is reachable from the sandbox network the edge never
 * sees (see `sign-up-gate.ts` for the same argument about accounts).
 *
 * The truth table, in order:
 *   - a server-side call (no request) is the deployment's own provisioning
 *     and always passes;
 *   - an UNSET variable is the deployment's previous behaviour: any signed-in
 *     user may create (a workspace deployment or an own Compose file that
 *     never heard of the list keeps working);
 *   - a listed address passes;
 *   - otherwise the request passes only while the deployment holds NO
 *     organization — the first one is the setup flow's, or the managed
 *     bootstrap's, and it is created by an account nobody could list yet.
 * A variable that is set but names nobody therefore closes creation to
 * everyone once the first organization exists.
 */

export const ORGANIZATION_CREATORS_ENV = 'TALE_ORGANIZATION_CREATORS';

/** The Better Auth path this gate guards. */
export const ORGANIZATION_CREATE_PATH = '/organization/create';

export const ORGANIZATION_CREATION_FORBIDDEN_MESSAGE =
  'Organization creation on this deployment is limited to the people its operator named; ask one of them for a workspace.';

/**
 * The declared creators: `null` when the variable is unset (no list — every
 * signed-in user may create), otherwise the lower-cased addresses it names,
 * an empty set when it names nobody.
 */
export function parseOrganizationCreators(
  env: Record<string, string | undefined>,
): ReadonlySet<string> | null {
  const value = env[ORGANIZATION_CREATORS_ENV];
  if (value === undefined) return null;
  return parseEmailAllowlist(value);
}

export interface OrganizationCreationAttempt {
  /** The call arrived as an HTTP request, not from the server's own API. */
  readonly overHttp: boolean;
  /** The signed-in user's address; `undefined` when the caller has none. */
  readonly email: string | undefined;
  /** `parseOrganizationCreators(process.env)` — `null` for no list. */
  readonly creators: ReadonlySet<string> | null;
  /**
   * Whether the deployment already holds an organization — a QUERY, asked
   * only when the list is set and does not name the caller, because only
   * then does its answer change the verdict.
   */
  readonly deploymentHasOrganizations: () => Promise<boolean>;
}

export async function organizationCreationAllowed(
  attempt: OrganizationCreationAttempt,
): Promise<boolean> {
  if (!attempt.overHttp) return true;
  if (attempt.creators === null) return true;
  if (isEmailAllowlisted(attempt.creators, attempt.email)) return true;
  // First boot: the setup flow's organization, or the managed bootstrap's.
  return !(await attempt.deploymentHasOrganizations());
}
