import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { DocumentsClient } from '@/app/features/documents/components/documents-client';

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

  const hasMicrosoftAccount =
    useQuery(api.accounts.queries.hasMicrosoftAccount) ?? false;

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
