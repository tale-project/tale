import { useMemo } from 'react';

import { useMemberLookup } from '@/app/features/settings/organization/hooks/member-lookup';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';

import { LOGS_PAGE_SIZE } from '../logs-page-size';

// The page size is held by the listings rather than passed in: the logs page's
// filter bar watches the same listing its active tab reads, and one cache entry
// has to be fetched with one page size.

interface ListAuditLogsPaginatedArgs {
  /** `undefined` skips the read. */
  organizationId: string | undefined;
  category?: string;
  resourceType?: string;
}

export function useListAuditLogsPaginated({
  organizationId,
  ...filters
}: ListAuditLogsPaginatedArgs) {
  return useCachedPaginatedQuery(
    'audit_logs/queries:listAuditLogsPaginated',
    organizationId === undefined ? 'skip' : { organizationId, ...filters },
    { initialNumItems: LOGS_PAGE_SIZE },
  );
}

interface ListErrorLogsPaginatedArgs {
  /** `undefined` skips the read. */
  organizationId: string | undefined;
  category?: string;
}

export function useListErrorLogsPaginated({
  organizationId,
  ...filters
}: ListErrorLogsPaginatedArgs) {
  return useCachedPaginatedQuery(
    'audit_logs/queries:listErrorLogsPaginated',
    organizationId === undefined ? 'skip' : { organizationId, ...filters },
    { initialNumItems: LOGS_PAGE_SIZE },
  );
}

export function useActivitySummary(
  organizationId: string,
  periodDays: 7 | 30 | 90,
) {
  return useBackendQuery('audit_logs/queries:getActivitySummary', {
    organizationId,
    periodDays,
  });
}

/** Who acted, as an audit row or the activity roll-up records them. */
interface RecordedActor {
  actorId: string;
  actorEmail?: string | null;
  /** Absent from the activity roll-up, which counts an actor's rows of
   * every type together. */
  actorType?: string;
}

/** The actor types whose `actorId` can be a person's user id: a member
 * acting in the app, or the member whose API key acted. An `api` row may
 * name SCIM or a customer instead, whom the lookup answers without. */
const PERSON_ACTOR_TYPES: ReadonlySet<string> = new Set(['user', 'api']);

/**
 * The e-mail of each person the given actors name whose row records none —
 * a key's maker, whose address an API row never carries, or one the row
 * keeps only hashed — looked up for those people alone
 * (`GET /members/lookup`, MEMBER-R11) instead of reading every member. A
 * system or automation actor names no member and is not looked up; a person
 * the lookup does not find stays their id. `undefined` skips the read.
 */
export function useActorEmails(
  organizationId: string | undefined,
  actors: readonly RecordedActor[],
): ReadonlyMap<string, string> {
  const people = useMemo(
    () =>
      organizationId === undefined
        ? []
        : actors.flatMap((actor) =>
            !actor.actorEmail &&
            (actor.actorType === undefined ||
              PERSON_ACTOR_TYPES.has(actor.actorType))
              ? [{ userId: actor.actorId }]
              : [],
          ),
    [actors, organizationId],
  );
  const lookup = useMemberLookup(organizationId ?? '', people);
  return useMemo(() => {
    const emails = new Map<string, string>();
    for (const member of lookup.members) {
      if (member.email) emails.set(member.userId, member.email);
    }
    return emails;
  }, [lookup.members]);
}
