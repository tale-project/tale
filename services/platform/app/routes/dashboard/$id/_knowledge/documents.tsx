import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { useHasMicrosoftAccount } from '@/app/features/auth/hooks/queries';
import { DocumentsTable } from '@/app/features/documents/components/documents-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  folderId: z.string().optional(),
  doc: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/documents')({
  head: () => ({
    meta: seo('documents'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.accounts.queries.hasMicrosoftAccount, {}),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.documents.queries.approxCountDocuments, {
        organizationId: params.id,
      }),
    );
    // Root folder list — matches useFolders(orgId) with no parentId.
    void context.queryClient.prefetchQuery(
      convexQuery(api.folders.queries.listFolders, {
        organizationId: params.id,
      }),
    );
    // Prime the paginated document list (root folder, no filters) so the table
    // paints without a skeleton flash on first nav.
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.documents.queries.listDocumentsPaginated,
      { organizationId: params.id },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: DocumentsPage,
});

function DocumentsPage() {
  const { id: organizationId } = Route.useParams();
  const { query: searchQuery, folderId, doc } = Route.useSearch();

  const { data: hasMicrosoftAccount = false } = useHasMicrosoftAccount();

  return (
    <DocumentsTable
      organizationId={organizationId}
      searchQuery={searchQuery?.trim()}
      currentFolderId={folderId}
      docId={doc}
      hasMicrosoftAccount={hasMicrosoftAccount}
    />
  );
}
