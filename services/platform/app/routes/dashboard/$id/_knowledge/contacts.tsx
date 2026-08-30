import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ContactsTable } from '@/app/features/contacts/components/contact-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/contacts')({
  head: () => ({
    meta: seo('contacts'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      api.contacts.queries.approxCountContacts,
      {
        organizationId: params.id,
      },
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListContactsPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.contacts.queries.listContactsPaginated,
      { organizationId: params.id },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: ContactsPage,
});

function ContactsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <ContactsTable
      organizationId={organizationId}
      source={search.source}
      locale={search.locale}
    />
  );
}
