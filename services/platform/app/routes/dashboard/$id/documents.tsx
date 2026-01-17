import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DocumentsClient } from '@/app/features/documents/components/documents-client';

const searchSchema = z.object({
  query: z.string().optional(),
  folderPath: z.string().optional(),
  doc: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/documents')({
  validateSearch: searchSchema,
  component: DocumentsPage,
});

function DocumentsPage() {
  const { id: organizationId } = Route.useParams();
  const { query, folderPath, doc } = Route.useSearch();

  return (
    <DocumentsClient
      organizationId={organizationId}
      searchQuery={query?.trim()}
      currentFolderPath={folderPath}
      docId={doc}
      hasMicrosoftAccount={false}
    />
  );
}
