import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { DocumentsTable } from '@/app/features/documents/components/documents-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  folderId: z.string().optional(),
  doc: z.string().optional(),
  cloudImport: z.string().optional(),
  cloudImportStatus: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/documents')({
  head: () => ({
    meta: seo('documents'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
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
  const {
    query: searchQuery,
    folderId,
    doc,
    cloudImport,
    cloudImportStatus,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Latch open across the URL clean-up so remounting the action menu after
  // replace:true does not close the picker.
  const [oneDriveOpen, setOneDriveOpen] = useState(
    () => cloudImport === 'onedrive' && cloudImportStatus === 'connected',
  );
  const [googleDriveOpen, setGoogleDriveOpen] = useState(
    () => cloudImport === 'google-drive' && cloudImportStatus === 'connected',
  );

  useEffect(() => {
    if (cloudImportStatus !== 'connected') return;
    if (cloudImport === 'onedrive') {
      setOneDriveOpen(true);
    } else if (cloudImport === 'google-drive') {
      setGoogleDriveOpen(true);
    } else {
      return;
    }
    void navigate({
      search: (prev) => {
        const { cloudImport: _p, cloudImportStatus: _s, ...rest } = prev;
        return rest;
      },
      replace: true,
    });
  }, [cloudImport, cloudImportStatus, navigate]);

  return (
    <DocumentsTable
      organizationId={organizationId}
      searchQuery={searchQuery?.trim()}
      currentFolderId={folderId}
      docId={doc}
      oneDriveOpen={oneDriveOpen}
      onOneDriveOpenChange={setOneDriveOpen}
      googleDriveOpen={googleDriveOpen}
      onGoogleDriveOpenChange={setGoogleDriveOpen}
    />
  );
}
