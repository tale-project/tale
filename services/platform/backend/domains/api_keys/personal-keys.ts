import {
  personalKeysWorkOf,
  type PersonalKeysConfig,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  readGovernancePolicy,
  readGovernancePolicyForOrg,
} from '../../lib/org-config.ts';

/**
 * Whether an organization lets its members' own API keys in (APIKEY-R12,
 * the `personal_keys` governance policy). A person's own key — one with no
 * `app.api_key_owners` row — works in every organization they belong to;
 * an Owner or Admin can turn that off for theirs, and theirs alone. The
 * `/api/v1` door asks this of a person's own key only: a key made here for
 * a member, a team, a project or the organization never reaches the check.
 *
 * The read is strict, as an authorization read must be: a missing file is
 * the default (the keys work), and a file that cannot be read keeps the
 * keys out until it is restored rather than letting them in on a default.
 */
export type PersonalKeysStanding = 'admitted' | 'refused' | 'unavailable';

async function standingOf(
  where: string,
  read: () => Promise<PersonalKeysConfig | null>,
): Promise<PersonalKeysStanding> {
  try {
    return personalKeysWorkOf(await read()) ? 'admitted' : 'refused';
  } catch (error) {
    console.error(
      `[api-keys] ${where}: the personal keys policy cannot be read, so members' own API keys stay out until it is restored:`,
      error,
    );
    return 'unavailable';
  }
}

/** The standing of members' own keys in the organization with this slug —
 * what the REST door, which resolved the slug already, asks. */
export function personalKeysStandingIn(
  orgSlug: string,
): Promise<PersonalKeysStanding> {
  return standingOf(orgSlug, () =>
    readGovernancePolicy(orgSlug, 'personal_keys', { strict: true }),
  );
}

/** The same standing by the organization's id, for the app's settings. */
export function personalKeysStandingOf(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<PersonalKeysStanding> {
  return standingOf(organizationId, () =>
    readGovernancePolicyForOrg(sql, organizationId, 'personal_keys', {
      strict: true,
    }),
  );
}

/** The organizations of a list that let members' own keys in: where a
 * refused key still works, as its refusal lists them. */
export async function organizationsAdmittingPersonalKeys<
  T extends { slug: string },
>(organizations: readonly T[]): Promise<T[]> {
  const standings = await Promise.all(
    organizations.map((org) => personalKeysStandingIn(org.slug)),
  );
  return organizations.filter((_, index) => standings[index] === 'admitted');
}
