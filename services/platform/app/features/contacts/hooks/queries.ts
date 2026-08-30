import { useMemo } from 'react';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';

export type Contact = ContactDoc;

export function useApproxContactCount(organizationId: string) {
  return useConvexQuery('contacts/queries:approxCountContacts', {
    organizationId,
  });
}

export function useContacts(organizationId: string) {
  const { data, isLoading } = useConvexQuery('contacts/queries:listContacts', {
    organizationId,
  });

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
    'contacts/queries:listContactsPaginated',
    queryArgs,
    { initialNumItems },
  );
}
