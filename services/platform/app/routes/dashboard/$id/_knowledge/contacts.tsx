import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ContactsTable } from '@/app/features/contacts/components/contact-table';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import {
  prefetchAdaptedPaginatedQuery,
  prefetchAdaptedQuery,
} from '@/app/lib/backend/prefetch';
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
      'contacts/queries:approxCountContacts',
      {
        organizationId: params.id,
      },
    );
    // Prime the first page of the list, under the key the table reads, so a
    // first visit paints its rows without skeleton rows. The tab strip preloads
    // this route as it renders, so the page is usually in the cache before the
    // tab is clicked. The args are useListContactsPaginated's on a visit with
    // no filter in the URL, which is how a tab opens.
    prefetchAdaptedPaginatedQuery(
      context.queryClient,
      'contacts/queries:listContactsPaginated',
      { organizationId: params.id },
      DEFAULT_TABLE_PAGE_SIZE,
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
      query={search.query}
      source={search.source}
      locale={search.locale}
    />
  );
}
