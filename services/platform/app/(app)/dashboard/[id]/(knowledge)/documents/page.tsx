import { SuspenseLoader } from '@/components/suspense-loader';
import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import DocumentTable from './components/document-table';
import { Logger } from '@/lib/logger';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';

const logger = new Logger('documents');
interface DocumentsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    size?: string;
    query?: string;
    folderPath?: string;
  }>;
}

async function DocumentsPageContent({
  params,
  searchParams,
}: DocumentsPageProps) {
  const { id: organizationId } = await params;
  const { page, size, query, folderPath } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }
  const documentInfo = await fetchQuery(
    api.documents.getDocuments,
    {
      organizationId: organizationId as string,
      page: currentPage,
      size: pageSize,
      query: searchQuery || '',
      folderPath: folderPath || '',
    },
    { token },
  );

  if (!documentInfo.success) {
    logger.error('Failed to get documents info:', {
      error: documentInfo.error,
      organizationId,
    });
  }

  // Extract pagination metadata from response
  const totalItems = documentInfo.totalItems || 0;
  const hasNextPage = documentInfo.pagination?.hasNextPage || false;

  return (
    <DocumentTable
      items={documentInfo.items || []}
      total={totalItems}
      currentPage={currentPage}
      hasNextPage={hasNextPage}
      pageSize={pageSize}
      searchQuery={searchQuery}
      organizationId={organizationId}
      currentFolderPath={folderPath}
    />
  );
}

export default function DocumentsPage(props: DocumentsPageProps) {
  return (
    <SuspenseLoader>
      <DocumentsPageContent {...props} />
    </SuspenseLoader>
  );
}
