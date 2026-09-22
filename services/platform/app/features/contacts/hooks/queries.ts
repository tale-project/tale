import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';

export type Contact = ContactDoc;

export function useApproxContactCount(organizationId: string) {
  return useBackendQuery('contacts/queries:approxCountContacts', {
    organizationId,
  });
}

/**
 * The org's contacts. `search` narrows the page server-side, so a picker can
 * reach a contact beyond the listing's first page instead of filtering the
 * newest few hundred in the browser; omitting it answers that first page,
 * which is the browsable default.
 */
export function useContacts(organizationId: string, search?: string) {
  const trimmed = search?.trim() ?? '';
  const { data, isLoading } = useBackendQuery('contacts/queries:listContacts', {
    organizationId,
    ...(trimmed === '' ? {} : { search: trimmed }),
  });

  return {
    contacts: data ?? [],
    isLoading,
  };
}

/**
 * One contact by id. The listing answers a bounded page, so a contact the
 * current page excludes — an older row, or one a search filtered out — has
 * nowhere else to come from; a picker needs it to keep naming its own
 * selection. Pass `undefined` to skip.
 */
export function useContact(contactId: string | undefined) {
  const { data } = useBackendQuery(
    'contacts/queries:getContact',
    contactId ? { contactId } : 'skip',
  );
  return data ?? null;
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
