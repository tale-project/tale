import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { useHasMicrosoftAccount } from '@/app/features/auth/hooks/queries';
import { DocumentsClient } from '@/app/features/documents/components/documents-client';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  folderPath: z.string().optional(),
  doc: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/documents')({
  head: () => ({
    meta: seo('documents'),
  }),
  validateSearch: searchSchema,
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.accounts.queries.hasMicrosoftAccount, {}),
    );
  },
  component: DocumentsPage,
});

function DocumentsPage() {
  const { id: organizationId } = Route.useParams();
  const { query: searchQuery, folderPath, doc } = Route.useSearch();

  const { data: hasMicrosoftAccount = false } = useHasMicrosoftAccount();

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
