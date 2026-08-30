import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ContactsTable } from '@/app/features/contacts/components/contact-table';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
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
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListContactsPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
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
