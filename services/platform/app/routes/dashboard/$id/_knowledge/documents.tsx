import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DocumentsClient } from '@/app/features/documents/components/documents-client';
import { api } from '@/convex/_generated/api';

const searchSchema = z.object({
  query: z.string().optional(),
  folderPath: z.string().optional(),
  doc: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/documents')({
  validateSearch: searchSchema,
  component: DocumentsPage,
});

function DocumentsPage() {
  const { id: organizationId } = Route.useParams();
  const { query: searchQuery, folderPath, doc } = Route.useSearch();

  const { data: hasMicrosoftAccount = false } = useQuery(
    convexQuery(api.accounts.queries.hasMicrosoftAccount, {}),
  );

  return (
    <DocumentsClient
      organizationId={organizationId}
      searchQuery={searchQuery?.trim()}
      currentFolderPath={folderPath}
      docId={doc}
      hasMicrosoftAccount={hasMicrosoftAccount}
    />
  );
}
