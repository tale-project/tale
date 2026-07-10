import { useMemo } from 'react';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';

export type Contact = Doc<'contacts'>;

export function useApproxContactCount(organizationId: string) {
  return useConvexQuery(api.contacts.queries.approxCountContacts, {
    organizationId,
  });
}

export function useContacts(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.contacts.queries.listContacts,
    {
      organizationId,
    },
  );

  return {
    contacts: data ?? [],
    isLoading,
  };
}

export function useContactById(
  contacts: Contact[],
  contactId: string | undefined,
) {
  return useMemo(
    () => contacts.find((c) => c._id === contactId) ?? null,
    [contacts, contactId],
  );
}

interface ListContactsPaginatedArgs {
  organizationId: string;
  source?: string;
  locale?: string;
  initialNumItems: number;
}

export function useListContactsPaginated(args: ListContactsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;

  return useCachedPaginatedQuery(
    api.contacts.queries.listContactsPaginated,
    queryArgs,
    { initialNumItems },
  );
}
